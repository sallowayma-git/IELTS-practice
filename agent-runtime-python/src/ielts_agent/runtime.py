"""No-DB runtime server for the M3-00A bootstrap."""

from __future__ import annotations

import os
import sys
from typing import Any, BinaryIO

from pydantic import ValidationError

from .memory_extractor import MemoryCandidateInput, extract_memory_candidates
from .host_bridge import FramedHostBridge
from .memory_manager import HostBridge, run_memory_candidate_generation
from .dream import DailyDreamOrchestrator, DreamRunInput
from .planner import PlannerRunInput, StudyPlannerOrchestrator
from .planner.types import PlannerInput

from .framing import FrameError, read_frame, write_frame
from .protocol import (
    MAX_FRAME_BYTES,
    PROTOCOL_VERSION,
    RUNTIME_VERSION,
    REQUIRED_HOST_CAPABILITIES,
    SUPPORTED_CAPABILITIES,
    ProtocolError,
    RequestEnvelope,
    RuntimeMetadata,
    error_response,
    success_response,
)


class RuntimeServer:
    def __init__(self, *, build_id: str | None = None, host_bridge: HostBridge | None = None) -> None:
        self.metadata = RuntimeMetadata(
            selected_protocol=PROTOCOL_VERSION,
            runtime_version=RUNTIME_VERSION,
            build_id=build_id or os.environ.get("IELTS_AGENT_BUILD_ID", "dev-source"),
            capabilities=SUPPORTED_CAPABILITIES,
            required_host_capabilities=REQUIRED_HOST_CAPABILITIES,
            max_frame_bytes=MAX_FRAME_BYTES,
        )
        self.host_bridge = host_bridge
        self.handshaken = False
        self.stopping = False
        # Capabilities the Rust host advertised at handshake. Dream/planner
        # orchestration gates on this map (fail-closed when empty).
        self.host_capabilities: dict[str, str] = {}

    def handle(self, raw: dict[str, Any]) -> dict[str, Any]:
        request_id = str(raw.get("requestId", ""))
        trace_id = str(raw.get("traceId", ""))
        try:
            request = RequestEnvelope.from_mapping(raw)
            request_id, trace_id = request.request_id, request.trace_id
            if request.protocol_version != PROTOCOL_VERSION:
                raise ProtocolError(
                    "protocol_version_mismatch",
                    "unsupported protocol version",
                    details={"supported": PROTOCOL_VERSION, "received": request.protocol_version},
                )
            if request.deadline_ms == 0:
                raise ProtocolError("deadline_exceeded", "request deadline has expired", retryable=True)
            result = self._dispatch(request)
            return success_response(request, result)
        except ProtocolError as error:
            return error_response(request_id, trace_id, error)
        except Exception as error:  # pragma: no cover - last-resort process boundary
            return error_response(
                request_id,
                trace_id,
                ProtocolError("runtime_internal_error", str(error), retryable=True),
            )

    def _dispatch(self, request: RequestEnvelope) -> dict[str, Any]:
        if request.method == "runtime.handshake":
            return self._handshake(request.params)
        if not self.handshaken:
            raise ProtocolError("handshake_required", "handshake must complete before requests")
        if request.method == "runtime.health":
            return {"state": "stopping" if self.stopping else "ready", "protocolVersion": PROTOCOL_VERSION}
        if request.method == "runtime.shutdown":
            self.stopping = True
            return {"state": "stopped"}
        if request.method == "memory.candidates.extract":
            return self._extract_memory_candidates(request.params)
        if request.method == "memory.candidates.generate":
            return self._generate_memory_candidates(request)
        if request.method == "dream.daily":
            return self._run_daily_dream(request)
        if request.method == "planner.study_plan":
            return self._run_study_planner(request)
        raise ProtocolError("method_not_found", f"unsupported method: {request.method}")

    def _extract_memory_candidates(self, params: dict[str, Any]) -> dict[str, Any]:
        if set(params) != {"input", "modelOutput"}:
            raise ProtocolError(
                "schema_invalid_fields",
                "memory.candidates.extract requires exactly input and modelOutput",
            )
        if not isinstance(params["modelOutput"], str):
            raise ProtocolError("schema_type_error", "modelOutput must be text")
        try:
            candidate_input = MemoryCandidateInput.model_validate(params["input"])
        except ValidationError as error:
            raise ProtocolError(
                "candidate_input_invalid",
                "memory candidate input is invalid",
                details={"errors": error.errors(include_url=False, include_input=False)},
            ) from error
        batch, fallback_used = extract_memory_candidates(
            candidate_input,
            params["modelOutput"],
        )
        return {"batch": batch.to_wire(), "fallbackUsed": fallback_used}

    def _generate_memory_candidates(self, request: RequestEnvelope) -> dict[str, Any]:
        if self.host_bridge is None:
            raise ProtocolError("host_bridge_unavailable", "trusted Rust host bridge is unavailable")
        if set(request.params) != {"maxCandidates"}:
            raise ProtocolError("schema_invalid_fields", "memory.candidates.generate requires maxCandidates")
        maximum = request.params["maxCandidates"]
        if isinstance(maximum, bool) or not isinstance(maximum, int) or not 1 <= maximum <= 32:
            raise ProtocolError("schema_type_error", "maxCandidates must be an integer from 1 to 32")
        return run_memory_candidate_generation(
            self.host_bridge,
            trace_id=request.trace_id,
            deadline_ms=request.deadline_ms,
            max_candidates=maximum,
        )

    def _handshake(self, params: dict[str, Any]) -> dict[str, Any]:
        host_version = params.get("hostProtocolVersion")
        if host_version != PROTOCOL_VERSION:
            raise ProtocolError(
                "protocol_version_mismatch",
                "host and runtime protocol versions differ",
                details={"supported": PROTOCOL_VERSION, "received": host_version},
            )
        requested = params.get("requestedCapabilities", list(SUPPORTED_CAPABILITIES))
        if not isinstance(requested, list) or any(not isinstance(value, str) for value in requested):
            raise ProtocolError("schema_type_error", "requestedCapabilities must be a string array")
        unsupported = sorted(set(requested).difference(SUPPORTED_CAPABILITIES))
        if unsupported:
            raise ProtocolError(
                "capability_mismatch",
                "runtime cannot provide requested capabilities",
                details={"unsupported": unsupported},
            )
        host_capabilities = params.get("hostCapabilities", {})
        if not isinstance(host_capabilities, dict):
            raise ProtocolError("schema_type_error", "hostCapabilities must be an object")
        missing_host = sorted(
            capability
            for capability, version in REQUIRED_HOST_CAPABILITIES.items()
            if host_capabilities.get(capability) != version
        )
        if missing_host:
            raise ProtocolError(
                "host_capability_mismatch",
                "host cannot provide required runtime capabilities",
                details={"missing": missing_host},
            )
        self.host_capabilities = {
            str(key): str(value) for key, value in host_capabilities.items()
        }
        self.handshaken = True
        return self.metadata.as_dict()

    def _run_daily_dream(self, request: RequestEnvelope) -> dict[str, Any]:
        """M7-06: drive one bounded daily-dream consolidation pass.

        Rust stays the authority: facts come from ``journal.build_daily``,
        proposals are persisted via ``dream.run_daily``. Host failures stay
        inside the orchestrator's fail-closed fallback result (``runId=""`` +
        ``fallbackReason``) — they are never a fatal protocol error.
        """
        if self.host_bridge is None:
            raise ProtocolError("host_bridge_unavailable", "trusted Rust host bridge is unavailable")
        if set(request.params) != {"day"}:
            raise ProtocolError(
                "schema_invalid_fields",
                "dream.daily requires exactly day",
            )
        day = request.params["day"]
        if not isinstance(day, str) or not day.strip():
            raise ProtocolError("schema_type_error", "day must be a non-empty string")
        orchestrator = DailyDreamOrchestrator(self.host_bridge)
        result = orchestrator.run_daily(
            DreamRunInput(
                trace_id=request.trace_id,
                day=day,
                available_host_capabilities=dict(self.host_capabilities),
            )
        )
        return {"result": result.to_wire()}

    def _run_study_planner(self, request: RequestEnvelope) -> dict[str, Any]:
        """M12-04: produce one deterministic study-plan proposal.

        The proposal-only contract holds: Python submits via the
        ``study_plan.create`` host capability; Rust remains the only writer of
        study-plan state. Failures surface as a fallback proposal.
        """
        if self.host_bridge is None:
            raise ProtocolError("host_bridge_unavailable", "trusted Rust host bridge is unavailable")
        if set(request.params) != {"plannerInput"}:
            raise ProtocolError(
                "schema_invalid_fields",
                "planner.study_plan requires exactly plannerInput",
            )
        try:
            planner_input = PlannerInput.model_validate(request.params["plannerInput"])
        except ValidationError as error:
            raise ProtocolError(
                "planner_input_invalid",
                "planner input is invalid",
                details={"errors": error.errors(include_url=False, include_input=False)},
            ) from error
        orchestrator = StudyPlannerOrchestrator(self.host_bridge)
        proposal = orchestrator.plan(
            PlannerRunInput(
                planner_input=planner_input,
                available_host_capabilities=dict(self.host_capabilities),
            )
        )
        return {"proposal": proposal.to_wire()}


def serve(
    stdin: BinaryIO | None = None,
    stdout: BinaryIO | None = None,
    *,
    build_id: str | None = None,
) -> None:
    input_stream = stdin or sys.stdin.buffer
    output_stream = stdout or sys.stdout.buffer
    server = RuntimeServer(
        build_id=build_id,
        host_bridge=FramedHostBridge(input_stream, output_stream),
    )
    while not server.stopping:
        try:
            raw = read_frame(input_stream, MAX_FRAME_BYTES)
        except FrameError as error:
            write_frame(
                output_stream,
                error_response("", "", ProtocolError("frame_error", str(error))),
                MAX_FRAME_BYTES,
            )
            break
        if raw is None:
            break
        write_frame(output_stream, server.handle(raw), MAX_FRAME_BYTES)


def main() -> int:
    serve()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
