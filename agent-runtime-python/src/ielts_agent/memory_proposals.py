"""Strict model-output boundary for M3 memory mutation proposals."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, ClassVar, TypeAlias


MEMORY_PROPOSAL_SCHEMA_VERSION = 1
MAX_MEMORY_PROPOSALS = 32
MAX_MEMORY_EVIDENCE_IDS = 32
MAX_MEMORY_KEY_BYTES = 160
MAX_MEMORY_STATEMENT_BYTES = 4 * 1024


class MemoryProposalParseError(ValueError):
    """The model response is not a valid, bounded proposal batch."""

    def __init__(self, code: str, path: str, message: str) -> None:
        super().__init__(f"{code} at {path}: {message}")
        self.code = code
        self.path = path
        self.message = message


class MemoryProposalAction(StrEnum):
    ADD = "ADD"
    REINFORCE = "REINFORCE"
    REFINE = "REFINE"
    IMPROVE = "IMPROVE"
    REGRESS = "REGRESS"
    CONTRADICT = "CONTRADICT"
    SUPERSEDE = "SUPERSEDE"
    ARCHIVE = "ARCHIVE"
    NOOP = "NOOP"


class MemoryNamespace(StrEnum):
    KNOWLEDGE = "knowledge"
    LANGUAGE = "language"
    STRATEGY = "strategy"
    BEHAVIOR = "behavior"
    METACOGNITION = "metacognition"
    PREFERENCE = "preference"
    GOAL = "goal"


class Activity(StrEnum):
    READING = "reading"
    WRITING = "writing"


@dataclass(frozen=True, slots=True)
class ActivityScope:
    key: Activity
    type: ClassVar[str] = "activity"

    def to_wire(self) -> dict[str, str]:
        return {"type": self.type, "key": self.key.value}

    def as_dict(self) -> dict[str, str]:
        return self.to_wire()


@dataclass(frozen=True, slots=True)
class AddProposal:
    namespace: MemoryNamespace
    canonical_key: str
    scope: ActivityScope
    statement: str
    evidence_observation_ids: tuple[str, ...]
    action: ClassVar[MemoryProposalAction] = MemoryProposalAction.ADD

    def to_wire(self) -> dict[str, Any]:
        return {
            "action": self.action.value,
            "namespace": self.namespace.value,
            "canonicalKey": self.canonical_key,
            "scope": self.scope.to_wire(),
            "statement": self.statement,
            "evidenceObservationIds": list(self.evidence_observation_ids),
        }

    def as_dict(self) -> dict[str, Any]:
        return self.to_wire()


_TARGET_ACTIONS = frozenset(
    {
        MemoryProposalAction.REINFORCE,
        MemoryProposalAction.IMPROVE,
        MemoryProposalAction.REGRESS,
        MemoryProposalAction.CONTRADICT,
        MemoryProposalAction.ARCHIVE,
    }
)


@dataclass(frozen=True, slots=True)
class TargetProposal:
    action: MemoryProposalAction
    target_memory_id: str
    evidence_observation_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        if self.action not in _TARGET_ACTIONS:
            raise ValueError(f"{self.action.value} is not a target-only action")

    def to_wire(self) -> dict[str, Any]:
        return {
            "action": self.action.value,
            "targetMemoryId": self.target_memory_id,
            "evidenceObservationIds": list(self.evidence_observation_ids),
        }

    def as_dict(self) -> dict[str, Any]:
        return self.to_wire()


@dataclass(frozen=True, slots=True)
class RefineProposal:
    target_memory_id: str
    proposed_statement: str
    evidence_observation_ids: tuple[str, ...]
    action: ClassVar[MemoryProposalAction] = MemoryProposalAction.REFINE

    def to_wire(self) -> dict[str, Any]:
        return {
            "action": self.action.value,
            "targetMemoryId": self.target_memory_id,
            "proposedStatement": self.proposed_statement,
            "evidenceObservationIds": list(self.evidence_observation_ids),
        }

    def as_dict(self) -> dict[str, Any]:
        return self.to_wire()


@dataclass(frozen=True, slots=True)
class SupersedeProposal:
    target_memory_id: str
    namespace: MemoryNamespace
    canonical_key: str
    scope: ActivityScope
    proposed_statement: str
    evidence_observation_ids: tuple[str, ...]
    action: ClassVar[MemoryProposalAction] = MemoryProposalAction.SUPERSEDE

    def to_wire(self) -> dict[str, Any]:
        return {
            "action": self.action.value,
            "targetMemoryId": self.target_memory_id,
            "namespace": self.namespace.value,
            "canonicalKey": self.canonical_key,
            "scope": self.scope.to_wire(),
            "proposedStatement": self.proposed_statement,
            "evidenceObservationIds": list(self.evidence_observation_ids),
        }

    def as_dict(self) -> dict[str, Any]:
        return self.to_wire()


@dataclass(frozen=True, slots=True)
class NoopProposal:
    action: ClassVar[MemoryProposalAction] = MemoryProposalAction.NOOP

    def to_wire(self) -> dict[str, str]:
        return {"action": self.action.value}

    def as_dict(self) -> dict[str, str]:
        return self.to_wire()


MemoryProposal: TypeAlias = (
    AddProposal | TargetProposal | RefineProposal | SupersedeProposal | NoopProposal
)


@dataclass(frozen=True, slots=True)
class MemoryProposalBatch:
    schema_version: int
    proposals: tuple[MemoryProposal, ...]

    def to_wire(self) -> dict[str, Any]:
        return {
            "schemaVersion": self.schema_version,
            "proposals": [proposal.to_wire() for proposal in self.proposals],
        }

    def as_dict(self) -> dict[str, Any]:
        return self.to_wire()


_BATCH_FIELDS = frozenset({"schemaVersion", "proposals"})
_ADD_FIELDS = frozenset(
    {
        "action",
        "namespace",
        "canonicalKey",
        "scope",
        "statement",
        "evidenceObservationIds",
    }
)
_TARGET_FIELDS = frozenset({"action", "targetMemoryId", "evidenceObservationIds"})
_REFINE_FIELDS = frozenset(
    {"action", "targetMemoryId", "proposedStatement", "evidenceObservationIds"}
)
_SUPERSEDE_FIELDS = frozenset(
    {
        "action",
        "targetMemoryId",
        "namespace",
        "canonicalKey",
        "scope",
        "proposedStatement",
        "evidenceObservationIds",
    }
)
_NOOP_FIELDS = frozenset({"action"})
_ACTION_FIELDS = {
    MemoryProposalAction.ADD: _ADD_FIELDS,
    MemoryProposalAction.REINFORCE: _TARGET_FIELDS,
    MemoryProposalAction.REFINE: _REFINE_FIELDS,
    MemoryProposalAction.IMPROVE: _TARGET_FIELDS,
    MemoryProposalAction.REGRESS: _TARGET_FIELDS,
    MemoryProposalAction.CONTRADICT: _TARGET_FIELDS,
    MemoryProposalAction.SUPERSEDE: _SUPERSEDE_FIELDS,
    MemoryProposalAction.ARCHIVE: _TARGET_FIELDS,
    MemoryProposalAction.NOOP: _NOOP_FIELDS,
}
_CANONICAL_KEY_PATTERN = re.compile(
    r"(?:knowledge|language|strategy|behavior|metacognition|preference|goal)"
    r"\.[a-z0-9_]+(?:\.[a-z0-9_]+)*\Z"
)
_OBSERVATION_ID_PATTERN = re.compile(r"obs-[A-Za-z0-9_-]+\Z")
_MEMORY_ID_PATTERN = re.compile(r"mem-[A-Za-z0-9_-]+\Z")


def parse_memory_proposal_batch(model_json: str) -> MemoryProposalBatch:
    """Parse untrusted model JSON into an immutable, schema-v1 proposal batch."""

    if not isinstance(model_json, str):
        raise MemoryProposalParseError(
            "schema_type_error", "$", "model output must be a JSON string"
        )

    raw = _load_json(model_json)
    batch = _object(raw, "$")
    _require_exact_fields(batch, _BATCH_FIELDS, "$")

    schema_version = batch["schemaVersion"]
    if type(schema_version) is not int or schema_version != MEMORY_PROPOSAL_SCHEMA_VERSION:
        raise MemoryProposalParseError(
            "unsupported_schema_version",
            "$.schemaVersion",
            f"expected {MEMORY_PROPOSAL_SCHEMA_VERSION}",
        )

    proposals = _array(batch["proposals"], "$.proposals")
    if len(proposals) > MAX_MEMORY_PROPOSALS:
        raise MemoryProposalParseError(
            "proposal_limit_exceeded",
            "$.proposals",
            f"at most {MAX_MEMORY_PROPOSALS} proposals are accepted",
        )

    parsed = tuple(
        _parse_proposal(proposal, f"$.proposals[{index}]")
        for index, proposal in enumerate(proposals)
    )
    return MemoryProposalBatch(schema_version=schema_version, proposals=parsed)


def parse_proposal_batch(model_json: str) -> MemoryProposalBatch:
    """Short alias for :func:`parse_memory_proposal_batch`."""

    return parse_memory_proposal_batch(model_json)


def _load_json(model_json: str) -> Any:
    try:
        return json.loads(
            model_json,
            object_pairs_hook=_object_without_duplicate_fields,
            parse_constant=_reject_non_finite_number,
        )
    except MemoryProposalParseError:
        raise
    except (json.JSONDecodeError, RecursionError, ValueError) as error:
        raise MemoryProposalParseError("invalid_json", "$", str(error)) from error


def _object_without_duplicate_fields(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise MemoryProposalParseError(
                "schema_duplicate_field", "$", f"duplicate field {key!r}"
            )
        result[key] = value
    return result


def _reject_non_finite_number(value: str) -> Any:
    raise MemoryProposalParseError(
        "invalid_json", "$", f"non-finite number {value!r} is not allowed"
    )


def _parse_proposal(raw: Any, path: str) -> MemoryProposal:
    proposal = _object(raw, path)
    if "action" not in proposal:
        raise MemoryProposalParseError(
            "schema_missing_field", path, "missing field 'action'"
        )
    action_value = _string(proposal["action"], f"{path}.action")
    try:
        action = MemoryProposalAction(action_value)
    except ValueError as error:
        raise MemoryProposalParseError(
            "unknown_action", f"{path}.action", f"unsupported action {action_value!r}"
        ) from error

    _require_exact_fields(proposal, _ACTION_FIELDS[action], path)
    if action is MemoryProposalAction.NOOP:
        return NoopProposal()
    if action is MemoryProposalAction.ADD:
        return _parse_add(proposal, path)
    if action is MemoryProposalAction.REFINE:
        return _parse_refine(proposal, path)
    if action is MemoryProposalAction.SUPERSEDE:
        return _parse_supersede(proposal, path)
    return TargetProposal(
        action=action,
        target_memory_id=_target_memory_id(proposal["targetMemoryId"], path),
        evidence_observation_ids=_evidence_ids(
            proposal["evidenceObservationIds"], path
        ),
    )


def _parse_add(proposal: dict[str, Any], path: str) -> AddProposal:
    namespace = _namespace(proposal["namespace"], f"{path}.namespace")
    return AddProposal(
        namespace=namespace,
        canonical_key=_canonical_key(
            proposal["canonicalKey"], namespace, f"{path}.canonicalKey"
        ),
        scope=_scope(proposal["scope"], f"{path}.scope"),
        statement=_statement(proposal["statement"], f"{path}.statement"),
        evidence_observation_ids=_evidence_ids(
            proposal["evidenceObservationIds"], path
        ),
    )


def _parse_refine(proposal: dict[str, Any], path: str) -> RefineProposal:
    return RefineProposal(
        target_memory_id=_target_memory_id(proposal["targetMemoryId"], path),
        proposed_statement=_statement(
            proposal["proposedStatement"], f"{path}.proposedStatement"
        ),
        evidence_observation_ids=_evidence_ids(
            proposal["evidenceObservationIds"], path
        ),
    )


def _parse_supersede(proposal: dict[str, Any], path: str) -> SupersedeProposal:
    namespace = _namespace(proposal["namespace"], f"{path}.namespace")
    return SupersedeProposal(
        target_memory_id=_target_memory_id(proposal["targetMemoryId"], path),
        namespace=namespace,
        canonical_key=_canonical_key(
            proposal["canonicalKey"], namespace, f"{path}.canonicalKey"
        ),
        scope=_scope(proposal["scope"], f"{path}.scope"),
        proposed_statement=_statement(
            proposal["proposedStatement"], f"{path}.proposedStatement"
        ),
        evidence_observation_ids=_evidence_ids(
            proposal["evidenceObservationIds"], path
        ),
    )


def _require_exact_fields(
    value: dict[str, Any], expected: frozenset[str], path: str
) -> None:
    unknown = sorted(set(value).difference(expected))
    if unknown:
        raise MemoryProposalParseError(
            "schema_unknown_field", path, f"unknown fields: {unknown!r}"
        )
    missing = sorted(expected.difference(value))
    if missing:
        raise MemoryProposalParseError(
            "schema_missing_field", path, f"missing fields: {missing!r}"
        )


def _object(value: Any, path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise MemoryProposalParseError(
            "schema_type_error", path, "expected an object"
        )
    return value


def _array(value: Any, path: str) -> list[Any]:
    if not isinstance(value, list):
        raise MemoryProposalParseError("schema_type_error", path, "expected an array")
    return value


def _string(value: Any, path: str) -> str:
    if not isinstance(value, str):
        raise MemoryProposalParseError("schema_type_error", path, "expected a string")
    return value


def _namespace(value: Any, path: str) -> MemoryNamespace:
    namespace = _string(value, path)
    try:
        return MemoryNamespace(namespace)
    except ValueError as error:
        raise MemoryProposalParseError(
            "invalid_namespace", path, f"unsupported namespace {namespace!r}"
        ) from error


def _canonical_key(value: Any, namespace: MemoryNamespace, path: str) -> str:
    canonical_key = _string(value, path)
    if _utf8_size(canonical_key, path) > MAX_MEMORY_KEY_BYTES:
        raise MemoryProposalParseError(
            "string_limit_exceeded",
            path,
            f"canonicalKey exceeds {MAX_MEMORY_KEY_BYTES} UTF-8 bytes",
        )
    if _CANONICAL_KEY_PATTERN.fullmatch(canonical_key) is None:
        raise MemoryProposalParseError(
            "invalid_canonical_key", path, "canonicalKey has an invalid shape"
        )
    if canonical_key.partition(".")[0] != namespace.value:
        raise MemoryProposalParseError(
            "canonical_key_namespace_mismatch",
            path,
            "canonicalKey must begin with the declared namespace",
        )
    return canonical_key


def _statement(value: Any, path: str) -> str:
    statement = _string(value, path)
    if not statement.strip():
        raise MemoryProposalParseError(
            "invalid_statement", path, "statement must not be empty"
        )
    if _utf8_size(statement, path) > MAX_MEMORY_STATEMENT_BYTES:
        raise MemoryProposalParseError(
            "string_limit_exceeded",
            path,
            f"statement exceeds {MAX_MEMORY_STATEMENT_BYTES} UTF-8 bytes",
        )
    return statement


def _scope(value: Any, path: str) -> ActivityScope:
    scope = _object(value, path)
    _require_exact_fields(scope, frozenset({"type", "key"}), path)
    scope_type = _string(scope["type"], f"{path}.type")
    if scope_type != "activity":
        raise MemoryProposalParseError(
            "invalid_scope", f"{path}.type", "scope type must be 'activity'"
        )
    activity_value = _string(scope["key"], f"{path}.key")
    try:
        activity = Activity(activity_value)
    except ValueError as error:
        raise MemoryProposalParseError(
            "invalid_scope",
            f"{path}.key",
            "activity key must be 'reading' or 'writing'",
        ) from error
    return ActivityScope(key=activity)


def _target_memory_id(value: Any, proposal_path: str) -> str:
    path = f"{proposal_path}.targetMemoryId"
    target_memory_id = _string(value, path)
    if _MEMORY_ID_PATTERN.fullmatch(target_memory_id) is None:
        raise MemoryProposalParseError(
            "invalid_memory_id", path, "targetMemoryId must be a stable mem-* ID"
        )
    return target_memory_id


def _evidence_ids(value: Any, proposal_path: str) -> tuple[str, ...]:
    path = f"{proposal_path}.evidenceObservationIds"
    evidence = _array(value, path)
    if not evidence:
        raise MemoryProposalParseError(
            "evidence_required", path, "at least one observation ID is required"
        )
    if len(evidence) > MAX_MEMORY_EVIDENCE_IDS:
        raise MemoryProposalParseError(
            "evidence_limit_exceeded",
            path,
            f"at most {MAX_MEMORY_EVIDENCE_IDS} observation IDs are accepted",
        )
    parsed: list[str] = []
    seen: set[str] = set()
    for index, value in enumerate(evidence):
        item_path = f"{path}[{index}]"
        observation_id = _string(value, item_path)
        if _OBSERVATION_ID_PATTERN.fullmatch(observation_id) is None:
            raise MemoryProposalParseError(
                "invalid_observation_id",
                item_path,
                "evidence ID must be a stable obs-* ID",
            )
        if observation_id in seen:
            raise MemoryProposalParseError(
                "duplicate_observation_id",
                item_path,
                "evidence IDs must be unique within a proposal",
            )
        seen.add(observation_id)
        parsed.append(observation_id)
    return tuple(parsed)


def _utf8_size(value: str, path: str) -> int:
    try:
        return len(value.encode("utf-8"))
    except UnicodeEncodeError as error:
        raise MemoryProposalParseError(
            "invalid_string", path, "string is not valid Unicode"
        ) from error
