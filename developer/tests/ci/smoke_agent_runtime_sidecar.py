#!/usr/bin/env python3
"""Exercise the frozen M3 sidecar and record release-gate metrics."""

from __future__ import annotations

import argparse
import ctypes
import gzip
import hashlib
import json
import os
import platform
import struct
import subprocess
import sys
import time
from pathlib import Path
from typing import BinaryIO


ROOT = Path(__file__).resolve().parents[3]
MAX_FRAME_BYTES = 1024 * 1024
MAX_UNPACKED_BYTES = 60 * 1024 * 1024
MAX_INSTALLER_DELTA_BYTES = 80 * 1024 * 1024
MAX_IDLE_RSS_BYTES = 150 * 1024 * 1024
MAX_WINDOWS_COLD_START_MS = 1500.0
REPORT = ROOT / "developer/tests/benchmarks/reports/m3_sidecar_release.json"


def host_target() -> str:
    machine = platform.machine().casefold()
    if sys.platform == "win32" and machine in {"amd64", "x86_64"}:
        return "x86_64-pc-windows-msvc"
    if sys.platform == "darwin" and machine in {"arm64", "aarch64"}:
        return "aarch64-apple-darwin"
    if sys.platform.startswith("linux") and machine in {"amd64", "x86_64"}:
        return "x86_64-unknown-linux-gnu"
    raise SystemExit(f"unsupported sidecar smoke host: {sys.platform}/{machine}")


def read_exact(stream: BinaryIO, size: int) -> bytes:
    output = bytearray()
    while len(output) < size:
        chunk = stream.read(size - len(output))
        if not chunk:
            raise RuntimeError("sidecar closed its protocol stream")
        output.extend(chunk)
    return bytes(output)


def read_frame(stream: BinaryIO) -> dict:
    size = struct.unpack(">I", read_exact(stream, 4))[0]
    if size == 0 or size > MAX_FRAME_BYTES:
        raise RuntimeError(f"invalid sidecar frame size: {size}")
    value = json.loads(read_exact(stream, size))
    if not isinstance(value, dict):
        raise RuntimeError("sidecar frame is not an object")
    return value


def write_frame(stream: BinaryIO, value: dict) -> None:
    payload = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
    if not payload or len(payload) > MAX_FRAME_BYTES:
        raise RuntimeError("host smoke frame is outside protocol bounds")
    stream.write(struct.pack(">I", len(payload)) + payload)
    stream.flush()


def request(request_id: str, method: str, params: dict, deadline_ms: int = 10_000) -> dict:
    return {
        "protocolVersion": 1,
        "requestId": request_id,
        "traceId": "smoke-trace",
        "deadlineMs": deadline_ms,
        "method": method,
        "params": params,
    }


def response_for(call: dict, result: dict) -> dict:
    return {
        "protocolVersion": 1,
        "requestId": call["requestId"],
        "traceId": call["traceId"],
        "ok": True,
        "result": result,
    }


def working_set_bytes(pid: int) -> int:
    if sys.platform != "win32":
        return 0

    class ProcessMemoryCounters(ctypes.Structure):
        _fields_ = [
            ("cb", ctypes.c_ulong),
            ("PageFaultCount", ctypes.c_ulong),
            ("PeakWorkingSetSize", ctypes.c_size_t),
            ("WorkingSetSize", ctypes.c_size_t),
            ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
            ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
            ("PagefileUsage", ctypes.c_size_t),
            ("PeakPagefileUsage", ctypes.c_size_t),
        ]

    query_information = 0x0400
    read_memory = 0x0010
    handle = ctypes.windll.kernel32.OpenProcess(query_information | read_memory, False, pid)
    if not handle:
        raise ctypes.WinError()
    try:
        counters = ProcessMemoryCounters()
        counters.cb = ctypes.sizeof(counters)
        ok = ctypes.windll.psapi.GetProcessMemoryInfo(
            handle, ctypes.byref(counters), counters.cb
        )
        if not ok:
            raise ctypes.WinError()
        return int(counters.WorkingSetSize)
    finally:
        ctypes.windll.kernel32.CloseHandle(handle)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", default=host_target())
    parser.add_argument("--binary", type=Path)
    parser.add_argument("--build-id")
    args = parser.parse_args()
    suffix = ".exe" if sys.platform == "win32" else ""
    binary = args.binary or (
        ROOT / "src-tauri/binaries" / f"ielts-agent-runtime-{args.target}{suffix}"
    )
    binary = binary.resolve()
    if not binary.is_file():
        raise SystemExit(f"frozen sidecar is missing: {binary}")
    digest = hashlib.sha256(binary.read_bytes()).hexdigest()
    build_id = args.build_id or digest
    environment = {
        key: os.environ[key]
        for key in ("SystemRoot", "WINDIR", "TEMP", "TMP")
        if key in os.environ
    }
    environment["IELTS_AGENT_BUILD_ID"] = build_id
    started = time.perf_counter()
    process = subprocess.Popen(
        [str(binary)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=environment,
    )
    assert process.stdin is not None and process.stdout is not None and process.stderr is not None
    try:
        write_frame(
            process.stdin,
            request(
                "handshake",
                "runtime.handshake",
                {
                    "hostProtocolVersion": 1,
                    "requestedCapabilities": [
                        "runtime.health",
                        "runtime.shutdown",
                        "memory.candidates.extract",
                        "memory.candidates.generate",
                    ],
                    "hostCapabilities": {"model.invoke": "1", "tool.invoke": "1"},
                },
            ),
        )
        handshake = read_frame(process.stdout)
        cold_start_ms = (time.perf_counter() - started) * 1000
        metadata = handshake.get("result", {})
        expected_capabilities = {
            "runtime.health": "1",
            "runtime.shutdown": "1",
            "memory.candidates.extract": "1",
            "memory.candidates.generate": "1",
        }
        if handshake.get("ok") is not True:
            raise RuntimeError(f"handshake failed: {handshake}")
        if metadata.get("selectedProtocol") != 1 or metadata.get("buildId") != build_id:
            raise RuntimeError("handshake protocol/build identity mismatch")
        if metadata.get("capabilities") != expected_capabilities:
            raise RuntimeError("handshake capability versions do not match the release contract")
        if metadata.get("requiredHostCapabilities") != {
            "model.invoke": "1",
            "tool.invoke": "1",
        }:
            raise RuntimeError("sidecar host capability contract mismatch")

        write_frame(process.stdin, request("health", "runtime.health", {}))
        health = read_frame(process.stdout)
        if health.get("result", {}).get("state") != "ready":
            raise RuntimeError("frozen sidecar did not become ready")
        idle_rss_bytes = working_set_bytes(process.pid)

        write_frame(
            process.stdin,
            request("generate", "memory.candidates.generate", {"maxCandidates": 2}),
        )
        tool_call = read_frame(process.stdout)
        if tool_call.get("method") != "tool.invoke" or tool_call.get("traceId") != "smoke-trace":
            raise RuntimeError("sidecar did not issue the bounded tool request")
        observation_id = "obs-smoke-1"
        write_frame(
            process.stdin,
            response_for(
                tool_call,
                {
                    "input": {
                        "observations": [
                            {
                                "id": observation_id,
                                "namespace": "strategy",
                                "activity": "reading",
                                "normalizedLabel": "reading local evidence",
                                "statement": "Checks local evidence before answering.",
                            }
                        ],
                        "activeMemory": [],
                        "explicitPreferences": [],
                        "taskScope": {"type": "activity", "key": "reading"},
                        "maxCandidates": 2,
                    }
                },
            ),
        )
        model_call = read_frame(process.stdout)
        if model_call.get("method") != "model.invoke" or model_call.get("traceId") != "smoke-trace":
            raise RuntimeError("sidecar did not issue the host-owned model request")
        write_frame(
            process.stdin,
            response_for(
                model_call,
                {
                    "content": "{malformed-json",
                    "model": "fake-model",
                    "latencyMs": 1,
                    "usage": {"inputTokens": 1, "outputTokens": 1},
                    "providerRequestId": "smoke-provider-request",
                },
            ),
        )
        generated = read_frame(process.stdout)
        result = generated.get("result", {})
        proposals = result.get("batch", {}).get("proposals", [])
        if generated.get("ok") is not True or result.get("fallbackUsed") is not True:
            raise RuntimeError("malformed model output did not use deterministic fallback")
        if len(proposals) != 1 or proposals[0].get("evidenceObservationIds") != [observation_id]:
            raise RuntimeError("fallback candidate lost its stable evidence ID")

        write_frame(process.stdin, request("expired", "runtime.health", {}, deadline_ms=0))
        expired = read_frame(process.stdout)
        if expired.get("error", {}).get("code") != "deadline_exceeded":
            raise RuntimeError("expired deadline did not fail closed")

        write_frame(process.stdin, request("shutdown", "runtime.shutdown", {}))
        shutdown = read_frame(process.stdout)
        if shutdown.get("result", {}).get("state") != "stopped":
            raise RuntimeError("sidecar shutdown response is invalid")
        process.wait(timeout=5)
        stderr = process.stderr.read()
        if process.returncode != 0:
            raise RuntimeError(f"sidecar exited {process.returncode}; stderr sha256={hashlib.sha256(stderr).hexdigest()}")
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)

    unpacked_bytes = binary.stat().st_size
    compressed_bytes = len(gzip.compress(binary.read_bytes(), compresslevel=9))
    installer_delta_bytes = unpacked_bytes
    thresholds = {
        "unpackedSize": unpacked_bytes <= MAX_UNPACKED_BYTES,
        "compressedSize": compressed_bytes <= MAX_UNPACKED_BYTES,
        "installerDelta": installer_delta_bytes <= MAX_INSTALLER_DELTA_BYTES,
        "idleRss": sys.platform != "win32" or idle_rss_bytes <= MAX_IDLE_RSS_BYTES,
        "coldStart": sys.platform != "win32" or cold_start_ms <= MAX_WINDOWS_COLD_START_MS,
    }
    report = {
        "schemaVersion": 1,
        "target": args.target,
        "binary": f"src-tauri/binaries/ielts-agent-runtime-{args.target}{suffix}",
        "sha256": digest,
        "protocolVersion": 1,
        "capabilities": expected_capabilities,
        "unpackedBytes": unpacked_bytes,
        "compressedBytes": compressed_bytes,
        "installerDeltaUpperBoundBytes": installer_delta_bytes,
        "coldStartMs": round(cold_start_ms, 3),
        "idleRssBytes": idle_rss_bytes,
        "thresholds": thresholds,
        "status": "pass" if all(thresholds.values()) else "fail",
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if report["status"] != "pass":
        raise SystemExit(f"M3 sidecar release metrics failed: {thresholds}")
    print(json.dumps(report, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
