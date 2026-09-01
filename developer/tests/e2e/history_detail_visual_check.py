import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("HISTORY_VISUAL_BASE_URL", "http://127.0.0.1:4175")
REPORT_DIR = Path(__file__).parent / "reports"
CASES = (
    ("desktop", 1440, 900),
    ("tablet", 1024, 768),
    ("mobile", 390, 844),
    ("small", 360, 800),
)


HISTORY_ITEM = {
    "id": "writing-history-1",
    "activity": "writing",
    "title": "Some people believe universities should focus on practical skills",
    "status": "completed",
    "mode": "single",
    "submittedAt": "2026-08-07T08:30:00Z",
    "durationMs": 2_340_000,
    "scoreValue": 7.5,
    "scoreScale": "band9",
    "scoreLabel": "Overall Band",
    "scoreDisplay": "7.5",
    "taskType": "task2",
}

HISTORY_DETAIL = {
    "summary": HISTORY_ITEM,
    "attempt": {
        "id": "writing-history-1",
        "activity": "writing",
        "taskType": "task2",
        "titleSnapshot": "Some people believe universities should focus on practical skills",
        "promptSnapshot": "Discuss both views and give your own opinion.",
        "contentText": (
            "Universities have traditionally balanced academic knowledge with preparation for work. "
            "In my view, practical skills deserve a visible place in degree programmes, but they "
            "should complement rather than replace the intellectual foundations of a discipline.\n\n"
            "Work placements and project-based courses help students apply theory, collaborate, and "
            "communicate under realistic constraints. At the same time, durable analytical skills "
            "allow graduates to adapt when particular tools and occupations change."
        ),
        "wordCount": 286,
        "scoreValue": 7.5,
        "submittedAt": "2026-08-07T08:30:00Z",
        "topic_source": "builtin",
        "model_name": "atlas-evaluator",
    },
    "evaluation": {
        "score": {
            "total_score": 7.5,
            "task_achievement": 7.5,
            "coherence_cohesion": 7.0,
            "lexical_resource": 8.0,
            "grammatical_range": 7.5,
        },
        "overall_feedback": (
            "The position is clear and consistently developed. Strengthen the second body paragraph "
            "with one concrete example and make the final comparison more explicit."
        ),
        "task_analysis": {
            "position": "A balanced position is established in the introduction.",
            "coverage": "Both sides of the prompt are addressed with relevant support.",
        },
        "band_rationale": {
            "task_achievement": "The response fully addresses the task and maintains a clear position.",
            "coherence_cohesion": "Paragraphing is logical, with occasional mechanical linking.",
            "lexical_resource": "Vocabulary is precise and flexible with rare awkward phrasing.",
            "grammatical_range": "Complex structures are used accurately throughout most of the essay.",
        },
        "improvement_plan": [
            "Add one specific example to the second body paragraph.",
            "Use the conclusion to compare the two priorities directly.",
        ],
        "topic_source": "builtin",
    },
    "model_name": "atlas-evaluator",
}


def install_tauri_mock(page):
    item_json = json.dumps(HISTORY_ITEM, ensure_ascii=False)
    detail_json = json.dumps(HISTORY_DETAIL, ensure_ascii=False)
    script = r"""
    (() => {
      const item = __ITEM__;
      const detail = __DETAIL__;
      window.__historyDetailMode = 'success';
      window.__resolveHistoryDetail = null;
      window.__TAURI__ = window.__TAURI__ || {};
      window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {};
      window.__TAURI__.core = {
        invoke: async (command) => {
          if (command === 'list_history') {
            return { ok: true, data: { items: [item], total: 1, limit: 20, offset: 0, nextCursor: null } };
          }
          if (command === 'history_writing_statistics') {
            return { ok: true, data: { count: 0, latest: null, average: null } };
          }
          if (command === 'get_history_detail') {
            if (window.__historyDetailMode === 'loading') {
              return await new Promise((resolve) => {
                window.__resolveHistoryDetail = () => resolve({ ok: true, data: detail });
              });
            }
            if (window.__historyDetailMode === 'error') {
              return { ok: false, error: { code: 'history.detail_failed', message: '评分详情暂时无法读取', retryable: true } };
            }
            if (window.__historyDetailMode === 'empty') {
              return { ok: true, data: null };
            }
            return { ok: true, data: detail };
          }
          return { ok: true, data: null };
        }
      };
    })();
    """.replace("__ITEM__", item_json).replace("__DETAIL__", detail_json)
    page.add_init_script(script)


def set_mode(page, mode):
    page.evaluate("mode => { window.__historyDetailMode = mode; }", mode)


def open_detail(page):
    page.locator(".essay-item .btn-icon[title='查看详情']").click()
    page.wait_for_selector(".dialog-overlay > .detail-modal")


def close_detail(page):
    page.locator(".detail-modal .modal-header .btn-icon").click()
    page.wait_for_selector(".dialog-overlay > .detail-modal", state="detached")


def read_common_geometry(page):
    return page.evaluate(
        """
        () => {
          const shell = document.querySelector('.atlas-source-ui');
          const overlay = document.querySelector('.history-page > .dialog-overlay');
          const dialog = overlay?.querySelector(':scope > .detail-modal');
          const overlayRect = overlay?.getBoundingClientRect();
          const dialogRect = dialog?.getBoundingClientRect();
          return {
            viewport: [innerWidth, innerHeight],
            documentScrollWidth: document.documentElement.scrollWidth,
            bodyScrollWidth: document.body.scrollWidth,
            overlayPosition: overlay ? getComputedStyle(overlay).position : '',
            overlayCoversViewport: Boolean(
              overlayRect && overlayRect.width >= innerWidth && overlayRect.height >= innerHeight
            ),
            dialogWithinViewport: Boolean(
              dialogRect && dialogRect.top >= 0 && dialogRect.bottom <= innerHeight + 1
            ),
            dialogMaxHeight: dialog ? getComputedStyle(dialog).maxHeight : '',
            dialogOverflow: dialog ? getComputedStyle(dialog).overflowY : '',
            dialogShadow: dialog ? getComputedStyle(dialog).boxShadow : '',
            shellOverflow: shell ? getComputedStyle(shell).overflow : ''
          };
        }
        """
    )


def assert_common_geometry(name, geometry):
    width = geometry["viewport"][0]
    if geometry["overlayPosition"] != "fixed":
        raise AssertionError(f"{name}: History overlay is not fixed")
    if not geometry["overlayCoversViewport"]:
        raise AssertionError(f"{name}: History overlay does not cover the viewport")
    if not geometry["dialogWithinViewport"]:
        raise AssertionError(f"{name}: History detail dialog escapes the viewport")
    if geometry["dialogMaxHeight"] in ("", "none", "auto"):
        raise AssertionError(f"{name}: History detail dialog is not height-bounded")
    if geometry["dialogOverflow"] not in ("auto", "scroll"):
        raise AssertionError(f"{name}: History detail dialog is not internally scrollable")
    if geometry["dialogShadow"] in ("", "none"):
        raise AssertionError(f"{name}: History detail dialog lost its elevated surface")
    if geometry["shellOverflow"] != "hidden":
        raise AssertionError(f"{name}: app shell remains scrollable while History detail is open")
    if geometry["documentScrollWidth"] > width + 1 or geometry["bodyScrollWidth"] > width + 1:
        raise AssertionError(f"{name}: History detail causes page-level horizontal overflow")


def read_success_geometry(page):
    return page.evaluate(
        """
        () => {
          const total = document.querySelector('.detail-modal .total-score');
          const feedback = document.querySelector('.detail-modal .feedback-panel');
          const essay = document.querySelector('.detail-modal .essay-text');
          const infoItems = [...document.querySelectorAll('.detail-modal .info-item')];
          const scoreItems = [...document.querySelectorAll('.detail-modal .score-item')];
          const analyses = [...document.querySelectorAll('.detail-modal .detail-analysis-card')];
          const grid = document.querySelector('.detail-modal .detail-grid');
          return {
            gridColumns: grid ? getComputedStyle(grid).gridTemplateColumns : '',
            totalBackground: total ? getComputedStyle(total).backgroundImage : '',
            totalShadow: total ? getComputedStyle(total).boxShadow : '',
            feedbackBackground: feedback ? getComputedStyle(feedback).backgroundColor : '',
            essayBackground: essay ? getComputedStyle(essay).backgroundColor : '',
            infoBorders: infoItems.map((item) => getComputedStyle(item).borderTopWidth),
            infoShadows: infoItems.map((item) => getComputedStyle(item).boxShadow),
            scoreShadows: scoreItems.map((item) => getComputedStyle(item).boxShadow),
            analysisShadows: analyses.map((item) => getComputedStyle(item).boxShadow),
            scoreCount: scoreItems.length,
            analysisCount: analyses.length
          };
        }
        """
    )


def assert_success_geometry(name, width, geometry):
    if "gradient" not in geometry["totalBackground"]:
        raise AssertionError(f"{name}: total score is no longer the primary gradient surface")
    if geometry["totalShadow"] in ("", "none"):
        raise AssertionError(f"{name}: total score lost its visual anchor")
    if geometry["feedbackBackground"] == geometry["essayBackground"]:
        raise AssertionError(f"{name}: feedback and essay surfaces are visually indistinguishable")
    if geometry["scoreCount"] != 4:
        raise AssertionError(f"{name}: expected four score rows")
    if geometry["analysisCount"] < 2:
        raise AssertionError(f"{name}: expected task and rationale analysis sections")
    if any(border != "0px" for border in geometry["infoBorders"]):
        raise AssertionError(f"{name}: metadata items still render as nested cards")
    if any(shadow != "none" for shadow in geometry["infoShadows"]):
        raise AssertionError(f"{name}: metadata items still have raised shadows")
    if any(shadow != "none" for shadow in geometry["scoreShadows"]):
        raise AssertionError(f"{name}: score rows still have raised shadows")
    if any(shadow != "none" for shadow in geometry["analysisShadows"]):
        raise AssertionError(f"{name}: analysis sections still have raised shadows")
    column_count = len([value for value in geometry["gridColumns"].split(" ") if value])
    if width <= 960 and column_count != 1:
        raise AssertionError(f"{name}: mobile/tablet detail grid is not single-column")
    if width > 960 and column_count != 2:
        raise AssertionError(f"{name}: desktop detail grid is not two-column")


def read_state_surface(page, selector):
    return page.evaluate(
        """
        selector => {
          const node = document.querySelector(selector);
          if (!node) return null;
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return {
            display: style.display,
            minHeight: parseFloat(style.minHeight || '0'),
            shadow: style.boxShadow,
            background: style.backgroundImage + style.backgroundColor,
            width: rect.width,
            text: node.textContent.trim()
          };
        }
        """,
        selector,
    )


def main():
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for name, width, height in CASES:
                page = browser.new_page(viewport={"width": width, "height": height})
                install_tauri_mock(page)
                page.goto(f"{BASE_URL}/#/history", wait_until="networkidle")
                page.wait_for_selector(".history-page .essay-item")

                set_mode(page, "loading")
                open_detail(page)
                page.wait_for_selector(".detail-modal > .loading")
                loading_common = read_common_geometry(page)
                loading_surface = read_state_surface(page, ".detail-modal > .loading")
                assert_common_geometry(f"{name}: loading", loading_common)
                if loading_surface["display"] != "grid" or loading_surface["minHeight"] < 199:
                    raise AssertionError(f"{name}: loading state is not a bounded detail surface")
                close_detail(page)
                page.evaluate("() => window.__resolveHistoryDetail?.()")

                set_mode(page, "error")
                open_detail(page)
                page.wait_for_selector(".detail-modal > .detail-error-state")
                error_common = read_common_geometry(page)
                error_surface = read_state_surface(page, ".detail-modal > .detail-error-state")
                assert_common_geometry(f"{name}: error", error_common)
                if error_surface["shadow"] != "none" or error_surface["minHeight"] < 199:
                    raise AssertionError(f"{name}: error state still behaves like a nested raised card")
                set_mode(page, "success")
                page.locator(".detail-error-actions .btn-brand").click()
                page.wait_for_selector(".detail-modal .total-score")
                close_detail(page)

                set_mode(page, "empty")
                open_detail(page)
                page.wait_for_selector(".detail-modal > .detail-empty-state")
                empty_common = read_common_geometry(page)
                empty_surface = read_state_surface(page, ".detail-modal > .detail-empty-state")
                assert_common_geometry(f"{name}: empty", empty_common)
                if empty_surface["display"] != "grid" or "没有可显示" not in empty_surface["text"]:
                    raise AssertionError(f"{name}: empty detail state is missing or unbounded")
                close_detail(page)

                set_mode(page, "success")
                open_detail(page)
                page.wait_for_selector(".detail-modal .total-score")
                success_common = read_common_geometry(page)
                success_geometry = read_success_geometry(page)
                assert_common_geometry(f"{name}: success", success_common)
                assert_success_geometry(f"{name}: success", width, success_geometry)
                page.screenshot(path=str(REPORT_DIR / f"history-detail-{name}-current.png"))

                report.append(
                    {
                        "name": name,
                        "loading": {"common": loading_common, "surface": loading_surface},
                        "error": {"common": error_common, "surface": error_surface},
                        "empty": {"common": empty_common, "surface": empty_surface},
                        "success": {"common": success_common, "surface": success_geometry},
                    }
                )
                page.close()
        finally:
            browser.close()
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
