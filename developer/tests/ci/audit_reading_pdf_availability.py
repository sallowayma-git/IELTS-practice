#!/usr/bin/env python3
"""Compare the reading manifest with an explicitly supplied optional PDF root.

The public checkout intentionally omits ``ReadingPractice/PDF``.  Consequently,
this audit never guesses a resource root and never treats an absent repository
directory as evidence that manifest entries are unavailable.  Pass
``--pdf-root <path-to-ReadingPractice/PDF>`` to perform the read-only audit.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
DEFAULT_MANIFEST = ROOT / "assets" / "generated" / "reading-exams" / "manifest.js"
MANIFEST_MARKER = "const manifest ="
PDF_PREFIX = ("ReadingPractice", "PDF")


def load_manifest(path: Path) -> dict[str, dict[str, Any]]:
    source = path.read_text(encoding="utf-8")
    marker_index = source.find(MANIFEST_MARKER)
    if marker_index < 0:
        raise ValueError(f"manifest marker not found: {MANIFEST_MARKER}")
    object_start = source.find("{", marker_index + len(MANIFEST_MARKER))
    if object_start < 0:
        raise ValueError("manifest object not found")
    payload, _ = json.JSONDecoder().raw_decode(source[object_start:])
    if not isinstance(payload, dict):
        raise ValueError("manifest payload is not an object")
    return payload


def relative_pdf_locator(value: Any) -> tuple[str | None, str | None]:
    """Return the path below ReadingPractice/PDF, or a stable rejection reason."""

    if not isinstance(value, str) or not value.strip():
        return None, "empty_pdf_locator"
    locator = value.strip().replace("\\", "/")
    if locator.startswith("/") or re.match(r"^[A-Za-z]:", locator):
        return None, "absolute_pdf_locator"
    parts = locator.split("/")
    if len(parts) < 3 or tuple(parts[:2]) != PDF_PREFIX:
        return None, "outside_reading_pdf_root"
    relative_parts = parts[2:]
    if any(part in {"", ".", ".."} for part in relative_parts):
        return None, "unsafe_pdf_locator"
    if not relative_parts[-1].casefold().endswith(".pdf"):
        return None, "non_pdf_locator"
    return "/".join(relative_parts), None


def discover_pdfs(pdf_root: Path) -> list[str]:
    return sorted(
        path.relative_to(pdf_root).as_posix()
        for path in pdf_root.rglob("*")
        if path.is_file() and path.suffix.casefold() == ".pdf"
    )


def audit(pdf_root: Path, manifest_path: Path = DEFAULT_MANIFEST) -> dict[str, Any]:
    manifest = load_manifest(manifest_path)
    resources = discover_pdfs(pdf_root)
    resource_set = set(resources)
    resources_by_casefold: dict[str, list[str]] = {}
    resources_by_normalized: dict[str, list[str]] = {}
    for resource in resources:
        resources_by_casefold.setdefault(resource.casefold(), []).append(resource)
        normalized_resource = unicodedata.normalize("NFC", resource)
        resources_by_normalized.setdefault(normalized_resource, []).append(resource)

    missing_marked_available: list[dict[str, str]] = []
    present_marked_unavailable: list[dict[str, Any]] = []
    invalid_availability_entries: list[dict[str, Any]] = []
    invalid_locator_entries: list[dict[str, str]] = []
    case_mismatches: list[dict[str, Any]] = []
    normalization_mismatches: list[dict[str, Any]] = []
    referenced_resources: set[str] = set()
    available_count = 0
    unavailable_count = 0

    for manifest_key in sorted(manifest):
        raw_entry = manifest[manifest_key]
        entry = raw_entry if isinstance(raw_entry, dict) else {}
        exam_id = str(entry.get("examId") or manifest_key)
        has_pdf = entry.get("hasPdf")
        pdf_filename = entry.get("pdfFilename")

        if has_pdf is True:
            available_count += 1
        elif has_pdf is False:
            unavailable_count += 1
        else:
            invalid_availability_entries.append({"examId": exam_id, "hasPdf": has_pdf})

        locator, locator_error = relative_pdf_locator(pdf_filename)
        if locator_error:
            if has_pdf is True or (isinstance(pdf_filename, str) and pdf_filename.strip()):
                invalid_locator_entries.append(
                    {
                        "examId": exam_id,
                        "pdfFilename": str(pdf_filename or ""),
                        "reason": locator_error,
                    }
                )
            continue

        assert locator is not None
        exact_present = locator in resource_set
        casefold_matches = [] if exact_present else resources_by_casefold.get(locator.casefold(), [])
        normalized_matches = []
        if not exact_present:
            normalized_locator = unicodedata.normalize("NFC", locator)
            normalized_matches = [
                resource
                for resource in resources_by_normalized.get(normalized_locator, [])
                if resource not in casefold_matches
            ]
        matched_resources = (
            [locator]
            if exact_present
            else list(dict.fromkeys([*casefold_matches, *normalized_matches]))
        )
        present = bool(matched_resources)
        if exact_present:
            referenced_resources.add(locator)
        else:
            referenced_resources.update(matched_resources)
            if casefold_matches:
                case_mismatches.append(
                    {
                        "examId": exam_id,
                        "pdfFilename": str(pdf_filename),
                        "expected": locator,
                        "actual": casefold_matches,
                    }
                )
            if normalized_matches:
                normalization_mismatches.append(
                    {
                        "examId": exam_id,
                        "pdfFilename": str(pdf_filename),
                        "expected": locator,
                        "actual": normalized_matches,
                    }
                )

        if has_pdf is True and not present:
            missing_marked_available.append(
                {"examId": exam_id, "pdfFilename": str(pdf_filename)}
            )
        elif has_pdf is False and present:
            present_marked_unavailable.append(
                {
                    "examId": exam_id,
                    "pdfFilename": str(pdf_filename),
                    "actual": matched_resources,
                }
            )

    mismatch_count = sum(
        len(items)
        for items in (
            missing_marked_available,
            present_marked_unavailable,
            invalid_availability_entries,
            invalid_locator_entries,
            case_mismatches,
            normalization_mismatches,
        )
    )
    return {
        "status": "fail" if mismatch_count else "pass",
        "pdfRoot": str(pdf_root.resolve()),
        "manifestPath": str(manifest_path.resolve()),
        "manifestCounts": {
            "total": len(manifest),
            "available": available_count,
            "unavailable": unavailable_count,
            "invalidAvailability": len(invalid_availability_entries),
        },
        "resourcePdfCount": len(resources),
        "mismatchCount": mismatch_count,
        "missingMarkedAvailable": missing_marked_available,
        "presentMarkedUnavailable": present_marked_unavailable,
        "invalidAvailabilityEntries": invalid_availability_entries,
        "invalidLocatorEntries": invalid_locator_entries,
        "caseMismatches": case_mismatches,
        "normalizationMismatches": normalization_mismatches,
        "unreferencedResources": sorted(resource_set - referenced_resources),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--pdf-root",
        type=Path,
        help="Explicit path to the optional ReadingPractice/PDF directory.",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=DEFAULT_MANIFEST,
        help="Reading manifest to audit (defaults to the repository manifest).",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.pdf_root is None:
        result = {
            "status": "skipped",
            "reason": "pdf_root_not_supplied",
            "detail": "Pass --pdf-root <ReadingPractice/PDF> to audit an explicitly supplied optional collection.",
            "manifestPath": str(args.manifest.resolve()),
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        print("[reading-pdf-availability] SKIP: --pdf-root was not supplied", file=sys.stderr)
        return 0

    pdf_root = args.pdf_root.resolve()
    if not pdf_root.is_dir():
        result = {
            "status": "fail",
            "reason": "pdf_root_not_directory",
            "pdfRoot": str(pdf_root),
            "manifestPath": str(args.manifest.resolve()),
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        print(f"[reading-pdf-availability] FAIL: PDF root is not a directory: {pdf_root}", file=sys.stderr)
        return 2

    try:
        result = audit(pdf_root, args.manifest.resolve())
    except (OSError, ValueError, json.JSONDecodeError) as error:
        result = {
            "status": "fail",
            "reason": "audit_input_error",
            "pdfRoot": str(pdf_root),
            "manifestPath": str(args.manifest.resolve()),
            "detail": str(error),
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        print(f"[reading-pdf-availability] FAIL: {error}", file=sys.stderr)
        return 2

    print(json.dumps(result, ensure_ascii=False, indent=2))
    print(
        f"[reading-pdf-availability] {result['status'].upper()}: "
        f"{result['resourcePdfCount']} resources, {result['mismatchCount']} mismatches",
        file=sys.stderr,
    )
    return 0 if result["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
