"""Exercise the real Atlas connection panel without authenticating to the source.

Uses temporary APPDATA and the existing executable. Never enters credentials,
imports source content, or treats the login window opening as a successful sync.
"""
import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

from packaged_tauri_flow import (
    Driver, ROOT, pick_ports, require, select_native_driver, sha256_file,
    stage_test_runtime, start_tauri_driver, stop_process, wait_for_value, wait_for_vue,
)


def main(binary):
    staged, runtime, _ = stage_test_runtime(binary)
    report = ROOT / 'developer/tests/e2e/reports/idictation-connection-flow.json'
    with staged, tempfile.TemporaryDirectory(prefix='atlas-idictation-', ignore_cleanup_errors=True) as folder, tempfile.TemporaryFile(mode='w+') as log:
        ports = pick_ports(None)
        driver = Driver(f'http://127.0.0.1:{ports[0]}')
        env = {**os.environ, 'APPDATA': folder, 'WEBVIEW2_USER_DATA_FOLDER': str(Path(folder) / 'webview')}
        proc = start_tauri_driver(driver, shutil.which('tauri-driver'), str(select_native_driver().path), ports, env, log)
        checks = {}
        try:
            driver.create(str(runtime))
            wait_for_vue(driver)
            require(driver.script('return Object.isFrozen(Object.prototype)') is True, 'main prototype protection is missing')
            checks['mainPrototypeProtection'] = 'passed'
            driver.script("location.hash='#/settings'")
            wait_for_value(driver, "return !!document.querySelector('[data-idictation-account] button')")
            driver.script("document.querySelector('[data-idictation-account] button').click()")
            wait_for_value(driver, "return document.querySelector('[data-idictation-account] dialog').open")
            checks['existingSettingsEntry'] = 'passed'
            driver.script("return window.__TAURI_INTERNALS__.invoke('idictation_disconnect')")
            checks['disconnectWithoutWindow'] = 'passed'
            driver.script("[...document.querySelectorAll('[data-idictation-account] button')].find(e=>e.textContent==='已登录，连接账号').click()")
            deadline = time.time() + 10
            while time.time() < deadline:
                if len(driver.call('GET', f'/session/{driver.sid}/window/handles').get('value', [])) == 2:
                    break
                time.sleep(.1)
            else:
                raise RuntimeError('connecting did not reopen the product window')
            checks['connectReopensSeparateProductWindow'] = 'passed'
            wait_for_value(driver, "return !!document.querySelector('[data-idictation-account] [role=alert]')", timeout_seconds=65)
            require(driver.script("return document.querySelectorAll('[data-idictation-account] select').length") == 0, 'anonymous connection retained catalog UI')
            checks['anonymousAccountIsDisconnected'] = 'passed'
            driver.screenshot(ROOT / 'developer/tests/e2e/reports/idictation-connection-current.png')
            driver.script("return window.__TAURI_INTERNALS__.invoke('idictation_disconnect')")
            deadline = time.time() + 10
            while time.time() < deadline:
                if len(driver.call('GET', f'/session/{driver.sid}/window/handles').get('value', [])) == 1:
                    break
                time.sleep(.1)
            else:
                raise RuntimeError('disconnect did not close product window')
            checks['disconnectClosesProductWindow'] = 'passed'
            # Exercise the library command directly after the source window
            # was closed. The temporary profile must still require login.
            driver.script("""
                window.__atlasCatalogProbe = 'waiting';
                window.__TAURI_INTERNALS__.invoke('idictation_reading_catalog').then(
                    () => { window.__atlasCatalogProbe = 'unexpected-success'; },
                    () => { window.__atlasCatalogProbe = 'login-required'; }
                );
            """)
            deadline = time.time() + 10
            while time.time() < deadline:
                if len(driver.call('GET', f'/session/{driver.sid}/window/handles').get('value', [])) == 2:
                    break
                time.sleep(.1)
            else:
                raise RuntimeError('the reading library did not reopen the product window')
            wait_for_value(driver, "return window.__atlasCatalogProbe !== 'waiting'", timeout_seconds=65)
            require(driver.script("return window.__atlasCatalogProbe") == 'login-required', 'the anonymous catalog must require authentication')
            checks['readingCatalogReopensProductWindowAndRequiresLogin'] = 'passed'
            report.write_text(json.dumps({'checks': checks, 'binarySha256': sha256_file(binary),
                'remoteAuthenticated': False, 'remoteSyncValidated': False}, indent=2), 'utf-8')
            print(json.dumps(checks))
        finally:
            driver.close()
            stop_process(proc)


if __name__ == '__main__':
    main(Path(sys.argv[1]).resolve())
