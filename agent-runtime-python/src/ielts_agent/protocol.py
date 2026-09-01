"""Strict protocol envelopes shared by the Python runtime bootstrap."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

PROTOCOL_VERSION = 1
RUNTIME_VERSION = "0.1.0"
MAX_FRAME_BYTES = 1024 * 1024
SUPPORTED_CAPABILITIES = {
    "runtime.health": "1",
    "runtime.shutdown": "1",
    "memory.candidates.extract": "1",
    "memory.candidates.generate": "1",
    # M7-06 daily-dream orchestration entry: the Rust host drives one bounded
    # consolidation pass (journal facts → proposals → dream.run_daily).
    "dream.daily": "1",
    # M12-04 study-planner orchestration entry: deterministic plan proposal,
    # submitted back via the study_plan.create host capability.
    "planner.study_plan": "1",
}
REQUIRED_HOST_CAPABILITIES = {"model.invoke": "1", "tool.invoke": "1"}


class ProtocolError(ValueError):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        retryable: bool = False,
        details: Mapping[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.details = dict(details or {})

    def as_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
            "details": self.details,
        }


@dataclass(frozen=True)
class RequestEnvelope:
    request_id: str
    trace_id: str
    deadline_ms: int
    method: str
    params: dict[str, Any]
    protocol_version: int = PROTOCOL_VERSION

    @classmethod
    def from_mapping(cls, raw: Mapping[str, Any]) -> "RequestEnvelope":
        required = {"protocolVersion", "requestId", "traceId", "deadlineMs", "method", "params"}
        unknown = set(raw).difference(required)
        missing = required.difference(raw)
        if unknown:
            raise ProtocolError("schema_unknown_field", "request contains unknown fields", details={"fields": sorted(unknown)})
        if missing:
            raise ProtocolError("schema_missing_field", "request is missing fields", details={"fields": sorted(missing)})
        protocol_version = _positive_int(raw["protocolVersion"], "protocolVersion", allow_zero=False)
        request_id = _text(raw["requestId"], "requestId")
        trace_id = _text(raw["traceId"], "traceId")
        deadline_ms = _positive_int(raw["deadlineMs"], "deadlineMs", allow_zero=True)
        method = _text(raw["method"], "method")
        params = raw["params"]
        if not isinstance(params, dict):
            raise ProtocolError("schema_type_error", "params must be an object")
        return cls(request_id, trace_id, deadline_ms, method, dict(params), protocol_version)


@dataclass(frozen=True)
class RuntimeMetadata:
    selected_protocol: int
    runtime_version: str
    build_id: str
    capabilities: dict[str, str]
    required_host_capabilities: dict[str, str]
    max_frame_bytes: int

    def as_dict(self) -> dict[str, Any]:
        return {
            "selectedProtocol": self.selected_protocol,
            "runtimeVersion": self.runtime_version,
            "buildId": self.build_id,
            "capabilities": dict(sorted(self.capabilities.items())),
            "requiredHostCapabilities": dict(sorted(self.required_host_capabilities.items())),
            "maxFrameBytes": self.max_frame_bytes,
        }


def success_response(request: RequestEnvelope, result: Any) -> dict[str, Any]:
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "requestId": request.request_id,
        "traceId": request.trace_id,
        "ok": True,
        "result": result,
    }


def error_response(
    request_id: str,
    trace_id: str,
    error: ProtocolError,
) -> dict[str, Any]:
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "requestId": request_id,
        "traceId": trace_id,
        "ok": False,
        "error": error.as_dict(),
    }


def _text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ProtocolError("schema_type_error", f"{field} must be non-empty text")
    return value


def _positive_int(value: Any, field: str, *, allow_zero: bool) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or (not allow_zero and value <= 0) or (allow_zero and value < 0):
        raise ProtocolError("schema_type_error", f"{field} must be a non-negative integer")
    return value
