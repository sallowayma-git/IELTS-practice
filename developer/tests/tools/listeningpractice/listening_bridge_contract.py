#!/usr/bin/env python3
"""Helpers for keeping imported ListeningPractice pages on the bridge contract."""

from __future__ import annotations

import os
import re
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
