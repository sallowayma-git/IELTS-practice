"""Verify book filtering and review persistence in an isolated packaged app.

Uses synthetic words in temporary APPDATA. Does not contact a source provider or
read the user's database. Reuses the already built host; never builds the app.
"""
import json
import os
import shutil
import sys
import tempfile
from contextlib import closing
from pathlib import Path

from packaged_tauri_flow import (
    Driver, ROOT, database_connection, pick_ports, require, select_native_driver,
    stage_test_runtime, start_tauri_driver, stop_process, wait_for_value, wait_for_vue,
)


def seed(folder):
    with closing(database_connection(folder, writable=True)) as conn, conn:
        conn.execute("INSERT INTO vocabulary_books VALUES ('book-a','fixture','owner','1','测试词书 A','now')")
        conn.execute("INSERT INTO vocabulary_books VALUES ('book-b','fixture','owner','2','测试词书 B','now')")
        for unit, book, title, pos in [('unit-a', 'book-a', '第一章', 0), ('unit-b', 'book-a', '第二章', 1), ('unit-c', 'book-b', '独立章节', 0)]:
            conn.execute("INSERT INTO vocabulary_book_units VALUES (?,?,?,?,?)", (unit, book, unit, title, pos))
        for i in range(601):
            word_id, term = f'fixture-{i:04}', f'word{i:04}'
            conn.execute("INSERT INTO vocabulary_items(id,term,normalized_term,definition,tags_json,created_at,updated_at) VALUES (?,?,?,?,'[]',?,?)",
                         (word_id, term, term, f'测试释义 {i}', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z'))
            conn.execute("INSERT INTO vocabulary_review_state(item_id) VALUES (?)", (word_id,))
            unit = 'unit-a' if i < 600 else 'unit-c'
            conn.execute("INSERT INTO vocabulary_book_entries VALUES (?,?,?,?)", (unit, str(i), word_id, i))
        # A repeated source occurrence must not duplicate the whole-book queue.
        conn.execute("INSERT INTO vocabulary_book_entries VALUES ('unit-b','shared','fixture-0000',0)")


def select(driver, label, value):
    driver.script("const el=document.querySelector('select[aria-label=" + label + "]'); el.value=arguments[0]; el.dispatchEvent(new Event('change',{bubbles:true}))", [value])


def rows(driver, count):
    wait_for_value(driver, "return document.querySelectorAll('[data-vocab-row]').length === arguments[0] && !document.body.innerText.includes('正在加载生词本')", args=[count])


def main(binary):
    staged, runtime, _ = stage_test_runtime(binary)
    report = ROOT / 'developer/tests/e2e/reports/vocabulary-books-flow.json'
    with staged, tempfile.TemporaryDirectory(prefix='atlas-vocab-', ignore_cleanup_errors=True) as folder, tempfile.TemporaryFile(mode='w+') as log:
        ports = pick_ports(None)
        driver = Driver(f'http://127.0.0.1:{ports[0]}')
        env = {**os.environ, 'APPDATA': folder, 'WEBVIEW2_USER_DATA_FOLDER': str(Path(folder) / 'webview')}
        proc = start_tauri_driver(driver, shutil.which('tauri-driver'), str(select_native_driver().path), ports, env, log)
        checks = {}
        try:
            driver.create(str(runtime))
            wait_for_vue(driver)
            seed(Path(folder))
            driver.script("location.hash='#/vocabulary'")
            rows(driver, 601)
            checks['beyond500'] = 'passed'
            select(driver, '选择词书', 'book-a')
            rows(driver, 600)
            checks['wholeBookDeduplication'] = 'passed'
            select(driver, '选择章节', 'unit-b')
            rows(driver, 1)
            require(driver.script("return document.querySelector('[data-vocab-term]').textContent") == 'word0000', 'wrong unit word')
            driver.screenshot(ROOT / 'developer/tests/e2e/reports/vocabulary-books-current.png')
            checks['unitFilter'] = 'passed'
            driver.script("document.querySelector('.page-header-actions button').click()")
            wait_for_value(driver, "return !!document.querySelector('.vocab-session__term')")
            driver.script("[...document.querySelectorAll('.vocab-session__ratings button')].find(e=>e.textContent==='很熟').click()")
            wait_for_value(driver, "return !!document.querySelector('.vocab-session__input')")
            driver.script("const input=document.querySelector('.vocab-session__input'); input.value='word0000'; input.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('.vocab-session__form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))")
            wait_for_value(driver, "return document.body.innerText.includes('已保存 1 条复习记录')")
            driver.script("document.querySelector('.vocab-session__complete button').click()")
            rows(driver, 1)
            checks['nativeReview'] = 'passed'
            select(driver, '选择词书', 'book-b')
            rows(driver, 1)
            require(driver.script("return document.querySelector('[data-vocab-term]').textContent") == 'word0600', 'stale book data')
            checks['switchBook'] = 'passed'
            with closing(database_connection(Path(folder))) as conn:
                reviewed = conn.execute("SELECT last_reviewed_at FROM vocabulary_review_state WHERE item_id='fixture-0000'").fetchone()[0]
                require(reviewed is not None, 'review was not durable')
            driver.script('location.reload()')
            wait_for_vue(driver)
            driver.script("location.hash='#/vocabulary'")
            rows(driver, 601)
            checks['reload'] = 'passed'
            report.write_text(json.dumps({'checks': checks, 'syntheticData': True, 'remoteProviderValidated': False}, indent=2), 'utf-8')
            print(json.dumps(checks))
        finally:
            driver.close()
            stop_process(proc)


if __name__ == '__main__':
    main(Path(sys.argv[1]).resolve())
