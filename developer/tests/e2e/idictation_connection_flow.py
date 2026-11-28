"""Exercise Atlas connection visibility and lifecycle.

Default checks use temporary APPDATA without logging in. --existing-profile
checks read-only catalogs using the user's existing login, without credentials.
"""
import ctypes
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


def product_window():
    user32 = ctypes.windll.user32
    user32.FindWindowW.restype = ctypes.c_void_p
    user32.FindWindowW.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p]
    return user32.FindWindowW(None, '爱听写 · 登录并连接 IELTS Atlas')


def product_visible():
    handle = product_window()
    ctypes.windll.user32.IsWindowVisible.argtypes = [ctypes.c_void_p]
    return bool(handle and ctypes.windll.user32.IsWindowVisible(handle))


def wait_product_visibility(visible):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if product_window() and product_visible() == visible:
            return
        time.sleep(.05)
    raise RuntimeError(f'product window visibility did not become {visible}')


def check_authenticated_background(driver):
    checks = {}
    previous_handle = None
    for iteration in range(3):
        if iteration == 2:
            driver.script("return window.__TAURI_INTERNALS__.invoke('idictation_disconnect')")
            deadline = time.monotonic() + 10
            while product_window() and time.monotonic() < deadline:
                time.sleep(.05)
            require(not product_window(), 'disconnect retained the background window')
        driver.script("""
            window.__atlasBackgroundProbe = {status:'waiting'};
            window.__TAURI_INTERNALS__.invoke('idictation_reading_catalog').then(
                rows => { window.__atlasBackgroundProbe = {status:'ok', count:rows.length}; },
                error => { window.__atlasBackgroundProbe = {status:'failed', error:String(error)}; }
            );
        """)
        deadline = time.monotonic() + 85
        exposed = False
        while time.monotonic() < deadline:
            exposed = exposed or product_visible()
            result = driver.script('return window.__atlasBackgroundProbe')
            if result.get('status') != 'waiting':
                break
            time.sleep(.1)
        require(result.get('status') == 'ok', f'authenticated catalog failed: {result}')
        require(not exposed, 'authenticated catalog exposed the source window')
        require(result.get('count', 0) > 0, 'authenticated catalog is empty')
        if iteration == 1:
            require(product_window() == previous_handle, 'repeat catalog recreated the WebView')
        previous_handle = product_window()
        checks[['authenticatedHiddenCatalog', 'repeatCatalogReusesWindow',
                'recreatedHiddenWindowRestoresLogin'][iteration]] = 'passed'
    driver.script("return window.__TAURI_INTERNALS__.invoke('idictation_open_login')")
    wait_product_visibility(True)
    driver.script("return window.__TAURI_INTERNALS__.invoke('idictation_connect')")
    wait_product_visibility(False)
    checks['confirmedLoginReturnsToBackground'] = 'passed'
    return checks


def authenticated_main(binary):
    staged, runtime, _ = stage_test_runtime(binary)
    report = ROOT / 'developer/tests/e2e/reports/idictation-background-authenticated.json'
    with staged, tempfile.TemporaryFile(mode='w+') as log:
        ports = pick_ports(None)
        driver = Driver(f'http://127.0.0.1:{ports[0]}')
        proc = start_tauri_driver(driver, shutil.which('tauri-driver'),
            str(select_native_driver().path), ports, dict(os.environ), log)
        try:
            driver.create(str(runtime))
            wait_for_vue(driver)
            checks = check_authenticated_background(driver)
            report.write_text(json.dumps({'checks':checks, 'binarySha256':sha256_file(binary),
                'remoteAuthenticated':True, 'remoteWritesTested':False}, indent=2), 'utf-8')
            print(json.dumps(checks))
        finally:
            driver.close()
            stop_process(proc)


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
            wait_product_visibility(False)
            checks['backgroundConnectionStartsHidden'] = 'passed'
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
            wait_product_visibility(True)
            checks['anonymousAccountIsDisconnected'] = 'passed'
            checks['loginRequiredShowsProductWindow'] = 'passed'
            handle = product_window()
            ctypes.windll.user32.PostMessageW.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_size_t, ctypes.c_ssize_t]
            ctypes.windll.user32.PostMessageW(handle, 0x0010, 0, 0)  # WM_CLOSE
            wait_product_visibility(False)
            require(product_window() == handle, 'closing login destroyed the reusable WebView')
            checks['closingLoginRetainsHiddenConnection'] = 'passed'
            driver.script("return window.__TAURI_INTERNALS__.invoke('idictation_open_login')")
            wait_product_visibility(True)
            require(product_window() == handle, 'explicit login created a second WebView')
            checks['explicitLoginReusesExistingWindow'] = 'passed'
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
            wait_product_visibility(False)
            checks['readingCatalogStartsHidden'] = 'passed'
            deadline = time.time() + 10
            while time.time() < deadline:
                if len(driver.call('GET', f'/session/{driver.sid}/window/handles').get('value', [])) == 2:
                    break
                time.sleep(.1)
            else:
                raise RuntimeError('the reading library did not reopen the product window')
            wait_for_value(driver, "return window.__atlasCatalogProbe !== 'waiting'", timeout_seconds=65)
            require(driver.script("return window.__atlasCatalogProbe") == 'login-required', 'the anonymous catalog must require authentication')
            wait_product_visibility(True)
            checks['readingCatalogReopensProductWindowAndRequiresLogin'] = 'passed'
            main_handle = ctypes.windll.user32.FindWindowW(None, 'IELTS Practice')
            require(bool(main_handle), 'Atlas main window was not found')
            ctypes.windll.user32.PostMessageW(main_handle, 0x0010, 0, 0)
            deadline = time.monotonic() + 10
            while product_window() and time.monotonic() < deadline:
                time.sleep(.1)
            require(not product_window(), 'closing Atlas retained the background WebView')
            checks['closingAtlasDestroysProductWindow'] = 'passed'
            report.write_text(json.dumps({'checks': checks, 'binarySha256': sha256_file(binary),
                'remoteAuthenticated': False, 'remoteSyncValidated': False}, indent=2), 'utf-8')
            print(json.dumps(checks))
        finally:
            driver.close()
            stop_process(proc)


if __name__ == '__main__':
    run = authenticated_main if '--existing-profile' in sys.argv else main
    run(Path(sys.argv[1]).resolve())
