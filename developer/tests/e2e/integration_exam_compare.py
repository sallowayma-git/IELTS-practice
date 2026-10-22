"""Compare frozen exam routes with a separately built reference on this host.

Never rewrites the tracked CI baseline. Uses the existing 18-shot freeze gates.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import exam_freeze_visual_check as freeze


def capture_dist(dist: Path, output: Path):
    if not (dist / "index.html").is_file():
        raise RuntimeError(f"missing built frontend: {dist}")
    output = output.resolve()
    if not output.is_relative_to((freeze.ROOT / "developer/tests/e2e/reports").resolve()):
        raise RuntimeError("capture output must remain under test reports")
    freeze.DIST, freeze.CURRENT = dist, output
    process, base = freeze.serve()
    try:
        return freeze.capture(base)
    finally:
        process.kill()
        process.wait(timeout=10)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference-dist", type=Path, required=True)
    args = parser.parse_args()
    report_dir = freeze.ROOT / "developer/tests/e2e/reports/integration-exam"
    names, reference_env = capture_dist(args.reference_dist.resolve(), report_dir / "reference")
    freeze.BASELINE = freeze.CURRENT
    candidate_names, candidate_env = capture_dist(freeze.ROOT / "dist/writing", report_dir / "candidate")
    assert names == candidate_names
    results = freeze.compare(names)
    report = {
        "status": "passed" if all(result["status"] == "identical" for result in results) else "failed",
        "referenceDist": str(args.reference_dist.resolve()),
        "referenceEnv": reference_env, "candidateEnv": candidate_env, "results": results,
    }
    (report_dir / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"status": report["status"], "shots": len(results),
                      "changed": [row for row in results if row["status"] != "identical"]}, indent=2))
    return int(report["status"] != "passed")


if __name__ == "__main__":
    raise SystemExit(main())
