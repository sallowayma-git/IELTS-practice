"""Exercise hotlist tags and combined filters through the existing library views."""
import json
import os
from pathlib import Path

from playwright.sync_api import expect, sync_playwright
from exam_freeze_visual_check import serve, settle


REPORTS = Path(__file__).parent / "reports"
MOCK = r"""
(() => {
  const remote = ['reading','listening'].flatMap(channel => [
    {id:channel+'-hot',title:'Hot '+channel,channel,parts:['P1','P2'],available:true,
      albums:[{id:'z',title:'Z家精选'}], hotlist:[{part:'P2',rank:2},{part:'P2',rank:3}]},
    {id:channel+'-plain',title:'Plain '+channel,channel,parts:['P2'],available:true,albums:[]}
  ]);
  const invoke = async command => {
    if (command === 'jiufen_restore' || command === 'jiufen_is_connected') return true;
    if (command === 'jiufen_library') return {items:remote,warning:null};
    if (command === 'reading_list_assets' || command === 'listening_list_assets') {
      const activity = command.split('_')[0];
      return {ok:true,data:[{id:activity+'-local',activity,title:'Local '+activity,
        category:'P2',frequency:'high',schemaVersion:2,sourceKind:'builtin'}]};
    }
    if (command === 'list_settings') return {ok:true,data:[]};
    if (command === 'list_history') return {ok:true,data:{items:[],total:0,limit:20,offset:0,nextCursor:null}};
    return {ok:true,data:null};
  };
  window.__TAURI__ = {core:{invoke}};
  window.__TAURI_INTERNALS__ = {invoke};
})();
"""


def main():
    base = os.environ.get("READING_LIBRARY_VISUAL_BASE_URL")
    process = None
    if not base:
        process, base = serve()
    report = []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            try:
                for width in (1440, 360, 320):
                    page = browser.new_page(viewport={"width": width, "height": 900}, reduced_motion="reduce")
                    page.add_init_script(MOCK)
                    for channel, route, selector in (
                        ("reading", "/?view=browse", ".reading-card"),
                        ("listening", "/listening", ".listening-card"),
                    ):
                        page.goto(f"{base}/#{route}", wait_until="networkidle")
                        settle(page, selector)
                        cards = page.locator(selector)
                        expect(cards).to_have_count(3)
                        expect(page.locator("[data-hotlist-tag]")).to_have_count(1)
                        toggle = page.locator("[data-hotlist-filter]")
                        expect(toggle).to_have_attribute("aria-pressed", "false")
                        toggle.click()
                        expect(cards).to_have_count(1)
                        expect(cards).to_contain_text(f"Hot {channel}")
                        page.locator("[data-library-part=P1]").click()
                        expect(cards).to_have_count(0)
                        page.locator("[data-library-part=P2]").click()
                        expect(cards).to_have_count(1)
                        page.locator('select[aria-label="题源"]').select_option("local")
                        expect(cards).to_have_count(0)
                        page.locator('select[aria-label="题源"]').select_option("jiufen")
                        expect(cards).to_have_count(1)
                        page.locator('select[aria-label="题源"]').select_option("all")
                        if channel == "reading":
                            expect(page.locator("[data-frequency-filter]")).to_have_count(3)
                            page.locator('[data-frequency-filter="high"]').click()
                        else:
                            page.locator('.listening-library__filter').filter(has_text="频率").locator("select").select_option("high")
                        expect(cards).to_have_count(0)
                        toggle.click()
                        expect(cards).to_have_count(1)
                        expect(cards).to_contain_text(f"Local {channel}")
                        if channel == "reading":
                            expect(page.locator('[data-frequency-filter="high"]')).to_have_attribute("aria-pressed", "true")
                            page.locator('[data-frequency-filter="high"]').click()
                        else:
                            page.locator('.listening-library__filter').filter(has_text="频率").locator("select").select_option("all")
                        toggle.click()
                        expect(cards).to_have_count(1)
                        expect(page.locator("[data-hotlist-tag]")).to_have_count(1)
                        toggle.scroll_into_view_if_needed()
                        geometry = toggle.bounding_box()
                        assert geometry and geometry["x"] >= -1 and geometry["x"] + geometry["width"] <= width + 1
                        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), f"{channel}/{width} overflows"
                        page.screenshot(path=str(REPORTS / f"jiufen-hotlist-{channel}-{width}.png"), full_page=True)
                        report.append({"channel": channel, "width": width, "status": "passed"})
                    page.close()
            finally:
                browser.close()
    finally:
        if process:
            process.terminate()
            process.wait()
    REPORTS.joinpath("jiufen-hotlist-visual-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
