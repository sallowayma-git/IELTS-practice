"""Read-only UI verification using an already signed-in Atlas account.

Pass --live-account explicitly. The app owns authentication and catalog sync.
This checks live source tags, Part filters, native rendering and audio metadata.
"""
import argparse
import json
import os
import shutil
import tempfile
from pathlib import Path

from packaged_tauri_flow import (
    Driver, ROOT, pick_ports, require, select_native_driver, stage_test_runtime,
    start_tauri_driver, stop_process, wait_for_value, wait_for_vue,
)


def main(binary):
    staged, runtime, _ = stage_test_runtime(binary)
    reports = ROOT / 'developer/tests/e2e/reports'
    with staged, tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as webview, tempfile.TemporaryFile(mode='w+') as log:
        ports = pick_ports(None)
        driver = Driver(f'http://127.0.0.1:{ports[0]}')
        env = {**os.environ, 'WEBVIEW2_USER_DATA_FOLDER': webview}
        proc = start_tauri_driver(driver, shutil.which('tauri-driver'), str(select_native_driver().path), ports, env, log)
        result = {}
        try:
            driver.create(str(runtime))
            wait_for_vue(driver)
            for channel, route, card in [('reading', '#/?view=browse', '.reading-card'), ('listening', '#/listening', '.listening-card')]:
                driver.script('location.hash = arguments[0]', [route])
                wait_for_value(driver, "return Boolean(document.querySelector('select[aria-label=题源]'))")
                driver.script("const select = document.querySelector('select[aria-label=题源]'); select.value='jiufen'; select.dispatchEvent(new Event('change',{bubbles:true}))")
                wait_for_value(driver, 'return document.querySelectorAll(arguments[0] + " [data-source-tag]").length > 0', 120, label=f'{channel} live source tags', args=[card])
                result[channel] = driver.script('return {count: document.querySelectorAll(arguments[0]).length, tags:[...new Set([...document.querySelectorAll(arguments[0]+" [data-source-tag]")].map(el=>el.textContent.trim()))]}', [card])
                driver.script("document.querySelector('[data-library-part=P1]').click()")
                wait_for_value(driver, "return document.querySelector('[data-library-part=P1]').getAttribute('aria-pressed') === 'true'")
                result[channel]['p1Count'] = driver.script('return document.querySelectorAll(arguments[0]).length', [card])
                require(result[channel]['p1Count'] > 0, f'{channel} P1 empty')
                driver.screenshot(reports / f'jiufen-{channel}-sources.png')
            driver.script("document.querySelector('.listening-card button.listening-card__start:not(:disabled)').click()")
            wait_for_value(driver, "return Boolean(document.querySelector('.listening-exam [data-unified-practice-nav]') && document.querySelector('[data-listening-question-groups] input'))", 60)
            result['nativeListening'] = driver.script("return {title:document.querySelector('.listening-exam__title').textContent, partButtons:document.querySelectorAll('.listening-section-nav__item').length, questionButtons:document.querySelectorAll('.q-item').length, inputs:document.querySelectorAll('[data-listening-question-groups] [name]').length}")
            require(result['nativeListening']['partButtons'] == 4, 'missing Part navigation')
            result['audio'] = wait_for_value(driver, "const a=document.querySelector('audio'); return a && a.readyState > 0 ? {duration:a.duration, readyState:a.readyState, host:new URL(a.src).hostname} : null", 60, label='live listening audio metadata')
            require(result['audio']['host'] == 'static.9fnnn.com', 'wrong audio source')
            driver.script("const audio=document.querySelector('audio'); audio.muted=true; void audio.play()")
            result['audio']['playedSeconds'] = wait_for_value(driver, "const audio=document.querySelector('audio'); return audio.currentTime > 0.3 && !audio.paused ? audio.currentTime : null", 20, label='live audio playback')
            driver.script("document.querySelector('audio').pause()")
            driver.screenshot(reports / 'jiufen-listening-native.png')
            driver.call('POST', f'/session/{driver.sid}/window/rect', {'width': 640, 'height': 900})
            require(driver.script("return document.documentElement.scrollWidth <= window.innerWidth + 1"), 'listening page overflows narrow window')
            driver.screenshot(reports / 'jiufen-listening-narrow.png')
            reports.joinpath('jiufen-native-live-report.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
            print(json.dumps(result, ensure_ascii=False))
        finally:
            driver.close()
            stop_process(proc)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('binary', type=Path)
    parser.add_argument('--live-account', action='store_true', required=True)
    args = parser.parse_args()
    main(args.binary.resolve())
