from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import tempfile
import unicodedata
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
AUDIT_PATH = REPO_ROOT / "developer" / "tests" / "ci" / "audit_reading_pdf_availability.py"
SPEC = importlib.util.spec_from_file_location("audit_reading_pdf_availability", AUDIT_PATH)
assert SPEC is not None and SPEC.loader is not None
audit_tool = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(audit_tool)


class ReadingPdfAvailabilityAuditTest(unittest.TestCase):
    def run_main(self, argv: list[str]) -> tuple[int, dict, str]:
        stdout = io.StringIO()
        stderr = io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            exit_code = audit_tool.main(argv)
        return exit_code, json.loads(stdout.getvalue()), stderr.getvalue()

    @staticmethod
    def write_manifest(path: Path, entries: dict) -> None:
        path.write_text(
            f"(function () {{\n  const manifest = {json.dumps(entries, ensure_ascii=False)};\n}})();\n",
            encoding="utf-8",
        )

    def test_missing_pdf_root_skips_without_reading_the_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            missing_manifest = Path(temp_dir) / "does-not-exist.js"
            exit_code, payload, stderr = self.run_main(["--manifest", str(missing_manifest)])

        self.assertEqual(exit_code, 0)
        self.assertEqual(payload["status"], "skipped")
        self.assertEqual(payload["reason"], "pdf_root_not_supplied")
        self.assertIn("--pdf-root was not supplied", stderr)

    def test_matching_explicit_resource_root_passes(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            pdf_root = workspace / "ReadingPractice" / "PDF"
            pdf_root.mkdir(parents=True)
            (pdf_root / "Available.pdf").write_bytes(b"%PDF fixture")
            (pdf_root / "Unreferenced.PDF").write_bytes(b"%PDF fixture")
            manifest = workspace / "manifest.js"
            self.write_manifest(
                manifest,
                {
                    "available": {
                        "examId": "available",
                        "hasPdf": True,
                        "pdfFilename": "ReadingPractice/PDF/Available.pdf",
                    },
                    "missing-by-contract": {
                        "examId": "missing-by-contract",
                        "hasPdf": False,
                        "pdfFilename": "ReadingPractice/PDF/Expected-but-absent.pdf",
                    },
                    "html-only": {
                        "examId": "html-only",
                        "hasPdf": False,
                        "pdfFilename": "",
                    },
                },
            )

            exit_code, payload, _ = self.run_main(
                ["--pdf-root", str(pdf_root), "--manifest", str(manifest)]
            )

        self.assertEqual(exit_code, 0)
        self.assertEqual(payload["status"], "pass")
        self.assertEqual(payload["manifestCounts"], {
            "total": 3,
            "available": 1,
            "unavailable": 2,
            "invalidAvailability": 0,
        })
        self.assertEqual(payload["mismatchCount"], 0)
        self.assertEqual(payload["unreferencedResources"], ["Unreferenced.PDF"])

    def test_reports_both_availability_mismatch_directions(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            pdf_root = workspace / "ReadingPractice" / "PDF"
            pdf_root.mkdir(parents=True)
            (pdf_root / "Unexpected.pdf").write_bytes(b"%PDF fixture")
            manifest = workspace / "manifest.js"
            self.write_manifest(
                manifest,
                {
                    "declared-but-missing": {
                        "examId": "declared-but-missing",
                        "hasPdf": True,
                        "pdfFilename": "ReadingPractice/PDF/Missing.pdf",
                    },
                    "present-but-disabled": {
                        "examId": "present-but-disabled",
                        "hasPdf": False,
                        "pdfFilename": "ReadingPractice/PDF/Unexpected.pdf",
                    },
                },
            )

            exit_code, payload, _ = self.run_main(
                ["--pdf-root", str(pdf_root), "--manifest", str(manifest)]
            )

        self.assertEqual(exit_code, 1)
        self.assertEqual(payload["status"], "fail")
        self.assertEqual(payload["mismatchCount"], 2)
        self.assertEqual(
            [item["examId"] for item in payload["missingMarkedAvailable"]],
            ["declared-but-missing"],
        )
        self.assertEqual(
            [item["examId"] for item in payload["presentMarkedUnavailable"]],
            ["present-but-disabled"],
        )

    def test_reports_unicode_normalization_mismatches_in_both_directions(self) -> None:
        nfd_filename = "Piraha\u0303.pdf"
        nfc_filename = "Pirah\u00e3.pdf"
        self.assertNotEqual(nfd_filename, nfc_filename)
        self.assertEqual(
            unicodedata.normalize("NFC", nfd_filename),
            unicodedata.normalize("NFC", nfc_filename),
        )

        for locator_filename, resource_filename in (
            (nfd_filename, nfc_filename),
            (nfc_filename, nfd_filename),
        ):
            with self.subTest(locator=locator_filename, resource=resource_filename):
                with tempfile.TemporaryDirectory() as temp_dir:
                    workspace = Path(temp_dir)
                    pdf_root = workspace / "ReadingPractice" / "PDF"
                    pdf_root.mkdir(parents=True)
                    (pdf_root / resource_filename).write_bytes(b"%PDF fixture")
                    manifest = workspace / "manifest.js"
                    pdf_filename = f"ReadingPractice/PDF/{locator_filename}"
                    self.write_manifest(
                        manifest,
                        {
                            "normalization-mismatch": {
                                "examId": "normalization-mismatch",
                                "hasPdf": True,
                                "pdfFilename": pdf_filename,
                            },
                        },
                    )

                    exit_code, payload, _ = self.run_main(
                        ["--pdf-root", str(pdf_root), "--manifest", str(manifest)]
                    )

                self.assertEqual(exit_code, 1)
                self.assertEqual(payload["status"], "fail")
                self.assertEqual(payload["mismatchCount"], 1)
                self.assertEqual(payload["missingMarkedAvailable"], [])
                self.assertEqual(payload["caseMismatches"], [])
                self.assertEqual(
                    payload["normalizationMismatches"],
                    [
                        {
                            "examId": "normalization-mismatch",
                            "pdfFilename": pdf_filename,
                            "expected": locator_filename,
                            "actual": [resource_filename],
                        }
                    ],
                )
                self.assertEqual(payload["unreferencedResources"], [])

    def test_supplied_pdf_root_must_be_a_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            missing_root = Path(temp_dir) / "missing-pdf-root"
            exit_code, payload, stderr = self.run_main(["--pdf-root", str(missing_root)])

        self.assertEqual(exit_code, 2)
        self.assertEqual(payload["status"], "fail")
        self.assertEqual(payload["reason"], "pdf_root_not_directory")
        self.assertIn("PDF root is not a directory", stderr)


if __name__ == "__main__":
    unittest.main()
