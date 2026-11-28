"""Exercise the shared draft UI and listening resume in an isolated packaged WebView."""
from __future__ import annotations

import os
import shutil
import tempfile
import wave
from contextlib import closing
from pathlib import Path

from packaged_tauri_flow import (
    LISTENING_FIXTURE, ROOT, Driver, click_native_control, close_native_app,
    database_connection, invoke_data, listening_fixture, pick_ports, require,
    resolve_executable, select_listening_section, stage_test_runtime, start_tauri_driver,
    stop_process, wait_for_listening_control, wait_for_listening_view,
    wait_for_reading_view, wait_for_value, wait_for_vue,
)
from webdriver_select import select_native_driver


def block_saves(app_data: Path, activity: str | None) -> None:
    with closing(database_connection(app_data, writable=True)) as conn, conn:
        for operation in ("insert", "update"):
            name = f"e2e_block_draft_{operation}"
            conn.execute(f"DROP TRIGGER IF EXISTS {name}")
            if activity:
                require(activity in ("reading", "listening"), "invalid test activity")
                conn.execute(f"""
                    CREATE TRIGGER {name} BEFORE {operation} ON attempts
                    WHEN NEW.activity = '{activity}' AND NEW.status IN ('draft', 'active')
                    BEGIN SELECT RAISE(ABORT, 'injected draft write failure'); END
                """)


def navigate(driver: Driver, route: str) -> None:
    driver.script("location.hash = arguments[0]", [route])


def assert_failed_save_and_retry(driver: Driver, app_data: Path, route: str, library: str) -> None:
    wait_for_value(driver, """
        return document.querySelector('[data-draft-save-error]')?.innerText.includes('injected draft write failure')
    """, label="visible draft save error")
    navigate(driver, library)
    wait_for_value(driver, """
        return location.hash === arguments[0]
          && [...document.querySelectorAll('[data-draft-save-error] button')].some(node => !node.disabled)
    """, label="failed save blocks leaving the current practice", args=[route])
    block_saves(app_data, None)
    driver.script("document.querySelector('[data-draft-save-error] button').click()")
    wait_for_value(driver, "return !document.querySelector('[data-draft-save-error]')",
                   label="draft retry cleared the error")


def reading_save_failure(driver: Driver, app_data: Path) -> None:
    block_saves(app_data, "reading")
    asset = invoke_data(driver, "reading_list_assets", {})[0]["id"]
    route = f"#/reading/{asset}"
    navigate(driver, route)
    wait_for_reading_view(driver)
    changed = driver.script("""
      const input = document.querySelector('[data-practice-reading-page] #right :is(input, select, textarea)[name]:enabled');
      if (!input) return false;
      if (input.type === 'radio' || input.type === 'checkbox') input.click();
      else {
        input.value = input.tagName === 'SELECT'
            ? [...input.options].find(option => option.value)?.value : 'draft retry';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return true;
    """)
    require(changed, "could not enter a reading answer")
    assert_failed_save_and_retry(driver, app_data, route, "#/")
    navigate(driver, "#/")
    wait_for_value(driver, "return location.hash === '#/' && !document.querySelector('[data-practice-reading-page]')",
                   label="reading leaves after saving")


def listening_save_failure(driver: Driver, app_data: Path, asset: str) -> dict:
    block_saves(app_data, "listening")
    route = f"#/listening/{asset}"
    navigate(driver, route)
    wait_for_listening_view(driver, "[data-listening-question-groups]")
    select_listening_section(driver, 4)
    wait_for_listening_control(driver, "q6", "radio")
    require(click_native_control(driver, "q6", "radio", "A").get("checked"), "could not answer q6")
    wait_for_value(driver, """
        const audio = document.querySelector('[data-listening-audio] audio');
        return audio?.duration > 0 && !document.querySelector('.listening-audio__seek')?.disabled;
    """, label="listening audio metadata")
    driver.script("""
        const seek = document.querySelector('.listening-audio__seek');
        seek.value = String(Number(seek.max) * 0.65);
        seek.dispatchEvent(new Event('input', { bubbles: true }));
    """)
    assert_failed_save_and_retry(driver, app_data, route, "#/listening")
    navigate(driver, "#/listening")
    wait_for_value(driver, "return !document.querySelector('[data-listening-practice]')",
                   label="listening leaves after saving")
    draft = invoke_data(driver, "listening_get_open_draft", {"assetId": asset})
    position = draft["resumePosition"]
    require(position["part"] == 4 and position["questionId"] == "q6" and position["audioPositionMs"] > 0,
            f"wrong persisted resume position: {position}")
    require(draft["durationMs"] > 0, "listening draft has no elapsed duration")
    return draft


def verify_listening_reopen(driver: Driver, asset: str, draft: dict) -> None:
    navigate(driver, f"#/listening/{asset}")
    wait_for_value(driver, """
        const audio = document.querySelector('[data-listening-audio] audio');
        const part = document.querySelectorAll('.listening-section-nav__item')[3];
        const question = document.querySelector('[data-question-id="q6"] .q-item.active');
        return audio?.paused && Math.abs(audio.currentTime - arguments[0]) <= 0.1
          && part?.getAttribute('aria-pressed') === 'true' && question
          && [...document.querySelectorAll('#question-groups input[name=q6]')].some(input => input.value === 'A' && input.checked);
    """, label="paused Part 4 question 6 restored", args=[draft["resumePosition"]["audioPositionMs"] / 1000])
    navigate(driver, "#/listening")
    wait_for_value(driver, "return !document.querySelector('[data-listening-practice]')",
                   label="reopened listening draft leaves after saving")
    saved = invoke_data(driver, "listening_get_open_draft", {"assetId": asset})
    require(draft["durationMs"] <= saved["durationMs"] < draft["durationMs"] + 60_000,
            f"time while the app was closed counted as practice: {saved['durationMs']}")


def main() -> None:
    tauri = resolve_executable("TAURI_DRIVER", ("tauri-driver",), (Path.home() / ".cargo/bin/tauri-driver.exe",))
    require(tauri, "tauri-driver not found")
    native = select_native_driver().path
    # The smoke pack's tiny WAV only proves transport. Use seekable synthetic
    # audio here so nonzero playback position can be asserted after restart.
    with tempfile.TemporaryDirectory(prefix="ielts-draft-audio-") as temporary:
        pack = Path(temporary) / "listening"
        shutil.copytree(LISTENING_FIXTURE, pack)
        with wave.open(str(pack / "audio/exam.wav"), "wb") as audio:
            audio.setparams((1, 2, 8000, 0, "NONE", "not compressed"))
            audio.writeframes(bytes(2 * 8000 * 6))
        staged, binary, _ = stage_test_runtime(ROOT / "target/release/ielts-practice-tauri.exe", {"listening": pack})
    with staged, tempfile.TemporaryDirectory(prefix="ielts-draft-resume-", ignore_cleanup_errors=True) as appdata:
        ports = pick_ports(None)
        driver = Driver(f"http://127.0.0.1:{ports[0]}")
        env = {**os.environ, "APPDATA": appdata, "WEBVIEW2_USER_DATA_FOLDER": str(Path(appdata) / "webview")}
        with (Path(appdata) / "driver.log").open("w", encoding="utf-8") as log:
            process = start_tauri_driver(driver, tauri, native, ports, env, log)
            try:
                driver.create(str(binary))
                wait_for_vue(driver)
                reading_save_failure(driver, Path(appdata))
                print("reading: save failure, leave guard and retry passed", flush=True)
                asset = listening_fixture()["exam"]["examId"]
                draft = listening_save_failure(driver, Path(appdata), asset)
                close_native_app(driver, binary)
                with closing(database_connection(Path(appdata), writable=True)) as conn, conn:
                    conn.execute("UPDATE attempts SET started_at = '2000-01-01T00:00:00Z' WHERE id = ?", (draft["id"],))
                driver.create(str(binary))
                wait_for_vue(driver)
                verify_listening_reopen(driver, asset, draft)
                print("listening: save retry, leave guard, Part/question/paused audio and elapsed time passed", flush=True)
            finally:
                driver.close()
                stop_process(process)


if __name__ == "__main__":
    main()
