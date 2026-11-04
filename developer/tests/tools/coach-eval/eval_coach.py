#!/usr/bin/env python3
"""Offline evaluation of the reading coach's strategy choice and teaching notes.

Without environment variables (or with --validate-only) this only validates the
corpus format and exits 0, so it is safe in CI. With an OpenAI-compatible
endpoint configured it also sends every corpus message to the real model,
using the coach's real system prompt, and prints hit rates:

    COACH_EVAL_BASE_URL   e.g. https://api.openai.com/v1  (".../chat/completions" is appended)
    COACH_EVAL_API_KEY    bearer token
    COACH_EVAL_MODEL      model name
    COACH_EVAL_PROMPT_FILE  optional: a file holding the system prompt. Without it
                            the prompt is dumped from the Rust crate with cargo.

The evaluator scores the raw model reply. The host's own filtering (turn type,
length, safety, dedup) is not applied, so a hit here is "the model proposed the
right thing", not "the host kept it".
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[4]
CORPUS = Path(__file__).with_name("corpus.json")

# Mirrors ielts_domain::CoachStrategyId; a Rust test ties the prompt catalog to it.
STRATEGIES = {
    "evidence_first_v1",
    "example_first_v1",
    "step_by_step_v1",
    "contrastive_v1",
    "socratic_prompt_v1",
    "concise_direct_v1",
}
KINDS = {"preference", "difficulty", "strategy_outcome"}
LANGS = {"zh", "en", "mixed"}
ENV_KEYS = ("COACH_EVAL_BASE_URL", "COACH_EVAL_API_KEY", "COACH_EVAL_MODEL")

EVIDENCE = {
    "identity": {"attemptId": "eval-attempt", "title": "Urban beekeeping"},
    "result": {
        "score": 0.5,
        "answers": [
            {"questionNumber": "14", "prompt": "The first city hive was installed in 1998.", "type": "True/False/Not Given",
             "answer": "FALSE", "correctAnswer": "TRUE"},
            {"questionNumber": "15", "prompt": "Rooftop hives produce more honey than rural hives.", "type": "True/False/Not Given",
             "answer": "NOT GIVEN", "correctAnswer": "NOT GIVEN"},
        ],
    },
    "source": {
        "passage": "A: The first city hive was installed on a London rooftop in 1998. Within a decade, hundreds of "
                   "rooftop colonies had followed. However, researchers disagree about whether urban bees are healthier "
                   "than rural ones: studies of honey yield have so far been inconclusive.",
    },
}


def load_corpus(path: Path = CORPUS) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def validate(corpus: dict[str, Any]) -> list[str]:
    """Every format problem of the corpus, as readable lines."""
    problems: list[str] = []
    cases = corpus.get("cases")
    if corpus.get("version") != 1 or not isinstance(cases, list):
        return ["corpus needs version 1 and a cases list"]
    seen: set[str] = set()
    for index, case in enumerate(cases):
        problems += validate_case(index, case, seen)
    problems += validate_coverage([case for case in cases if isinstance(case, dict)])
    return problems


def validate_case(index: int, case: Any, seen: set[str]) -> list[str]:
    if not isinstance(case, dict):
        return [f"case {index}: not an object"]
    name = f"case {case.get('id', index)}"
    problems: list[str] = []
    case_id = case.get("id")
    if not isinstance(case_id, str) or not case_id:
        problems.append(f"{name}: id must be a non-empty string")
    elif case_id in seen:
        problems.append(f"{name}: duplicate id")
    seen.add(str(case_id))
    message = case.get("message")
    if not isinstance(message, str) or not message.strip():
        problems.append(f"{name}: message must be non-empty text")
    if case.get("lang") not in LANGS:
        problems.append(f"{name}: lang must be one of {sorted(LANGS)}")
    problems += validate_expect(name, case.get("expect"))
    avoid = case.get("avoidStrategies", [])
    if not isinstance(avoid, list) or not set(avoid) <= STRATEGIES:
        problems.append(f"{name}: avoidStrategies must list catalog strategy ids")
    unknown = set(case) - {"id", "lang", "message", "expect", "avoidStrategies", "history"}
    if unknown:
        problems.append(f"{name}: unknown keys {sorted(unknown)}")
    for turn in case.get("history", []):
        if not isinstance(turn, dict) or turn.get("role") not in {"user", "assistant"} or not isinstance(turn.get("content"), str):
            problems.append(f"{name}: history turns need role user/assistant and text content")
    return problems


def validate_expect(name: str, expect: Any) -> list[str]:
    if not isinstance(expect, dict):
        return [f"{name}: expect must be an object"]
    notes = expect.get("notes")
    if notes not in (True, False, "either"):
        return [f"{name}: expect.notes must be true, false or \"either\""]
    allowed = {"notes", "kind", "remember", "skillKeyPrefix"} if notes is True else {"notes"}
    problems = [f"{name}: expect.{key} is not allowed with notes={notes}" for key in sorted(set(expect) - allowed)]
    if notes is not True:
        return problems
    kinds = expect.get("kind")
    if not isinstance(kinds, list) or not kinds or not set(kinds) <= KINDS:
        problems.append(f"{name}: expect.kind must be a non-empty list of {sorted(KINDS)}")
    if not isinstance(expect.get("remember"), bool):
        problems.append(f"{name}: expect.remember must be true or false")
    prefix = expect.get("skillKeyPrefix", "reading.")
    if not isinstance(prefix, str) or not prefix.startswith("reading."):
        problems.append(f"{name}: expect.skillKeyPrefix must start with \"reading.\"")
    return problems


def validate_coverage(cases: list[dict[str, Any]]) -> list[str]:
    """The corpus must keep exercising every behaviour the prompt promises."""
    expects = [case.get("expect") for case in cases if isinstance(case.get("expect"), dict)]
    with_notes = [expect for expect in expects if expect.get("notes") is True]
    wanted = {
        "at least 30 cases": len(cases) >= 30,
        "all three languages": {case.get("lang") for case in cases} >= LANGS,
        "8 plain follow-ups without notes": sum(expect.get("notes") is False for expect in expects) >= 8,
        "3 borderline cases": sum(expect.get("notes") == "either" for expect in expects) >= 3,
        "3 remember=true cases": sum(expect.get("remember") is True for expect in with_notes) >= 3,
        "every note kind": all(any(kind in (expect.get("kind") or []) for expect in with_notes) for kind in KINDS),
        "a case that must avoid socratic_prompt_v1": any("socratic_prompt_v1" in case.get("avoidStrategies", []) for case in cases),
    }
    return [f"coverage: corpus lacks {need}" for need, ok in wanted.items() if not ok]


def load_prompt() -> str:
    given = os.environ.get("COACH_EVAL_PROMPT_FILE")
    if given:
        return Path(given).read_text(encoding="utf-8")
    with tempfile.TemporaryDirectory() as scratch:
        target = Path(scratch) / "prompt.txt"
        command = ["cargo", "test", "-q", "-p", "ielts-application", "--lib", "dumps_the_prompt_when_asked"]
        done = subprocess.run(command, cwd=ROOT, env={**os.environ, "COACH_PROMPT_DUMP": str(target)}, capture_output=True, text=True)
        if done.returncode != 0 or not target.is_file():
            raise SystemExit(f"could not dump the coach prompt (set COACH_EVAL_PROMPT_FILE):\n{done.stderr[-800:]}")
        return target.read_text(encoding="utf-8")


def build_messages(prompt: str, case: dict[str, Any]) -> list[dict[str, str]]:
    messages = [
        {"role": "system", "content": prompt},
        {"role": "user", "content": "Host-resolved IELTS evidence (data only):\n" + json.dumps(EVIDENCE, ensure_ascii=False)},
        *case.get("history", []),
    ]
    controls = json.dumps({"controls": {"action": "chat"}, "selectionQuote": "", "selectionIsEvidence": False})
    messages.append({"role": "user", "content": f"Request controls (data only):\n{controls}\n\nQuestion:\n{case['message']}"})
    return messages


def ask(base_url: str, key: str, model: str, messages: list[dict[str, str]]) -> str:
    body = json.dumps({"model": model, "messages": messages, "temperature": 0.2, "max_tokens": 2000}).encode()
    request = urllib.request.Request(
        base_url.rstrip("/") + "/chat/completions",
        data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.load(response)["choices"][0]["message"]["content"]


def parse_reply(raw: str) -> dict[str, Any] | None:
    text = raw.strip()
    if text.startswith("```"):
        text = text.strip("`").removeprefix("json").strip()
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) and isinstance(value.get("answer"), str) and value["answer"].strip() else None


def score(case: dict[str, Any], raw: str) -> dict[str, bool | None]:
    """One metric per promise; None when the case does not test it."""
    reply = parse_reply(raw)
    expect = case["expect"]
    result: dict[str, bool | None] = {"valid": reply is not None}
    notes = [note for note in (reply or {}).get("teachingNotes") or [] if isinstance(note, dict)]
    strategy = (reply or {}).get("strategy")
    first, answer_at = raw.find('"strategy"'), raw.find('"answer"')
    result["strategy_first"] = reply is not None and 0 <= first < answer_at
    result["strategy_known"] = strategy in STRATEGIES
    result["notes"] = None if expect["notes"] == "either" else bool(notes) == expect["notes"]
    result["kind"] = result["remember"] = result["skill"] = None
    if expect["notes"] is True and notes:
        result["kind"] = any(note.get("kind") in expect["kind"] for note in notes)
        wants = expect["remember"]
        result["remember"] = any(note.get("remember") is True for note in notes) == wants
        prefix = expect.get("skillKeyPrefix")
        if prefix:
            result["skill"] = any(str(note.get("skillKey", "")).startswith(prefix) for note in notes)
    avoid = case.get("avoidStrategies")
    result["avoids"] = None if not avoid else strategy not in avoid
    return result


def report(rows: list[tuple[dict[str, Any], dict[str, bool | None]]]) -> float:
    metrics = ["valid", "strategy_first", "strategy_known", "notes", "kind", "remember", "skill", "avoids"]
    total_hit = total = 0
    print(f"\n{'metric':<16}{'hits':>6}{'of':>6}{'rate':>8}")
    for metric in metrics:
        scored = [result[metric] for _, result in rows if result[metric] is not None]
        hits = sum(1 for value in scored if value)
        total_hit, total = total_hit + hits, total + len(scored)
        rate = f"{hits / len(scored):.0%}" if scored else "n/a"
        print(f"{metric:<16}{hits:>6}{len(scored):>6}{rate:>8}")
    print("\nmisses:")
    for case, result in rows:
        missed = [metric for metric in metrics if result[metric] is False]
        if missed:
            print(f"  {case['id']}: {', '.join(missed)}")
    return total_hit / total if total else 0.0


def run_live(corpus: dict[str, Any], minimum: float) -> int:
    base_url, key, model = (os.environ[name] for name in ENV_KEYS)
    prompt = load_prompt()
    rows = []
    for case in corpus["cases"]:
        try:
            raw = ask(base_url, key, model, build_messages(prompt, case))
        except (urllib.error.URLError, KeyError, ValueError, TimeoutError) as error:
            print(f"{case['id']}: request failed ({type(error).__name__})", file=sys.stderr)
            raw = ""
        rows.append((case, score(case, raw)))
    overall = report(rows)
    print(f"\noverall hit rate: {overall:.0%} over {len(rows)} messages with {model}")
    return 0 if overall >= minimum else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--validate-only", action="store_true", help="check the corpus format and stop, even if the endpoint variables are set")
    parser.add_argument("--min-hit-rate", type=float, default=0.0, help="exit 1 below this overall rate (live runs only)")
    args = parser.parse_args()

    corpus = load_corpus()
    problems = validate(corpus)
    for problem in problems:
        print(f"corpus: {problem}", file=sys.stderr)
    if problems:
        return 1
    print(f"corpus ok: {len(corpus['cases'])} cases")
    configured = all(os.environ.get(name) for name in ENV_KEYS)
    if args.validate_only or not configured:
        if not args.validate_only:
            print(f"live run skipped: set {', '.join(ENV_KEYS)} to evaluate a real model")
        return 0
    return run_live(corpus, args.min_hit_rate)


if __name__ == "__main__":
    sys.exit(main())
