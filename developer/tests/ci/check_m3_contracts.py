#!/usr/bin/env python3
"""Static contract gate for the M3 Python runtime and memory proposals."""

from __future__ import annotations

import json
import re
import sys
import tomllib
from collections.abc import Iterable, Iterator, Mapping
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
SCHEMA = ROOT / "schemas/memory_proposal/proposal.schema.json"
FIXTURE_DIR = ROOT / "schemas/memory_proposal/fixtures/v1"
PYPROJECT = ROOT / "agent-runtime-python/pyproject.toml"
PYTHON_SOURCE = ROOT / "agent-runtime-python/src"
TAURI_CONFIG = ROOT / "src-tauri/tauri.conf.json"
M3_ADRS = (
    ROOT / "developer/docs/ADR-M3-00A-Python-Cognitive-Runtime-Bootstrap.md",
    ROOT / "developer/docs/ADR-M3-01-Memory-Proposal-Validator.md",
)

EXPECTED_NAMESPACES = frozenset(
    {
        "knowledge",
        "language",
        "strategy",
        "behavior",
        "metacognition",
        "preference",
        "goal",
    }
)
EXPECTED_ACTIONS = frozenset(
    {
        "ADD",
        "REINFORCE",
        "REFINE",
        "IMPROVE",
        "REGRESS",
        "CONTRADICT",
        "SUPERSEDE",
        "ARCHIVE",
        "NOOP",
    }
)
FORBIDDEN_DEPENDENCY_FRAGMENTS = ("sqlite", "keyring")
# Core cognitive runtime tokens that must never appear anywhere in the Python
# source. `sqlite3` is intentionally absent here: the M5 retrieval package is
# explicitly authorized to own a derived disposable index (retrieval_v1.sqlite)
# per engineering plan §M5-02. It is gated separately via RETRIEVAL_ALLOWED_TOKEN.
FORBIDDEN_SOURCE_TOKENS = ("keyring", "v2.db", "tauri internal")
# The retrieval package may use sqlite3 for its derived index, but must never
# touch canonical DB paths, credentials, or keyring regardless of location.
RETRIEVAL_PACKAGE = Path("ielts_agent") / "retrieval"
PLANNER_PACKAGE = Path("ielts_agent") / "planner"
RETRIEVAL_FORBIDDEN_TOKENS = ("keyring", "v2.db", "tauri internal", "getpass")


def display_path(path: Path) -> str:
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return str(path)


def fail(message: str, failures: list[str]) -> None:
    failures.append(message)


def load_json(path: Path, failures: list[str]) -> Any | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(f"{display_path(path)}: file is missing", failures)
    except UnicodeDecodeError as error:
        fail(f"{display_path(path)}: is not valid UTF-8 ({error})", failures)
    except json.JSONDecodeError as error:
        fail(
            f"{display_path(path)}:{error.lineno}:{error.colno}: invalid JSON: {error.msg}",
            failures,
        )
    except OSError as error:
        fail(f"{display_path(path)}: cannot be read: {error}", failures)
    return None


def walk_json(value: Any, location: str = "$") -> Iterator[tuple[str, Any]]:
    yield location, value
    if isinstance(value, Mapping):
        for key, child in value.items():
            yield from walk_json(child, f"{location}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from walk_json(child, f"{location}[{index}]")


def is_legacy_index_field(name: str) -> bool:
    normalized = re.sub(r"[^a-z0-9]", "", name.casefold())
    return normalized == "index" or normalized.endswith(("index", "indices"))


def schema_field_names(schema: Mapping[str, Any]) -> Iterator[tuple[str, str]]:
    for location, node in walk_json(schema):
        if not isinstance(node, Mapping):
            continue
        properties = node.get("properties")
        if isinstance(properties, Mapping):
            for field_name in properties:
                if isinstance(field_name, str):
                    yield f"{location}.properties", field_name
        required = node.get("required")
        if isinstance(required, list):
            for field_name in required:
                if isinstance(field_name, str):
                    yield f"{location}.required", field_name


def check_exact_strings(
    actual: Any,
    expected: frozenset[str],
    label: str,
    failures: list[str],
) -> None:
    if not isinstance(actual, list) or any(not isinstance(item, str) for item in actual):
        fail(f"{label}: expected a string array, got {actual!r}", failures)
        return
    if len(actual) != len(expected) or set(actual) != expected:
        fail(
            f"{label}: expected {sorted(expected)!r}, got {actual!r}",
            failures,
        )


def collect_actions(proposal_schema: Any, failures: list[str]) -> list[str]:
    if not isinstance(proposal_schema, Mapping):
        fail("proposal.schema.json:$defs.proposal: object definition is missing", failures)
        return []
    variants = proposal_schema.get("oneOf")
    if not isinstance(variants, list) or not variants:
        fail("proposal.schema.json:$defs.proposal.oneOf: variants are missing", failures)
        return []

    actions: list[str] = []
    for index, variant in enumerate(variants):
        action_schema = None
        if isinstance(variant, Mapping):
            properties = variant.get("properties")
            if isinstance(properties, Mapping):
                action_schema = properties.get("action")
        if not isinstance(action_schema, Mapping):
            fail(
                f"proposal.schema.json:$defs.proposal.oneOf[{index}]: action constraint is missing",
                failures,
            )
            continue
        if "const" in action_schema:
            values = [action_schema["const"]]
        else:
            values = action_schema.get("enum")
        if not isinstance(values, list) or any(not isinstance(item, str) for item in values):
            fail(
                f"proposal.schema.json:$defs.proposal.oneOf[{index}].properties.action: "
                f"expected string const/enum, got {action_schema!r}",
                failures,
            )
            continue
        actions.extend(values)
    return actions


def check_schema(failures: list[str]) -> None:
    schema = load_json(SCHEMA, failures)
    if schema is None:
        return
    if not isinstance(schema, Mapping):
        fail(f"{display_path(SCHEMA)}: root must be a JSON object", failures)
        return

    properties = schema.get("properties")
    properties = properties if isinstance(properties, Mapping) else {}
    version_schema = properties.get("schemaVersion")
    version = version_schema.get("const") if isinstance(version_schema, Mapping) else None
    if isinstance(version, bool) or version != 1:
        fail("proposal.schema.json: schemaVersion must be constrained with const=1", failures)

    proposals_schema = properties.get("proposals")
    proposals_schema = proposals_schema if isinstance(proposals_schema, Mapping) else {}
    max_items = proposals_schema.get("maxItems")
    if isinstance(max_items, bool) or max_items != 32:
        fail("proposal.schema.json: proposals.maxItems must equal 32", failures)

    definitions = schema.get("$defs")
    definitions = definitions if isinstance(definitions, Mapping) else {}
    namespace_schema = definitions.get("namespace")
    namespaces = namespace_schema.get("enum") if isinstance(namespace_schema, Mapping) else None
    check_exact_strings(
        namespaces,
        EXPECTED_NAMESPACES,
        "proposal.schema.json:$defs.namespace.enum",
        failures,
    )

    actions = collect_actions(definitions.get("proposal"), failures)
    check_exact_strings(
        actions,
        EXPECTED_ACTIONS,
        "proposal.schema.json:$defs.proposal actions",
        failures,
    )

    object_count = 0
    for location, node in walk_json(schema):
        if not isinstance(node, Mapping) or node.get("type") != "object":
            continue
        object_count += 1
        if node.get("additionalProperties") is not False:
            fail(
                f"proposal.schema.json:{location}: object must set additionalProperties=false",
                failures,
            )
    if object_count == 0:
        fail("proposal.schema.json: no object schemas were found", failures)

    for location, field_name in set(schema_field_names(schema)):
        if is_legacy_index_field(field_name):
            fail(
                f"proposal.schema.json:{location}: legacy index field {field_name!r} is forbidden",
                failures,
            )


def fixture_fields(value: Any, location: str = "$") -> Iterator[tuple[str, str]]:
    if isinstance(value, Mapping):
        for key, child in value.items():
            if isinstance(key, str):
                yield location, key
                yield from fixture_fields(child, f"{location}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from fixture_fields(child, f"{location}[{index}]")


def check_fixture(path: Path, failures: list[str]) -> None:
    fixture = load_json(path, failures)
    if fixture is None:
        return
    prefix = display_path(path)
    if not isinstance(fixture, Mapping):
        fail(f"{prefix}: root must be a JSON object", failures)
        return

    version = fixture.get("schemaVersion")
    if isinstance(version, bool) or version != 1:
        fail(f"{prefix}: schemaVersion must equal 1", failures)
    proposals = fixture.get("proposals")
    if not isinstance(proposals, list):
        fail(f"{prefix}: proposals must be an array", failures)
    else:
        if len(proposals) > 32:
            fail(f"{prefix}: proposals contains {len(proposals)} items; maximum is 32", failures)
        for index, proposal in enumerate(proposals):
            if not isinstance(proposal, Mapping):
                fail(f"{prefix}:$.proposals[{index}] must be an object", failures)
                continue
            action = proposal.get("action")
            if action not in EXPECTED_ACTIONS:
                fail(f"{prefix}:$.proposals[{index}].action is invalid: {action!r}", failures)
            namespace = proposal.get("namespace")
            if namespace is not None and namespace not in EXPECTED_NAMESPACES:
                fail(
                    f"{prefix}:$.proposals[{index}].namespace is invalid: {namespace!r}",
                    failures,
                )

    for location, field_name in fixture_fields(fixture):
        if is_legacy_index_field(field_name):
            fail(
                f"{prefix}:{location}: legacy index field {field_name!r} is forbidden",
                failures,
            )


def check_fixtures(failures: list[str]) -> None:
    if not FIXTURE_DIR.is_dir():
        fail(f"{display_path(FIXTURE_DIR)}: fixture directory is missing", failures)
        return
    fixtures = sorted(FIXTURE_DIR.glob("*.json"))
    if not fixtures:
        fail(f"{display_path(FIXTURE_DIR)}: no v1 JSON fixtures found", failures)
        return
    for path in fixtures:
        check_fixture(path, failures)


def flatten_strings(value: Any) -> Iterator[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, Mapping):
        for key, child in value.items():
            if isinstance(key, str):
                yield key
            yield from flatten_strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from flatten_strings(child)


def dependency_specs(config: Mapping[str, Any]) -> Iterator[str]:
    def visit(node: Any) -> Iterator[str]:
        if not isinstance(node, Mapping):
            return
        for key, value in node.items():
            normalized = str(key).casefold().replace("_", "-")
            dependency_block = (
                normalized == "dependencies"
                or normalized.endswith("-dependencies")
                or normalized == "dependency-groups"
                or normalized == "requires"
            )
            if dependency_block:
                yield from flatten_strings(value)
            else:
                yield from visit(value)

    yield from visit(config)


def check_pyproject(failures: list[str]) -> None:
    try:
        with PYPROJECT.open("rb") as handle:
            config = tomllib.load(handle)
    except FileNotFoundError:
        fail(f"{display_path(PYPROJECT)}: file is missing", failures)
        return
    except tomllib.TOMLDecodeError as error:
        fail(f"{display_path(PYPROJECT)}: invalid TOML: {error}", failures)
        return
    except OSError as error:
        fail(f"{display_path(PYPROJECT)}: cannot be read: {error}", failures)
        return

    for spec in dependency_specs(config):
        lowered = spec.casefold()
        match = next(
            (fragment for fragment in FORBIDDEN_DEPENDENCY_FRAGMENTS if fragment in lowered),
            None,
        )
        if match:
            fail(
                f"{display_path(PYPROJECT)}: forbidden dependency declaration {spec!r} "
                f"contains {match!r}",
                failures,
            )


def matching_lines(text: str, needle: str) -> Iterable[int]:
    lowered_needle = needle.casefold()
    for line_number, line in enumerate(text.splitlines(), start=1):
        if lowered_needle in line.casefold():
            yield line_number


def check_python_source(failures: list[str]) -> None:
    if not PYTHON_SOURCE.is_dir():
        fail(f"{display_path(PYTHON_SOURCE)}: source directory is missing", failures)
        return
    sources = sorted(PYTHON_SOURCE.rglob("*.py"))
    if not sources:
        fail(f"{display_path(PYTHON_SOURCE)}: no Python source files found", failures)
        return
    for path in sources:
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as error:
            fail(f"{display_path(path)}: cannot be read as UTF-8: {error}", failures)
            continue
        is_retrieval = RETRIEVAL_PACKAGE in path.relative_to(PYTHON_SOURCE).parents
        is_planner = PLANNER_PACKAGE in path.relative_to(PYTHON_SOURCE).parents
        is_orchestration = is_retrieval or is_planner
        # sqlite3 is allowed only inside orchestration packages (retrieval derived
        # index; planner is a Python orchestration package accessing host gateway).
        tokens = list(RETRIEVAL_FORBIDDEN_TOKENS if is_orchestration else FORBIDDEN_SOURCE_TOKENS)
        if not is_orchestration:
            tokens.append("sqlite3")
        for token in tokens:
            for line_number in matching_lines(text, token):
                fail(
                    f"{display_path(path)}:{line_number}: forbidden source token {token!r}",
                    failures,
                )


def check_tauri_config(failures: list[str]) -> None:
    config = load_json(TAURI_CONFIG, failures)
    if config is None:
        return
    if not isinstance(config, Mapping):
        fail(f"{display_path(TAURI_CONFIG)}: root must be a JSON object", failures)
        return
    bundle = config.get("bundle")
    bundle = bundle if isinstance(bundle, Mapping) else {}
    external_bin = bundle.get("externalBin")
    if external_bin != ["binaries/ielts-agent-runtime"]:
        fail(
            f"{display_path(TAURI_CONFIG)}: externalBin must contain only the fixed M3 runtime",
            failures,
        )


def check_m3_adrs(failures: list[str]) -> None:
    for path in M3_ADRS:
        try:
            if not path.read_text(encoding="utf-8").strip():
                fail(f"{display_path(path)}: M3 ADR is empty", failures)
        except FileNotFoundError:
            fail(f"{display_path(path)}: M3 ADR is missing", failures)
        except (OSError, UnicodeDecodeError) as error:
            fail(f"{display_path(path)}: M3 ADR cannot be read as UTF-8: {error}", failures)


def main() -> int:
    failures: list[str] = []
    check_schema(failures)
    check_fixtures(failures)
    check_pyproject(failures)
    check_python_source(failures)
    check_tauri_config(failures)
    check_m3_adrs(failures)
    if failures:
        print("M3 contract gate failed:", file=sys.stderr)
        for item in failures:
            print(f"- {item}", file=sys.stderr)
        return 1
    print("M3 contract gate passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
