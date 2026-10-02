#!/usr/bin/env python3
"""Helpers for keeping imported ListeningPractice pages on the bridge contract."""

from __future__ import annotations

import os
import re
import json
from pathlib import Path


BRIDGE_FILENAME = "listening-record-bridge.bundle.js"
LEGACY_SCRIPT_NAMES = {
    "practice-page-enhancer.js",
    "practice-page-enhancer.bundle.js",
    "listeningrecordbridge.js",
    "listening-record-bridge.js",
    BRIDGE_FILENAME,
}
EXTERNAL_SCRIPT_RE = re.compile(
    r"<script\b(?P<attrs>[^>]*)>.*?</script\s*>",
    re.IGNORECASE | re.DOTALL,
)
SRC_ATTR_RE = re.compile(
    r"\bsrc\s*=\s*(?P<quote>['\"])(?P<src>.*?)(?P=quote)",
    re.IGNORECASE | re.DOTALL,
)
BOOTSTRAP_RE = re.compile(r"<!-- LISTENING_DIAGNOSTICS_START -->.*?<!-- LISTENING_DIAGNOSTICS_END -->(?:\r?\n)?", re.DOTALL)


def ensure_early_diagnostics(html_text: str, html_path: Path, bridge_target: Path) -> str:
    """Instrument a controlled local import before dependencies, without copying content.

    The bundle builder owns the reusable inline payload. Runtime injection into an
    already running page instead uses the bundle's late-injection coverage.
    """
    payload_path = Path(__file__).resolve().parents[4] / "assets/generated/diagnostics/bootstrap-inline.js"
    payload = payload_path.read_text(encoding="utf-8")
    if re.search(r"</script", payload, re.IGNORECASE):
        raise ValueError("Unsafe diagnostic bootstrap payload")
    options = {
        "context": "listening", "entryCoverage": {"entry": "listening-bridge", "capture": "before-dependencies"},
        "optionalMedia": True,
        "requiredResources": ["js/bundles/listening-record-bridge.bundle.js", "css/incident-center.css"],
    }
    css = relative_bridge_src(html_path, bridge_target.parent.parent.parent / "css/incident-center.css")
    block = ("<!-- LISTENING_DIAGNOSTICS_START -->\n<script>\n" + payload
             + "\nglobalThis.AppDiagnosticBootstrap.install(" + json.dumps(options) + ");\n</script>\n"
             + f'<link rel="stylesheet" href="{css}">\n<!-- LISTENING_DIAGNOSTICS_END -->\n')
    clean = BOOTSTRAP_RE.sub("", html_text)
    head = re.search(r"<head\b[^>]*>", clean, re.IGNORECASE)
    if head:
        tail = clean[head.end():]
        # Keep encoding discoverable within the first 1024 bytes. The reusable
        # bootstrap is large; placing it before charset corrupts local UTF-8 pages.
        head_content = re.split(r"</head\s*>", tail, maxsplit=1, flags=re.IGNORECASE)[0]
        encoding = re.search(r"<meta\b[^>]*\bcharset\s*=[^>]*>", head_content, re.IGNORECASE)
        charset = encoding.group(0) if encoding else '<meta charset="utf-8">'
        if encoding:
            tail = tail[:encoding.start()] + tail[encoding.end():]
        return clean[:head.end()] + charset + block + tail
    html = re.search(r"<html\b[^>]*>", clean, re.IGNORECASE)
    at = html.end() if html else 0
    return clean[:at] + '<head><meta charset="utf-8">' + block + "</head>" + clean[at:]


def _script_name(src: str) -> str:
    clean = str(src or "").split("?", 1)[0].split("#", 1)[0]
    return clean.replace("\\", "/").rsplit("/", 1)[-1].lower()


def relative_bridge_src(html_path: Path, bridge_target: Path) -> str:
    """Return a browser-safe relative URL from an HTML file to the bridge bundle."""
    relative = os.path.relpath(bridge_target.resolve(), start=html_path.parent.resolve())
    return relative.replace(os.sep, "/")


def ensure_static_bridge(
    html_text: str,
    html_path: Path,
    bridge_target: Path,
) -> tuple[str, bool, str]:
    """Replace legacy/duplicate bridge tags with one canonical tag before ``</body>``.

    The operation is idempotent and intentionally leaves unrelated external scripts
    untouched.  Returning the canonical ``src`` makes reports and tests explicit.
    """
    canonical_src = relative_bridge_src(html_path, bridge_target)
    canonical_tag = (
        f'<script src="{canonical_src}" '
        'data-listening-record-bridge="true"></script>'
    )

    matches = []
    for match in EXTERNAL_SCRIPT_RE.finditer(html_text):
        src_match = SRC_ATTR_RE.search(match.group("attrs") or "")
        if src_match and _script_name(src_match.group("src")) in LEGACY_SCRIPT_NAMES:
            matches.append(match)

    without_old = html_text
    for match in reversed(matches):
        without_old = without_old[: match.start()] + without_old[match.end() :]

    close_tag = re.search(r"</body\s*>", without_old, re.IGNORECASE)
    if not close_tag:
        close_tag = re.search(r"</html\s*>", without_old, re.IGNORECASE)
    if close_tag:
        insert_at = close_tag.start()
        prefix = without_old[:insert_at].rstrip()
        suffix = without_old[insert_at:].lstrip()
        updated = f"{prefix}\n{canonical_tag}\n{suffix}"
    else:
        updated = f"{without_old.rstrip()}\n{canonical_tag}\n"

    updated = ensure_early_diagnostics(updated, html_path, bridge_target)
    return updated, updated != html_text, canonical_src


def ensure_static_bridge_tree(root: Path, bridge_target: Path) -> tuple[int, int]:
    """Apply the bridge contract to every HTML file below ``root``."""
    scanned = 0
    changed = 0
    for html_path in sorted(root.rglob("*.html")):
        scanned += 1
        original = html_path.read_text(encoding="utf-8-sig")
        updated, did_change, _ = ensure_static_bridge(original, html_path, bridge_target)
        if did_change:
            html_path.write_text(updated, encoding="utf-8")
            changed += 1
    return scanned, changed
