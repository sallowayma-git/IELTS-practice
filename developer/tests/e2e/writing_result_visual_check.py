import json
import os
import re
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("WRITING_RESULT_VISUAL_BASE_URL", "http://127.0.0.1:4175")
REPORT_DIR = Path(__file__).parent / "reports"
CASES = (
    ("desktop", 1440, 900),
    ("tablet", 1024, 720),
    ("mobile", 390, 844),
    ("small", 360, 800),
)


ESSAY_PARAGRAPHS = (
    "Universities must equips students for work while preserving the deeper habits of inquiry that "
    "allow graduates to adapt. Practical projects make abstract knowledge visible, especially when "
    "students must explain decisions to people outside their discipline.",
    "A narrow focus on current workplace tools, however, can age quickly. Employers change systems, "
    "industries reorganise, and graduates face problems that no syllabus could predict. Strong theory "
    "and careful reasoning therefore remain essential rather than decorative.",
    "The most useful degree programmes combine these priorities. Placements and collaborative briefs "
    "can test whether students apply ideas responsibly, while seminars and independent research give "
    "them time to question assumptions and build durable judgement.",
    "In conclusion, practical preparation deserves a visible place in higher education, but it should "
    "complement intellectual foundations. This balance prepares students for their first role without "
    "limiting their ability to learn throughout a much longer career.",
)
EXPECTED_ESSAY_TEXT = " ".join("\n\n".join(ESSAY_PARAGRAPHS).split())
EXPECTED_SUPPORT_HEADINGS = [
    "AI Evaluation Summary",
    "整体改进建议",
    "核心提分计划",
    "段落详评",
    "得分解析",
    "任务诊断",
]

HISTORY_DETAIL = {
    "summary": {
        "id": "writing-result-visual",
        "activity": "writing",
        "title": (
            "Universities should prioritise practical employment skills while preserving academic study"
        ),
        "status": "completed",
        "mode": "freeform",
        "submittedAt": "2026-08-10T08:29:00Z",
        "durationMs": 2_340_000,
        "scoreValue": 7.5,
        "scoreScale": "band9",
        "scoreLabel": "Overall Band",
        "scoreDisplay": "7.5",
        "sessionId": "writing-result-visual",
        "taskType": "task2",
    },
    "attempt": {
        "schemaVersion": 1,
        "id": "writing-result-visual",
        "activity": "writing",
        "mode": "freeform",
        "status": "completed",
        "startedAt": "2026-08-10T07:50:00Z",
        "submittedAt": "2026-08-10T08:29:00Z",
        "completedAt": "2026-08-10T08:30:00Z",
        "durationMs": 2_340_000,
        "scoreValue": 7.5,
        "scoreScale": "band9",
        "taskType": "task2",
        "titleSnapshot": (
            "Universities should prioritise practical employment skills while preserving academic study"
        ),
        "promptSnapshot": (
            "Some people believe university education should focus on practical employment skills, "
            "while others think academic study is more important. Discuss both views and give your opinion."
        ),
        "contentText": "\n\n".join(ESSAY_PARAGRAPHS),
        "answers": [],
        "annotations": [],
    },
    "evaluation": {
        "schemaVersion": 4,
        "id": "evaluation-writing-result-visual",
        "status": "completed",
        "stage": "finalizing",
        "taskType": "task2",
        "score": {
            "overall": 7.5,
            "taskResponse": 7.5,
            "coherence": 7.0,
            "lexical": 8.0,
            "grammar": 7.5,
        },
        "diagnosis": {
            "task": {
                "prompt_response_quality": "Both views are addressed and the writer's position remains explicit.",
                "position_clarity": "The central claim is established early and sustained through the conclusion.",
                "argument_development": "Relevant reasoning is present, but one example could be more specific.",
                "conclusion_effectiveness": "The conclusion compares the priorities rather than merely repeating them.",
            },
            "rationale": {
                "task_achievement": "A developed response addresses every part of the question.",
                "coherence_cohesion": "Paragraphing is logical with occasional mechanical linking.",
                "lexical_resource": "Vocabulary is precise and flexible with only rare awkward choices.",
                "grammatical_range": "Complex structures are frequent and mostly accurate.",
            },
        },
        "feedback": {
            "overall": (
                "The response maintains a clear position and develops both perspectives in a controlled way. "
                "The next improvement is to make the practical example more concrete and vary the transition "
                "language between the final two body paragraphs."
            ),
            "plan": [
                "Add one concrete workplace example to the first body paragraph.",
                "Replace repeated contrast markers with transitions that describe the logical relationship.",
                "Check subject-verb agreement during the final proofreading pass.",
            ],
            "paragraphs": [
                {
                    "paragraphIndex": 1,
                    "summary": "The opening establishes the practical-skills case efficiently.",
                    "issues": ["A named project or placement would make the claim less abstract."],
                },
                {
                    "paragraphIndex": 2,
                    "summary": "The counterargument is clearly separated and logically developed.",
                    "issues": ["The final sentence provides a useful bridge back to the thesis."],
                },
            ],
            "sentences": [
                {
                    "sentence": "Universities must equips students for work while preserving deeper inquiry.",
                    "correction": "Universities must equip students for work while preserving deeper inquiry.",
                    "kind": "grammar",
                },
                {
                    "sentence": "Practical projects make abstract knowledge visible to students.",
                },
            ],
            "rewrites": [],
        },
    },
}


def install_tauri_mock(page):
    detail_json = json.dumps(HISTORY_DETAIL, ensure_ascii=False)
    script = r"""
    (() => {
      const detail = __DETAIL__;
      window.__writingResultCalls = [];
      window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {};
      const invoke = async (command, args = {}) => {
        window.__writingResultCalls.push({ command, args });
        if (command === 'get_history_detail') {
          return { ok: true, data: detail };
        }
        return { ok: true, data: null };
      };
      window.__TAURI_INTERNALS__.invoke = invoke;
    })();
    """.replace("__DETAIL__", detail_json)
    page.add_init_script(script)


def read_geometry(page):
    return page.evaluate(
        """
        () => {
          const node = (selector) => document.querySelector(selector);
          const nodes = (selector) => [...document.querySelectorAll(selector)];
          const box = (element) => {
            if (!element) return null;
            const rect = element.getBoundingClientRect();
            return {
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
              left: rect.left,
              width: rect.width,
              height: rect.height
            };
          };
          const style = (element) => element ? getComputedStyle(element) : null;
          const layout = node('.result-layout');
          const essay = node('.result-layout > .essay-panel');
          const essayBody = node('.essay-panel > .essay-body');
          const sidebar = node('.result-layout > .right-panel');
          const supportCards = nodes('.right-panel > .glass-card');
          const scoreRing = node('.score-ring-container');
          const metrics = node('.metrics-grid');
          const metricCards = nodes('.metrics-grid > .metric-card');
          const viewControls = node('.view-controls');
          const viewButtons = nodes('.view-controls > button');
          const heading = node('.display-heading');
          const scoreLabel = node('.score-label');
          const metricLabel = node('.metric-label');
          const activeViewButton = node('.view-controls > .btn-brand');
          const inactiveViewButton = node('.view-controls > .btn-warm-sand');
          return {
            viewport: [innerWidth, innerHeight],
            documentWidth: document.documentElement.scrollWidth,
            bodyWidth: document.body.scrollWidth,
            rootBox: box(node('.result-page')),
            layoutBox: box(layout),
            layoutDisplay: style(layout)?.display || '',
            layoutColumns: style(layout)?.gridTemplateColumns || '',
            essayBox: box(essay),
            essayBodyBox: box(essayBody),
            essayText: essayBody?.textContent.trim() || '',
            essayBodyOverflow: style(essayBody)?.overflowY || '',
            essayBodyClientHeight: essayBody?.clientHeight || 0,
            essayBodyScrollHeight: essayBody?.scrollHeight || 0,
            sidebarBox: box(sidebar),
            sidebarOverflow: style(sidebar)?.overflowY || '',
            sidebarClientHeight: sidebar?.clientHeight || 0,
            sidebarScrollHeight: sidebar?.scrollHeight || 0,
            scoreRingBox: box(scoreRing),
            scoreText: node('.score-total')?.textContent.trim() || '',
            metricGridColumns: style(metrics)?.gridTemplateColumns || '',
            metricCards: metricCards.map(box),
            metricValues: metricCards.map((item) => item.querySelector('.metric-value')?.textContent.trim()),
            viewControlsBox: box(viewControls),
            viewButtons: viewButtons.map((item) => ({ box: box(item), text: item.textContent.trim() })),
            supportHeadings: supportCards.map((item) => item.querySelector('h3')?.textContent.trim() || ''),
            resultErrorVisible: Boolean(node('.result-load-error')),
            headingLetterSpacing: style(heading)?.letterSpacing || '',
            scoreLabelLetterSpacing: style(scoreLabel)?.letterSpacing || '',
            metricLabelLetterSpacing: style(metricLabel)?.letterSpacing || '',
            activeViewButton: activeViewButton ? {
              text: activeViewButton.textContent.trim(),
              color: style(activeViewButton)?.color || '',
              backgroundColor: style(activeViewButton)?.backgroundColor || '',
              backgroundImage: style(activeViewButton)?.backgroundImage || '',
              borderColor: style(activeViewButton)?.borderColor || ''
            } : null,
            inactiveViewButton: inactiveViewButton ? {
              text: inactiveViewButton.textContent.trim(),
              color: style(inactiveViewButton)?.color || '',
              backgroundColor: style(inactiveViewButton)?.backgroundColor || '',
              backgroundImage: style(inactiveViewButton)?.backgroundImage || '',
              borderColor: style(inactiveViewButton)?.borderColor || ''
            } : null,
            calls: window.__writingResultCalls
          };
        }
        """
    )


def column_count(value):
    return len([item for item in value.split(" ") if item and item != "none"])


def parse_css_color(value):
    match = re.fullmatch(r"rgba?\(([^)]+)\)", value.strip())
    if not match:
        raise AssertionError(f"unsupported computed color: {value}")
    parts = [item.strip() for item in match.group(1).split(",")]
    if len(parts) not in (3, 4):
        raise AssertionError(f"unsupported computed color: {value}")
    red, green, blue = (float(item) for item in parts[:3])
    alpha = float(parts[3]) if len(parts) == 4 else 1.0
    return red, green, blue, alpha


def composite(foreground, background):
    alpha = foreground[3]
    return tuple(
        foreground[index] * alpha + background[index] * (1 - alpha)
        for index in range(3)
    )


def relative_luminance(color):
    channels = []
    for value in color:
        normalized = value / 255
        channels.append(
            normalized / 12.92
            if normalized <= 0.04045
            else ((normalized + 0.055) / 1.055) ** 2.4
        )
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]


def contrast_ratio(foreground, background):
    background_rgb = composite(parse_css_color(background), (255, 255, 255))
    foreground_rgb = composite(parse_css_color(foreground), background_rgb)
    light, dark = sorted(
        (relative_luminance(foreground_rgb), relative_luminance(background_rgb)),
        reverse=True,
    )
    return (light + 0.05) / (dark + 0.05)


def assert_active_view_style(name, phase, style):
    if not style:
        raise AssertionError(f"{name}: {phase} selected Result view is missing")
    if style["backgroundImage"] not in ("", "none"):
        raise AssertionError(f"{name}: {phase} selected view uses an unverified background image")
    ratio = contrast_ratio(style["color"], style["backgroundColor"])
    if ratio < 4.5:
        raise AssertionError(
            f"{name}: {phase} selected Result view contrast is {ratio:.2f}:1 ({style})"
        )
    return round(ratio, 2)


def read_active_view_style(page):
    return page.locator(".view-controls > .btn-brand").evaluate(
        """
        (button) => {
          const style = getComputedStyle(button);
          return {
            text: button.textContent.trim(),
            color: style.color,
            backgroundColor: style.backgroundColor,
            backgroundImage: style.backgroundImage,
            borderColor: style.borderColor
          };
        }
        """
    )


def verify_active_view_style(page, name, expected_text):
    resting = read_active_view_style(page)
    if resting["text"] != expected_text:
        raise AssertionError(f"{name}: expected {expected_text} to own the selected view state")
    resting_ratio = assert_active_view_style(name, f"{expected_text} resting", resting)
    page.locator(".view-controls > .btn-brand").hover()
    hovered = read_active_view_style(page)
    hover_ratio = assert_active_view_style(name, f"{expected_text} hover", hovered)
    page.mouse.move(0, 0)
    return {"resting": resting, "restingContrast": resting_ratio, "hovered": hovered, "hoverContrast": hover_ratio}


def assert_geometry(name, width, data):
    if data["resultErrorVisible"]:
        raise AssertionError(f"{name}: Result rendered its load-error shell")
    if data["documentWidth"] > width + 1 or data["bodyWidth"] > width + 1:
        raise AssertionError(f"{name}: Result page overflows the viewport: {json.dumps(data, ensure_ascii=False)}")
    if not data["rootBox"] or data["rootBox"]["right"] > width + 1:
        raise AssertionError(f"{name}: Result root escapes the viewport")
    if data["layoutDisplay"] != "grid":
        raise AssertionError(f"{name}: canonical Result skin no longer owns the layout")

    expected_layout_columns = 2 if width > 1040 else 1
    if column_count(data["layoutColumns"]) != expected_layout_columns:
        raise AssertionError(
            f"{name}: expected {expected_layout_columns} Result columns, got {data['layoutColumns']}"
        )
    if expected_layout_columns == 2:
        if data["sidebarBox"]["left"] < data["essayBox"]["right"] - 1:
            raise AssertionError(f"{name}: desktop Result columns overlap")
    elif data["sidebarBox"]["top"] < data["essayBox"]["bottom"] - 1:
        raise AssertionError(f"{name}: single-column Result surfaces overlap")

    if data["scoreText"] != "7.5" or not data["scoreRingBox"]:
        raise AssertionError(f"{name}: score summary did not render the persisted Band result")
    if not 150 <= data["scoreRingBox"]["width"] <= 185:
        raise AssertionError(f"{name}: score ring escaped its stable size: {data['scoreRingBox']}")
    if len(data["metricCards"]) != 4 or data["metricValues"] != ["7.5", "7", "8", "7.5"]:
        raise AssertionError(f"{name}: expected four persisted score metrics: {data['metricValues']}")

    expected_metric_columns = 1 if width <= 640 else 2
    if column_count(data["metricGridColumns"]) != expected_metric_columns:
        raise AssertionError(
            f"{name}: expected {expected_metric_columns} metric columns, got {data['metricGridColumns']}"
        )
    if len(data["viewButtons"]) != 2:
        raise AssertionError(f"{name}: full/annotated view controls are incomplete")
    for button in data["viewButtons"]:
        button_box = button["box"]
        controls_box = data["viewControlsBox"]
        if button_box["height"] < 38 or button_box["right"] > controls_box["right"] + 1:
            raise AssertionError(f"{name}: Result view action is clipped: {button}")
    if data["supportHeadings"] != EXPECTED_SUPPORT_HEADINGS:
        raise AssertionError(f"{name}: Result support surfaces are incomplete: {data['supportHeadings']}")
    if not data["activeViewButton"]:
        raise AssertionError(f"{name}: selected Result view is missing")
    active_style = {key: value for key, value in data["activeViewButton"].items() if key != "text"}
    inactive_style = {key: value for key, value in data["inactiveViewButton"].items() if key != "text"}
    if active_style == inactive_style:
        raise AssertionError(f"{name}: selected Result view is visually indistinguishable")

    if width <= 1040:
        if data["sidebarOverflow"] not in ("visible", "clip"):
            raise AssertionError(f"{name}: stacked Result sidebar keeps an inner scroll trap")
        if data["sidebarScrollHeight"] > data["sidebarClientHeight"] + 1:
            raise AssertionError(f"{name}: stacked Result sidebar clips its content")

    letter_spacing = (
        data["headingLetterSpacing"],
        data["scoreLabelLetterSpacing"],
        data["metricLabelLetterSpacing"],
    )
    if any(value not in ("0px", "normal") for value in letter_spacing):
        raise AssertionError(f"{name}: Result still uses non-zero letter spacing: {letter_spacing}")

    if data["calls"] != [
        {"command": "get_history_detail", "args": {"attemptId": "writing-result-visual"}}
    ]:
        raise AssertionError(f"{name}: Result changed its Tauri read contract: {data['calls']}")


def verify_original_view(page, name, data):
    if " ".join(data["essayText"].split()) != EXPECTED_ESSAY_TEXT:
        raise AssertionError(f"{name}: Original View does not render the complete persisted essay")
    body_box = data["essayBodyBox"]
    essay_box = data["essayBox"]
    if not body_box or body_box["left"] < essay_box["left"] - 1 or body_box["right"] > essay_box["right"] + 1:
        raise AssertionError(f"{name}: Original View escapes the essay surface")

    scrollable = data["essayBodyScrollHeight"] > data["essayBodyClientHeight"] + 1
    scroll_position = 0
    if scrollable:
        if data["essayBodyOverflow"] not in ("auto", "scroll"):
            raise AssertionError(f"{name}: long Original View is clipped without a scroll owner")
        scroll_position = page.locator(".essay-panel > .essay-body").evaluate(
            """
            (body) => {
              body.scrollTop = body.scrollHeight;
              return body.scrollTop;
            }
            """
        )
        if scroll_position <= 0:
            raise AssertionError(f"{name}: long Original View cannot reach its trailing content")
        page.locator(".essay-panel > .essay-body").evaluate("(body) => { body.scrollTop = 0; }")
    return {
        "textLength": len(data["essayText"]),
        "clientHeight": data["essayBodyClientHeight"],
        "scrollHeight": data["essayBodyScrollHeight"],
        "overflowY": data["essayBodyOverflow"],
        "maxScrollTop": scroll_position,
    }


def verify_annotated_view(page, name, width):
    annotated_button = page.locator(".view-controls > button", has_text="Annotated Errors")
    annotated_button.click()
    page.wait_for_function(
        "() => document.querySelector('.view-controls > .btn-brand')?.textContent.includes('Annotated Errors')"
    )
    active_style = verify_active_view_style(page, name, "Annotated Errors")

    error_button = page.locator(".essay-body .sentence-container.has-error").first
    error_button.wait_for()
    detail_id = error_button.get_attribute("aria-controls")
    if not detail_id or error_button.get_attribute("aria-expanded") != "true":
        raise AssertionError(f"{name}: persisted annotation is not expanded on first render")
    detail = page.locator(f"#{detail_id}")
    detail.wait_for()
    error_button.click()
    page.wait_for_function(
        "(selector) => document.querySelector(selector)?.getAttribute('aria-expanded') === 'false'",
        arg=f"[aria-controls='{detail_id}']",
    )
    if detail.count() != 0:
        raise AssertionError(f"{name}: annotation detail did not collapse")
    error_button.click()
    page.wait_for_function(
        "(selector) => document.querySelector(selector)?.getAttribute('aria-expanded') === 'true'",
        arg=f"[aria-controls='{detail_id}']",
    )
    detail.wait_for()
    annotated = page.evaluate(
        """
        () => {
          const body = document.querySelector('.essay-body');
          const detail = document.querySelector('.essay-body .error-details');
          const essayPanel = document.querySelector('.essay-panel');
          const sidebar = document.querySelector('.right-panel');
          const sentenceNodes = [...document.querySelectorAll('.essay-body .sentence-container')];
          const lastSentence = sentenceNodes.at(-1);
          const bodyRect = body?.getBoundingClientRect();
          const detailRect = detail?.getBoundingClientRect();
          const essayPanelRect = essayPanel?.getBoundingClientRect();
          const sidebarRect = sidebar?.getBoundingClientRect();
          const lastSentenceRect = lastSentence?.getBoundingClientRect();
          return {
            bodyText: body?.textContent.trim() || '',
            bodyWidth: bodyRect?.width || 0,
            detailWidth: detailRect?.width || 0,
            detailLeft: detailRect?.left || 0,
            detailRight: detailRect?.right || 0,
            bodyLeft: bodyRect?.left || 0,
            bodyRight: bodyRect?.right || 0,
            essayPanelHeight: essayPanelRect?.height || 0,
            sidebarHeight: sidebarRect?.height || 0,
            trailingEssaySpace: essayPanelRect && lastSentenceRect
              ? essayPanelRect.bottom - lastSentenceRect.bottom
              : 0,
            documentWidth: document.documentElement.scrollWidth
          };
        }
        """
    )
    if "grammar" not in annotated["bodyText"]:
        raise AssertionError(f"{name}: persisted annotation detail is not visible")
    if annotated["detailLeft"] < annotated["bodyLeft"] - 1 or annotated["detailRight"] > annotated["bodyRight"] + 1:
        raise AssertionError(f"{name}: annotation detail escapes the essay surface")
    if annotated["documentWidth"] > width + 1:
        raise AssertionError(f"{name}: annotated view causes page-level overflow")
    if width > 1040 and annotated["trailingEssaySpace"] > 240:
        raise AssertionError(
            f"{name}: essay panel is stretched by the longer sidebar: {annotated}"
        )
    annotated["activeStyle"] = active_style
    annotated["toggleVerified"] = True
    return annotated


def main():
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = {"status": "passed", "cases": []}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for name, width, height in CASES:
                page = browser.new_page(viewport={"width": width, "height": height})
                page.emulate_media(color_scheme="light", reduced_motion="reduce")
                install_tauri_mock(page)
                page_errors = []
                page.on("pageerror", lambda error: page_errors.append(getattr(error, "stack", str(error))))
                page.goto(f"{BASE_URL}/#/result/writing-result-visual", wait_until="domcontentloaded")
                page.wait_for_selector(".result-page .score-total")
                page.wait_for_function(
                    "() => document.querySelector('.result-layout') && getComputedStyle(document.querySelector('.result-layout')).display === 'grid'"
                )
                geometry = read_geometry(page)
                assert_geometry(name, width, geometry)
                original = verify_original_view(page, name, geometry)
                original["activeStyle"] = verify_active_view_style(page, name, "Original View")
                page.screenshot(
                    path=str(REPORT_DIR / f"writing-result-{name}-original-current.png"),
                    full_page=True,
                )
                annotated = verify_annotated_view(page, name, width)
                if page_errors:
                    raise AssertionError(f"{name}: page errors: {page_errors}")
                page.screenshot(
                    path=str(REPORT_DIR / f"writing-result-{name}-annotated-current.png"),
                    full_page=True,
                )
                report["cases"].append(
                    {"name": name, "geometry": geometry, "original": original, "annotated": annotated}
                )
                page.close()
        finally:
            browser.close()
    (REPORT_DIR / "writing-result-visual-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
