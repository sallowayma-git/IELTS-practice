#!/usr/bin/env python3
"""Generate Phase 0 rewrite fixtures and manifests."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def main() -> None:
    exam_root = ROOT / "assets" / "generated" / "reading-exams"
    expl_root = ROOT / "assets" / "generated" / "reading-explanations"
    pilot_path = ROOT / "developer" / "tests" / "fixtures" / "reading-pilot-selection.json"
    pilot = json.loads(pilot_path.read_text(encoding="utf-8"))
    pilot_map = {item["examId"]: item for item in pilot}

    selected = [
        "p3-medium-169",
        "p1-high-01",
        "p2-high-09",
        "p2-medium-10",
        "p2-high-14",
        "p3-high-15",
        "p3-high-32",
        "p3-low-44",
        "p1-high-24",
        "p1-low-02",
        "p2-low-06",
        "p3-low-07",
    ]

    assets = []
    for exam_id in selected:
        path = exam_root / f"{exam_id}.js"
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        fingerprint = hashlib.sha256(text.encode("utf-8", errors="ignore")).hexdigest()[:16]
        title = exam_id
        match = re.search(r'"title"\s*:\s*"([^"]+)"', text)
        if match:
            title = match.group(1)
        signature = list(pilot_map.get(exam_id, {}).get("signature") or [])
        if not signature:
            lowered = text.lower()
            for token in ("radio", "checkbox", "text", "select", "textarea", "dragdrop", "table"):
                if token in lowered:
                    signature.append(token)
        has_expl = (expl_root / f"{exam_id}.js").exists() or (expl_root / f"{exam_id}.json").exists()
        pdf_only = ("无题目" in title) or ("无题" in title) or exam_id == "p3-medium-169"
        assets.append(
            {
                "examId": exam_id,
                "title": title,
                "category": exam_id.split("-")[0].upper(),
                "frequency": exam_id.split("-")[1] if "-" in exam_id else "unknown",
                "signature": signature,
                "hasExplanation": has_expl,
                "pdfOnly": pdf_only,
                "dragdrop": "dragdrop" in signature or "draggable" in text,
                "sourcePath": path.relative_to(ROOT).as_posix(),
                "fingerprint": fingerprint,
                "bytes": path.stat().st_size,
            }
        )

    reading_dir = ROOT / "tests" / "fixtures" / "reading"
    reading_dir.mkdir(parents=True, exist_ok=True)
    reading_manifest = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "purpose": "Phase 0 representative reading assets for rewrite parity tests",
        "assets": assets,
    }
    (reading_dir / "representative-assets.json").write_text(
        json.dumps(reading_manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    writing_dir = ROOT / "tests" / "fixtures" / "writing"
    writing_dir.mkdir(parents=True, exist_ok=True)

    def eval_v3(task_type: str = "task2", degraded: bool = False, failed: bool = False) -> dict:
        if failed:
            return {
                "schemaVersion": "v3",
                "task_type": task_type,
                "status": "failed",
                "score": None,
                "total_score": None,
                "task_achievement": None,
                "coherence_cohesion": None,
                "lexical_resource": None,
                "grammatical_range": None,
                "scorecard": None,
                "feedback": None,
                "overall_feedback": None,
                "task_analysis": None,
                "analysis": None,
                "band_rationale": None,
                "improvement_plan": None,
                "review_blocks": None,
                "paragraph_reviews": None,
                "sentence_errors": None,
                "review_degraded": False,
                "review": None,
                "review_status": None,
                "error": {
                    "code": "PROVIDER_TIMEOUT",
                    "message": "upstream timeout",
                    "retryable": True,
                },
            }

        payload = {
            "schemaVersion": "v3",
            "task_type": task_type,
            "status": "completed",
            "score": {
                "overall": 6.5,
                "taskResponse": 6.5,
                "coherence": 6.0,
                "lexical": 6.5,
                "grammar": 6.0,
            },
            "total_score": 6.5,
            "task_achievement": 6.5,
            "coherence_cohesion": 6.0,
            "lexical_resource": 6.5,
            "grammatical_range": 6.0,
            "scorecard": {"overall": 6.5, "TR": 6.5, "CC": 6.0, "LR": 6.5, "GRA": 6.0},
            "feedback": "Overall the essay addresses the task with adequate organization.",
            "overall_feedback": "Overall the essay addresses the task with adequate organization.",
            "task_analysis": {
                "prompt_response_quality": "Responds to the main prompt",
                "position_clarity": "Position is clear",
                "argument_development": "Arguments are present but generic",
                "conclusion_effectiveness": "Conclusion restates position",
            },
            "analysis": {
                "task_analysis": {
                    "prompt_response_quality": "Responds to the main prompt",
                    "position_clarity": "Position is clear",
                }
            },
            "band_rationale": {
                "task_achievement": "Adequate response but limited support",
                "coherence_cohesion": "Clear paragraphs, weak progression",
                "lexical_resource": "Sufficient range with some repetition",
                "grammatical_range": "Mixed accuracy in complex sentences",
            },
            "improvement_plan": [
                "Strengthen topic sentences with clearer claims",
                "Replace repeated adjectives with precise academic vocabulary",
                "Add one concrete example per body paragraph",
            ],
            "review_blocks": None
            if degraded
            else [
                {"paragraph_index": 0, "summary": "Introduction states position", "issues": []},
                {
                    "paragraph_index": 1,
                    "summary": "Body 1 needs stronger evidence",
                    "issues": ["vague example"],
                },
            ],
            "paragraph_reviews": None
            if degraded
            else [
                {"paragraph_index": 0, "summary": "Introduction states position", "issues": []},
                {
                    "paragraph_index": 1,
                    "summary": "Body 1 needs stronger evidence",
                    "issues": ["vague example"],
                },
            ],
            "sentence_errors": None
            if degraded
            else [
                {
                    "sentence": "People is happy.",
                    "correction": "People are happy.",
                    "type": "grammar",
                }
            ],
            "review_degraded": degraded,
            "review": {"review_degraded": degraded} if degraded else None,
            "review_status": {"degraded": degraded} if degraded else None,
            "error": None,
        }
        return payload

    fixtures = [
        {
            "id": "writing-task2-bank-normal",
            "taskType": "task2",
            "mode": "bank",
            "assetId": "topic-task2-001",
            "status": "completed",
            "degraded": False,
            "prompt": "Some people think universities should focus more on practical skills. Discuss both views and give your opinion.",
            "content": ("Practical skills are essential in modern workplaces. " * 40).strip(),
            "evaluation": eval_v3("task2", degraded=False),
        },
        {
            "id": "writing-task1-bank-normal",
            "taskType": "task1",
            "mode": "bank",
            "assetId": "topic-task1-001",
            "status": "completed",
            "degraded": False,
            "prompt": "The chart below shows energy consumption in four countries. Summarise the information.",
            "content": ("The chart compares energy consumption across four countries. " * 30).strip(),
            "evaluation": eval_v3("task1", degraded=False),
        },
        {
            "id": "writing-task2-freeform-degraded",
            "taskType": "task2",
            "mode": "freeform",
            "assetId": None,
            "status": "completed",
            "degraded": True,
            "prompt": "Is remote work beneficial for society?",
            "content": ("Remote work has changed how people collaborate. " * 35).strip(),
            "evaluation": eval_v3("task2", degraded=True),
        },
        {
            "id": "writing-task2-freeform-failed",
            "taskType": "task2",
            "mode": "freeform",
            "assetId": None,
            "status": "failed",
            "degraded": False,
            "prompt": "Do the advantages of tourism outweigh the disadvantages?",
            "content": ("Tourism boosts local economies. " * 20).strip(),
            "evaluation": eval_v3("task2", failed=True),
        },
        {
            "id": "writing-task1-freeform-normal",
            "taskType": "task1",
            "mode": "freeform",
            "assetId": None,
            "status": "completed",
            "degraded": False,
            "prompt": "The table shows the percentage of households with internet access.",
            "content": ("Overall, internet access rose in all regions. " * 25).strip(),
            "evaluation": eval_v3("task1", degraded=False),
        },
    ]

    for fixture in fixtures:
        path = writing_dir / f"{fixture['id']}.json"
        path.write_text(json.dumps(fixture, ensure_ascii=False, indent=2), encoding="utf-8")

    legacy = {
        "exportDate": "2024-10-01T08:00:00.000Z",
        "version": "1.0.0",
        "source": "legacy-browser-localStorage",
        "data": {
            "practice_records": [
                {
                    "id": "legacy_reading_1",
                    "examId": "p1-high-01",
                    "title": "A Brief History of Tea",
                    "type": "reading",
                    "date": "2024-09-30T09:15:00.000Z",
                    "startTime": "2024-09-30T09:15:00.000Z",
                    "endTime": "2024-09-30T09:40:00.000Z",
                    "duration": 1500,
                    "score": 12,
                    "totalQuestions": 13,
                    "correctAnswers": 12,
                    "realData": {
                        "answers": {"q1": "A", "q2": "TRUE", "q3": "tea"},
                        "markedQuestions": ["q2"],
                    },
                }
            ],
            "settings": {"theme": "dark", "fontSize": 18},
            "vocabulary": [{"word": "beverage", "addedAt": "2024-09-30T09:20:00.000Z"}],
            "notes": [
                {
                    "examId": "p1-high-01",
                    "text": "Focus on timeline markers",
                    "updatedAt": "2024-09-30T09:30:00.000Z",
                }
            ],
        },
    }
    browser_path = (
        ROOT
        / "tests"
        / "fixtures"
        / "legacy-data"
        / "browser-export"
        / "legacy-browser-export-v1.json"
    )
    browser_path.parent.mkdir(parents=True, exist_ok=True)
    browser_path.write_text(json.dumps(legacy, ensure_ascii=False, indent=2), encoding="utf-8")

    archive = {
        "schemaVersion": 1,
        "kind": "reading-archive",
        "exportedAt": "2025-01-15T12:00:00.000Z",
        "records": [
            {
                "id": "ra-001",
                "assetId": "p1-high-01",
                "examId": "p1-high-01",
                "title": "A Brief History of Tea",
                "submittedAt": "2025-01-15T11:55:00.000Z",
                "duration": 1400,
                "scoreInfo": {
                    "correct": 11,
                    "total": 13,
                    "totalQuestions": 13,
                    "accuracy": 0.846,
                    "percentage": 84.6,
                    "duration": 1400,
                },
                "answers": {"q1": "A", "q2": "TRUE"},
                "correctAnswers": {"q1": "A", "q2": "TRUE"},
                "markedQuestions": ["q3"],
                "highlights": [{"text": "tea leaves", "color": "yellow"}],
                "metadata": {
                    "examTitle": "A Brief History of Tea",
                    "practiceMode": "single",
                    "renderMode": "legacy-html",
                },
            }
        ],
    }
    archive_path = (
        ROOT
        / "tests"
        / "fixtures"
        / "legacy-data"
        / "reading-archive"
        / "reading-archive-v1-sample.json"
    )
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    archive_path.write_text(json.dumps(archive, ensure_ascii=False, indent=2), encoding="utf-8")

    schema_note = {
        "schemaVersion": "electron-db-1.0.0",
        "source": "electron/db/schema.sql",
        "tables": [
            "migrations",
            "api_configs",
            "prompts",
            "app_settings",
            "topics",
            "essays",
            "evaluation_sessions",
            "practice_history_records",
            "practice_reading_suite_sessions",
        ],
        "notes": [
            "No production SQLite binary is committed in-repo; Phase 0 records schema path and expected tables.",
            "Migration samples should be generated from a local app data directory when available.",
            "Shadow migration tests will create synthetic DBs from schema.sql + fixtures.",
        ],
    }
    sqlite_path = (
        ROOT / "tests" / "fixtures" / "legacy-data" / "sqlite-samples" / "schema-snapshot.json"
    )
    sqlite_path.parent.mkdir(parents=True, exist_ok=True)
    sqlite_path.write_text(json.dumps(schema_note, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"reading assets: {len(assets)}")
    print(f"writing fixtures: {len(fixtures)}")
    print("legacy fixtures written")


if __name__ == "__main__":
    main()
