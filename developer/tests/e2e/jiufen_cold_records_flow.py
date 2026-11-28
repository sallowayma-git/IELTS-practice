"""Check local Jiufen history and draft routes in a restarted packaged app."""
from __future__ import annotations

import json
import os
import tempfile
from contextlib import closing
from pathlib import Path

from packaged_tauri_flow import (
    ROOT, Driver, close_native_app, database_connection, pick_ports, require, resolve_executable,
    stage_test_runtime, start_tauri_driver, stop_process, wait_for_value, wait_for_vue,
)
from webdriver_select import select_native_driver

NOW = "2026-01-01T12:00:00+00:00"


def seed_records(app_data: Path) -> None:
    with closing(database_connection(app_data, writable=True)) as conn, conn:
        for channel in ("reading", "listening"):
            asset_id = f"jiufen-native-cold-{channel}"
            conn.execute(
                """INSERT INTO practice_assets
                   (id, activity, source_kind, source_key, title, schema_version, fingerprint,
                    metadata_json, created_at, updated_at)
                   VALUES (?, ?, 'imported', ?, ?, 2, 'fixture', ?, ?, ?)""",
                (asset_id, channel, f"fixture-{channel}", f"Cold {channel}",
                 json.dumps({"remoteProvider": "jiufen", "jiufenOwner": "fixture-owner"}), NOW, NOW),
            )
            for status, answer in (("completed", "B"), ("draft", "C")):
                scored = status == "completed"
                attempt_id = f"{channel}-cold-{status}"
                conn.execute(
                    """INSERT INTO attempts
                       (id, activity, asset_id, mode, status, started_at, submitted_at, completed_at,
                        score_value, score_scale, correct_count, question_count, title_snapshot,
                        schema_version, created_at, updated_at)
                       VALUES (?, ?, ?, 'single', ?, ?, ?, ?, ?, ?, ?, ?, ?, 2, ?, ?)""",
                    (attempt_id, channel, asset_id, status, NOW, NOW if scored else None,
                     NOW if scored else None, 1.0 if scored else None, "ratio" if scored else None,
                     1 if scored else None, 1 if scored else None, f"Cold {channel}", NOW, NOW),
                )
                conn.execute(
                    "INSERT INTO attempt_answers (attempt_id, question_id, answer_json, is_correct) VALUES (?, 'q1', ?, ?)",
                    (attempt_id, json.dumps(answer), 1 if scored else None),
                )


def check_routes(driver: Driver, channel: str) -> None:
    asset_id = f"jiufen-native-cold-{channel}"
    driver.script("location.hash = arguments[0]", [f"#/{channel}/{asset_id}/review/{channel}-cold-completed"])
    wait_for_value(driver, """
      const card = document.querySelector('[data-local-practice-record]');
      return card?.innerText.includes('答对 1 / 1') && card.innerText.includes('q1：B')
        && document.querySelector('[role=alert] button')?.textContent.includes('重试');
    """, label=f"{channel} local completed record and retry")
    require(not driver.script("return !!document.querySelector('input[name=q1]:enabled')"),
            f"{channel} remote failure enabled an answer input")
    driver.script("location.hash = arguments[0]", [f"#/{channel}" if channel == "listening" else "#/"])
    link = wait_for_value(driver, """
      return [...document.querySelectorAll('a')].find(link =>
        link.href.includes(arguments[0]) && link.textContent.includes('继续作答'))?.hash;
    """, label=f"{channel} draft entry in library", args=[asset_id])
    driver.script("location.hash = arguments[0]", [link])
    wait_for_value(driver, """
      const card = document.querySelector('[data-local-practice-record]');
      return card?.innerText.includes('未提交草稿') && card.innerText.includes('q1：C');
    """, label=f"{channel} original draft answers")


def main() -> None:
    tauri = resolve_executable("TAURI_DRIVER", ("tauri-driver",), (Path.home() / ".cargo/bin/tauri-driver.exe",))
    require(tauri, "tauri-driver not found")
    native = select_native_driver().path
    staged, binary, _ = stage_test_runtime(ROOT / "target/release/ielts-practice-tauri.exe")
    with staged, tempfile.TemporaryDirectory(prefix="ielts-jiufen-cold-", ignore_cleanup_errors=True) as appdata:
        ports = pick_ports(None)
        driver = Driver(f"http://127.0.0.1:{ports[0]}")
        env = {**os.environ, "APPDATA": appdata, "WEBVIEW2_USER_DATA_FOLDER": str(Path(appdata) / "webview")}
        with (Path(appdata) / "driver.log").open("w", encoding="utf-8") as log:
            process = start_tauri_driver(driver, tauri, native, ports, env, log)
            try:
                driver.create(str(binary))
                wait_for_vue(driver)
                close_native_app(driver, binary)
                seed_records(Path(appdata))
                driver.create(str(binary))
                wait_for_vue(driver)
                for channel in ("reading", "listening"):
                    check_routes(driver, channel)
                    print(f"{channel}: cold local history and old draft passed")
            finally:
                driver.close()
                stop_process(process)


if __name__ == "__main__":
    main()
