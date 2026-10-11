#!/usr/bin/env python3
"""Exam-route visual freeze: the CD-IELTS simulation must not drift.

The reading exam routes (practice, suite, review) are a deliberately frozen
second theme. Shell/skin redesigns must leave them identical.

    python developer/tests/e2e/exam_freeze_visual_check.py
        capture reports/exam-freeze/current/* and compare it to the tracked
        baseline in baselines/exam-freeze/. Exit 1 on any drift. This mode
        never writes the baseline.
    python developer/tests/e2e/exam_freeze_visual_check.py --update-baseline
        the ONLY way to change the baseline. Captures, prints what differs from
        the old baseline, then rewrites just those shots (plus meta.json) and
        drops stale ones. Shots that pass the gates keep their committed bytes,
        so git diffs stay minimal. Run it only against a known-good dist, then
        review and commit the result.

Each exam route is captured twice: as a cold load, and after the Library
route has been visited first (its unscoped stylesheet stays in the document),
so leaks from shell styles into the exam are caught as well.

Gates, per shot (a shot passes only if every gate holds):
  1. style  HARD. Element count and, for every element under #app, the computed
            values of STYLE_PROPS plus its rect (rounded to 0.5 px) must be
            exactly equal to the baseline. No tolerance.
  2. pixels BACKSTOP for what computed styles cannot see (pseudo-elements,
            images, glyph shapes). A pixel counts as different when its largest
            RGB channel delta exceeds PIXEL_CHANNEL_TOLERANCE (32 of 255); the
            shot fails when different pixels exceed PIXEL_MAX_DIFF_RATIO (0.5%
            of the viewport) or when the image size changed. Glyph
            anti-aliasing noise is localised and can swing single pixels by
            200 (one visually identical heading line moved ~975 pixels, 0.30%
            of a phone viewport), so the budget is a pixel count, not a
            per-pixel delta. Real colour/layout leaks move computed styles
            (gate 1) or touch far more of the page.

PNG decoding and diffing run in Chromium (canvas), so the check needs nothing
beyond Playwright, which is all the visual CI job installs.

Set EXAM_FREEZE_VISUAL_BASE_URL (run_visual_regressions.py does) to reuse an
already served dist/writing instead of starting a private server.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import platform
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]
DIST = ROOT / "dist/writing"
# Tracked, reviewed, only ever rewritten by --update-baseline.
BASELINE = Path(__file__).parent / "baselines" / "exam-freeze"
# Throwaway run output (gitignored with the rest of reports/).
OUT = Path(__file__).parent / "reports" / "exam-freeze"
CURRENT = OUT / "current"
BASE_URL_ENV = "EXAM_FREEZE_VISUAL_BASE_URL"
PIXEL_CHANNEL_TOLERANCE = 32
PIXEL_MAX_DIFF_RATIO = 0.005
EXAM = ROOT / "assets/generated/reading-exams/p1-high-01.js"
ASSET_ID = "p1-high-01"
SUITE_ID = "suite-freeze-1"
REVIEW_ID = "attempt-freeze-1"
VIEWPORTS = (("desktop", 1440, 900), ("tablet", 1024, 768), ("mobile", 390, 844))
ROUTES = (
    ("practice", f"/reading/{ASSET_ID}", "[data-practice-reading-page]"),
    ("review", f"/reading/{ASSET_ID}/review/{REVIEW_ID}", "[data-practice-reading-page]"),
    ("suite", f"/reading-suite/{SUITE_ID}", "[data-reading-suite-summary]"),
)

MOCK = r"""
(() => {
  const examSource = __EXAM__;
  window.__READING_EXAM_DATA__ = { register(id, data) { window.__examPayload = data; } };
  (0, eval)(examSource);
  const payload = window.__examPayload;
  const asset = {
    schemaVersion: 2, id: '__ASSET__', activity: 'reading', sourceKind: 'generated',
    title: payload.meta.title, category: payload.meta.category, frequency: 'high',
    fingerprint: 'fp-freeze', pdfOnly: false
  };
  const answers = payload.questionOrder.map((questionId, index) => ({
    questionId, answer: index % 3 === 0 ? 'x' : payload.answerKey[questionId],
    correctAnswer: payload.answerKey[questionId], isCorrect: index % 3 !== 0,
    weight: 1, marked: index === 4, changeCount: 0, visitCount: 1, elapsedMs: 0
  }));
  const detail = {
    summary: { id: '__REVIEW__', activity: 'reading', assetId: '__ASSET__', title: asset.title, status: 'completed',
      mode: 'single', durationMs: 1112000 },
    attempt: {
      schemaVersion: 1, id: '__REVIEW__', activity: 'reading', assetId: '__ASSET__', status: 'completed',
      mode: 'single', startedAt: '2026-09-30T08:30:00Z',
      answers, scoreValue: 0.69, correctCount: 9, questionCount: 13, durationMs: 1112000,
      submittedAt: '2026-09-30T09:00:00Z', titleSnapshot: asset.title, annotations: []
    }
  };
  const suite = {
    sessionId: '__SUITE__', activity: 'reading', practiceMode: 'suite', status: 'active', currentIndex: 0,
    totalPassages: 3, flowMode: 'simulation', frequencyScope: 'all', createdAt: '2026-09-30T09:00:00Z',
    updatedAt: '2026-09-30T09:30:00Z',
    timer: { source: 'suite', anchorMs: 0, effectiveStartTimeMs: 0, mode: 'elapsed', limitSeconds: null,
             pausedOffsetMs: 0, pausedAtMs: null, running: false },
    aggregate: { submittedPassages: 1, totalPassages: 3, percentage: 72, correct: 18, totalQuestions: 25,
                 accuracy: 0.72, duration: 0 },
    sequence: [
      { assetId: '__ASSET__', examId: '__ASSET__', index: 0, category: 'P1', title: asset.title, status: 'active', sessionId: null, scoreInfo: null },
      { assetId: 'p2-x', examId: 'p2-x', index: 1, category: 'P2', title: 'How coastal wetlands protect cities', status: 'submitted',
        sessionId: 'attempt-x', scoreInfo: { correct: 18, totalQuestions: 25, percentage: 72 } },
      { assetId: 'p3-x', examId: 'p3-x', index: 2, category: 'P3', title: 'The science of long-distance memory', status: 'pending', sessionId: null, scoreInfo: null }
    ]
  };
  const data = {
    reading_list_assets: [asset],
    reading_get_asset_payload: { asset, payload },
    get_history_detail: detail,
    suite_get: suite,
    list_history: { items: [], total: 0, limit: 20, offset: 0, nextCursor: null }
  };
  window.__TAURI__ = window.__TAURI__ || {};
  window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {};
  window.__TAURI__.core = {
    invoke: async (command) => ({ ok: true, data: command in data ? data[command] : null })
  };
})();
"""


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def serve() -> tuple[subprocess.Popen, str]:
    port = free_port()
    process = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1", "--directory", str(DIST)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    base = f"http://127.0.0.1:{port}"
    for _ in range(80):
        try:
            urllib.request.urlopen(base, timeout=1)
            return process, base
        except OSError:
            time.sleep(0.25)
    process.kill()
    raise RuntimeError("static server did not start")


def serve_or_attach() -> tuple[subprocess.Popen | None, str]:
    attached = os.environ.get(BASE_URL_ENV)
    if attached:
        return None, attached.rstrip("/")
    if not (DIST / "index.html").is_file():
        raise SystemExit("dist/writing is missing; run the Vue production build first")
    return serve()


def settle(page, selector):
    page.wait_for_selector(selector)
    page.evaluate(
        """async () => {
          await document.fonts.ready;
          const finite = document.getAnimations().filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime));
          await Promise.all(finite.map(a => a.finished.catch(() => {})));
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        }"""
    )
    page.wait_for_timeout(300)


STYLE_PROPS = (
    "display", "position", "color", "background-color", "background-image", "border-top-width",
    "border-top-style", "border-top-color", "border-bottom-width", "border-bottom-color",
    "border-left-width", "border-left-color", "border-right-width", "border-top-left-radius",
    "border-bottom-right-radius", "box-shadow", "font-family", "font-size", "font-weight",
    "line-height", "letter-spacing", "text-transform", "padding-top", "padding-left",
    "margin-top", "margin-left", "outline-style", "opacity", "gap", "text-decoration-line",
)
STYLE_SNAPSHOT = r"""props => [...document.querySelectorAll('#app *')].map((node, index) => {
  const style = getComputedStyle(node);
  const rect = node.getBoundingClientRect();
  const id = node.id ? '#' + node.id : '';
  const cls = typeof node.className === 'string' ? node.className.trim().split(/[ \t\n]+/).slice(0, 2).join('.') : '';
  return {
    key: index + ':' + node.tagName.toLowerCase() + id + (cls ? '.' + cls : ''),
    rect: [rect.x, rect.y, rect.width, rect.height].map(value => Math.round(value * 2) / 2),
    style: Object.fromEntries(props.map(prop => [prop, style.getPropertyValue(prop)]))
  };
})"""


def capture(base: str) -> tuple[list[str], dict]:
    """Write every shot (png + style/rect json) plus meta.json into CURRENT."""
    shutil.rmtree(CURRENT, ignore_errors=True)
    CURRENT.mkdir(parents=True)
    mock = (MOCK.replace("__EXAM__", json.dumps(EXAM.read_text(encoding="utf-8")))
            .replace("__ASSET__", ASSET_ID).replace("__SUITE__", SUITE_ID).replace("__REVIEW__", REVIEW_ID))
    names = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            env = {"platform": platform.platform(), "chromium": browser.version}
            for size, width, height in VIEWPORTS:
                for route_name, route, selector in ROUTES:
                    for entry in ("cold", "via-library"):
                        context = browser.new_context(viewport={"width": width, "height": height}, reduced_motion="reduce")
                        page = context.new_page()
                        page.clock.set_fixed_time("2026-10-01T09:00:00")
                        page.add_init_script(mock)
                        if entry == "via-library":
                            page.goto(f"{base}/#/", wait_until="networkidle")
                            settle(page, "[data-practice-reading-home]")
                            page.evaluate("route => { location.hash = route }", route)
                        else:
                            page.goto(f"{base}/#{route}", wait_until="networkidle")
                        settle(page, selector)
                        name = f"{route_name}-{size}-{entry}"
                        styles = page.evaluate(STYLE_SNAPSHOT, list(STYLE_PROPS))
                        (CURRENT / f"{name}.json").write_text(json.dumps(styles, separators=(",", ":")), encoding="utf-8")
                        page.screenshot(path=str(CURRENT / f"{name}.png"), full_page=False, animations="disabled",
                                        caret="hide", mask=[page.locator(".reading-timer")])
                        names.append(name)
                        context.close()
        finally:
            browser.close()
    (CURRENT / "meta.json").write_text(json.dumps(env, indent=2) + "\n", encoding="utf-8")
    return names, env


def style_drift(name: str) -> list[dict]:
    before = json.loads((BASELINE / f"{name}.json").read_text(encoding="utf-8"))
    after = json.loads((CURRENT / f"{name}.json").read_text(encoding="utf-8"))
    if len(before) != len(after):
        return [{"element": "*", "detail": f"element count {len(before)} -> {len(after)}"}]
    drift = []
    for left, right in zip(before, after):
        changes = {prop: [value, right["style"][prop]] for prop, value in left["style"].items()
                   if right["style"].get(prop) != value}
        if left["rect"] != right["rect"]:
            changes["rect"] = [left["rect"], right["rect"]]
        if changes or left["key"] != right["key"]:
            drift.append({"element": left["key"], "now": right["key"], "changes": changes})
    return drift


# Runs inside Chromium: decode both PNGs on canvases, count pixels whose largest
# RGB channel delta exceeds the tolerance. Mask: white same, grey noise, red over.
PIXEL_DIFF = r"""async ({ before, after, tolerance }) => {
  const load = async b64 => {
    const bytes = Uint8Array.from(atob(b64), char => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { colorSpaceConversion: 'none' });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height);
  };
  const left = await load(before);
  const right = await load(after);
  if (left.width !== right.width || left.height !== right.height) {
    return { size: [[left.width, left.height], [right.width, right.height]] };
  }
  const { width, height } = left;
  const mask = new ImageData(width, height);
  const [SAME, NOISE, OVER] = [[255, 255, 255, 255], [160, 160, 160, 255], [255, 0, 0, 255]];
  let over = 0, any = 0, maxDelta = 0;
  let box = [width, height, -1, -1];
  for (let pixel = 0; pixel < width * height; pixel++) {
    const at = pixel * 4;
    const delta = Math.max(Math.abs(left.data[at] - right.data[at]),
      Math.abs(left.data[at + 1] - right.data[at + 1]), Math.abs(left.data[at + 2] - right.data[at + 2]));
    mask.data.set(delta === 0 ? SAME : delta > tolerance ? OVER : NOISE, at);
    if (delta === 0) continue;
    any++;
    maxDelta = Math.max(maxDelta, delta);
    if (delta <= tolerance) continue;
    over++;
    const x = pixel % width, y = (pixel - x) / width;
    box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x + 1), Math.max(box[3], y + 1)];
  }
  let diffPng = null;
  if (any) {
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d').putImageData(mask, 0, 0);
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
    let text = '';
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    diffPng = btoa(text);
  }
  return { width, height, over, any, maxDelta, box: over ? box : null, diffPng };
}"""


def encode(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


def pixel_diff(page, name: str) -> dict:
    raw = page.evaluate(PIXEL_DIFF, {"before": encode(BASELINE / f"{name}.png"),
                                     "after": encode(CURRENT / f"{name}.png"),
                                     "tolerance": PIXEL_CHANNEL_TOLERANCE})
    if "size" in raw:
        return {"sizeChanged": raw["size"]}
    if raw["diffPng"]:
        (CURRENT / f"diff-{name}.png").write_bytes(base64.b64decode(raw["diffPng"]))
    return {"diffPixels": raw["over"], "diffRatio": round(raw["over"] / (raw["width"] * raw["height"]), 5),
            "noisePixels": raw["any"] - raw["over"], "maxChannelDelta": raw["maxDelta"], "box": raw["box"]}


def compare_shot(page, name: str) -> dict:
    if not all((BASELINE / f"{name}.{ext}").is_file() for ext in ("json", "png")):
        return {"name": name, "status": "missing-baseline"}
    drift = style_drift(name)
    pixels = pixel_diff(page, name)
    pixels_failed = "sizeChanged" in pixels or pixels["diffRatio"] > PIXEL_MAX_DIFF_RATIO
    failed = (["style"] if drift else []) + (["pixels"] if pixels_failed else [])
    return {"name": name, "status": "changed" if failed else "identical", "failedGates": failed,
            "styleDriftCount": len(drift), "styleDrift": drift[:12], "pixels": pixels}


def compare(names: list[str]) -> list[dict]:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            page = browser.new_page()
            return [compare_shot(page, name) for name in names]
        finally:
            browser.close()


def stale_baseline(names: list[str]) -> list[str]:
    """Baseline stems (png or json) that no current shot produces, orphans included."""
    if not BASELINE.is_dir():
        return []
    stems = {path.stem for path in BASELINE.glob("*.png")} | {path.stem for path in BASELINE.glob("*.json")}
    return sorted(stems - set(names) - {"meta"})


def env_warnings(baseline: dict | None, current: dict) -> list[str]:
    """Environment drift is reported, never failed: pixels may legitimately move with the browser."""
    if baseline is None:
        return ["baseline meta.json is missing; environment cannot be compared"]
    if baseline.get("chromium") != current.get("chromium"):
        return [f"chromium {baseline.get('chromium')} (baseline) != {current.get('chromium')} (current)"]
    return []


def baseline_env() -> dict | None:
    meta = BASELINE / "meta.json"
    return json.loads(meta.read_text(encoding="utf-8")) if meta.is_file() else None


def update_baseline(names: list[str], results: list[dict], env: dict) -> dict:
    """The only writer of BASELINE: rewrite shots that are new or fail a gate."""
    BASELINE.mkdir(parents=True, exist_ok=True)
    rewritten = [result for result in results if result["status"] != "identical"]
    removed = stale_baseline(names)
    for result in rewritten:
        for ext in ("json", "png"):
            shutil.copyfile(CURRENT / f"{result['name']}.{ext}", BASELINE / f"{result['name']}.{ext}")
    for stem in removed:
        for ext in ("json", "png"):
            (BASELINE / f"{stem}.{ext}").unlink(missing_ok=True)
    if rewritten or removed or not (BASELINE / "meta.json").is_file():
        shutil.copyfile(CURRENT / "meta.json", BASELINE / "meta.json")
    return {
        "mode": "update-baseline",
        "baselineDir": str(BASELINE),
        "captureEnv": env,
        "added": [r["name"] for r in rewritten if r["status"] == "missing-baseline"],
        "changed": [{"name": r["name"], "failedGates": r["failedGates"], "styleDriftCount": r["styleDriftCount"],
                     "diffPixels": r["pixels"].get("diffPixels")}
                    for r in rewritten if r["status"] == "changed"],
        "removed": removed,
        "unchanged": sum(result["status"] == "identical" for result in results),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--update-baseline", dest="update", action="store_true",
                        help="rewrite baselines/exam-freeze from the current dist (the only write path)")
    update = parser.parse_args().update
    process, base = serve_or_attach()
    try:
        names, env = capture(base)
    finally:
        if process:
            process.kill()
    results = compare(names)
    if update:
        print(json.dumps(update_baseline(names, results, env), indent=2))
        return 0
    stale = stale_baseline(names)
    failed = [result for result in results if result["status"] != "identical"]
    baseline = baseline_env()
    warnings = env_warnings(baseline, env)
    report = {"status": "failed" if failed or stale else "passed",
              "thresholds": {"channelTolerance": PIXEL_CHANNEL_TOLERANCE, "maxDiffRatio": PIXEL_MAX_DIFF_RATIO},
              "baselineEnv": baseline, "currentEnv": env, "warnings": warnings,
              "staleBaseline": stale, "results": results}
    (OUT / "exam-freeze-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    for warning in warnings:
        print(f"exam freeze WARNING: {warning}", file=sys.stderr)
    if failed or stale:
        print(f"exam freeze FAILED: {len(failed)} drifted shot(s), {len(stale)} stale baseline file(s). "
              "If the change is intentional, run with --update-baseline and review the diff.", file=sys.stderr)
    return 1 if failed or stale else 0


if __name__ == "__main__":
    raise SystemExit(main())
