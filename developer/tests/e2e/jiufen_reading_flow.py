"""Exercise the shipping Jiufen login and library filters in an isolated packaged client."""
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

from packaged_tauri_flow import (
    Driver, pick_ports, require, select_native_driver,
    stage_test_runtime, start_tauri_driver, stop_process,
    wait_for_value, wait_for_vue,
)


def button(driver, selector):
    wait_for_value(driver, f"return Boolean(document.querySelector({json.dumps(selector)}))")
    driver.script("document.querySelector(arguments[0]).click()", [selector])


def main(binary):
    staged, runtime, _ = stage_test_runtime(binary)
    native = select_native_driver().path
    tauri = shutil.which("tauri-driver")
    require(tauri, "tauri-driver missing")
    with staged, tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as folder, tempfile.TemporaryFile(mode="w+") as log:
        ports = pick_ports(None)
        driver = Driver(f"http://127.0.0.1:{ports[0]}")
        env = {**os.environ, "APPDATA": folder, "WEBVIEW2_USER_DATA_FOLDER": str(Path(folder) / "webview")}
        proc = start_tauri_driver(driver, tauri, str(native), ports, env, log)
        try:
            driver.create(str(runtime))
            wait_for_vue(driver)
            driver.script("location.hash = '#/settings'")
            button(driver, "#settings-general [data-jiufen-account] > button")
            wait_for_value(driver, "return Boolean(document.querySelector('[data-jiufen-account] dialog[open] input[type=email]'))")
            require(not driver.script("return document.body.innerText.includes('提交并核对')"), "developer action leaked into Settings")
            button(driver, "[data-jiufen-account] dialog [aria-label=关闭]")
            driver.script("location.hash = '#/?view=browse'")
            wait_for_value(driver, "return document.querySelectorAll('.nav-sub-item').length === 3")
            require(driver.script("return [...document.querySelectorAll('.nav-sub-item')].map(el=>el.textContent.trim())") == ['阅读','写作','听力'], "wrong library tabs")
            button(driver, "[data-library-part=P2]")
            wait_for_value(driver, "return document.querySelectorAll('.reading-card').length > 0 && [...document.querySelectorAll('.reading-card .tag-neutral:first-child')].every(el => el.textContent === 'P2')")
            button(driver, ".nav-sub-item[href$=listening]")
            button(driver, "[data-library-part=P4]")
            print("Jiufen packaged UI passed: General login dialog, three library tabs and Part filters.")
        finally:
            driver.close()
            stop_process(proc)


if __name__ == "__main__":
    main(Path(sys.argv[1]).resolve())
