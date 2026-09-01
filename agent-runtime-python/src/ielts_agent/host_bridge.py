"""Synchronous reverse-RPC bridge to the trusted Rust host.

The runtime processes one cognitive request at a time. Nested host calls reuse
the same framed streams, which keeps ordering deterministic and makes it
impossible for Python to discover database or credential paths.
"""

from __future__ import annotations

import itertools
import time
from typing import Any, BinaryIO

from .framing import read_frame, write_frame
from .protocol import MAX_FRAME_BYTES, PROTOCOL_VERSION, ProtocolError


class FramedHostBridge:
    def __init__(self, stdin: BinaryIO, stdout: BinaryIO) -> None:
        self._stdin = stdin
        self._stdout = stdout
        self._sequence = itertools.count(1)

    def invoke(
        self,
        method: str,
        params: dict[str, Any],
        *,
        trace_id: str,
        deadline_ms: int,
        started_at: float,
    ) -> dict[str, Any]:
        elapsed_ms = int((time.monotonic() - started_at) * 1000)
        remaining_ms = max(0, deadline_ms - elapsed_ms)
        if remaining_ms == 0:
            raise ProtocolError("deadline_exceeded", "cognitive request deadline expired", retryable=True)
        request_id = f"python-host-{next(self._sequence)}"
        write_frame(
            self._stdout,
            {
                "protocolVersion": PROTOCOL_VERSION,
                "requestId": request_id,
                "traceId": trace_id,
                "deadlineMs": remaining_ms,
                "method": method,
                "params": params,
            },
            MAX_FRAME_BYTES,
        )
        response = read_frame(self._stdin, MAX_FRAME_BYTES)
        if response is None:
            raise ProtocolError("host_disconnected", "Rust host disconnected", retryable=True)
        if response.get("protocolVersion") != PROTOCOL_VERSION:
            raise ProtocolError("protocol_version_mismatch", "host response protocol mismatch")
        if response.get("requestId") != request_id or response.get("traceId") != trace_id:
            raise ProtocolError("host_response_mismatch", "host response identity mismatch")
        if response.get("ok") is not True:
            error = response.get("error")
            if not isinstance(error, dict):
                raise ProtocolError("host_error_invalid", "host returned an invalid error")
            raise ProtocolError(
                str(error.get("code", "host_error")),
                str(error.get("message", "host request failed")),
                retryable=bool(error.get("retryable", False)),
            )
        result = response.get("result")
        if not isinstance(result, dict):
            raise ProtocolError("host_result_invalid", "host result must be an object")
        return result
