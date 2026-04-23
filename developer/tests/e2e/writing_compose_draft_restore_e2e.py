#!/usr/bin/env python3
"""Writing compose free-mode + draft restore regression.

Covers real file:// runtime for the writing Vue app:
1. malformed draft payload is self-healed instead of poisoning startup
2. free-writing draft survives a reload inside the debounce window
3. submit failure keeps the draft recoverable for retry
4. duplicate submit clicks still create only one evaluation session
5. successful submit clears the draft
6. bank-mode draft restores topic/category and submits topic_id payload
7. invalid bank-topic draft falls back to free mode without losing prompt/content
8. invalid draft enums self-heal back to legal UI state
9. discard removes draft cleanly
10. task/category rapid switching keeps only the latest topic list
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
DIST_ENTRY = REPO_ROOT / "dist" / "writing" / "index.html"
DRAFT_KEY = "ielts_writing_draft_compose-essay"
SESSION_ID = "11111111-1111-4111-8111-111111111111"
TOPIC_TEXT = "Some people think university education should be free for everyone. Discuss both views and give your own opinion."
ESSAY_TEXT = " ".join([
    "University education should become more affordable because equal access creates broader social mobility and improves long-term productivity."
] * 16)
BANK_TOPIC_ID = 2001
BANK_SOCIETY_TOPIC_ID = 2002
BANK_MISSING_TOPIC_ID = 9999
BANK_TOPIC_CATEGORY = "technology"
BANK_SOCIETY_TOPIC_CATEGORY = "society"
BANK_ESSAY_TEXT = " ".join([
    "Technology can support teachers, but replacing human guidance entirely usually harms student motivation and critical thinking growth."
] * 16)
BANK_SOCIETY_TOPIC_TEXT = "Some people believe remote work weakens communities, while others think it improves quality of life. Discuss both views and give your opinion."
BANK_SOCIETY_TOPIC_LABEL_SNIPPET = "Some people believe remote work weakens communities"
BANK_MISSING_TOPIC_TEXT = "Some people think online education platforms should replace physical classrooms. Discuss both views and give your opinion."

try:
    from playwright.async_api import async_playwright  # type: ignore[import-untyped]
except ModuleNotFoundError:
    venv_dir = (REPO_ROOT / ".venv").resolve()
    venv_python = REPO_ROOT / ".venv" / "bin" / "python"
    current_prefix = Path(sys.prefix).resolve()
    if venv_python.exists() and current_prefix != venv_dir:
        completed = subprocess.run([str(venv_python), str(Path(__file__).resolve())], cwd=str(REPO_ROOT))
        raise SystemExit(completed.returncode)
    raise SystemExit(json.dumps({"status": "fail", "detail": "playwright_python_missing"}, ensure_ascii=False))


def ensure_bundle() -> None:
    if DIST_ENTRY.exists():
        return
    completed = subprocess.run(
        ["npm", "run", "build:writing"],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        detail = completed.stdout or completed.stderr or "unknown build failure"
        raise SystemExit(json.dumps({"status": "fail", "detail": f"build_failed: {detail.strip()}"}, ensure_ascii=False))


async def install_api_stub(page) -> None:
    await page.add_init_script(
        """
        (() => {
          const topicFixtures = [
            {
              id: 2001,
              type: 'task2',
              category: 'technology',
              title_json: {
                type: 'doc',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'Some people think artificial intelligence will replace teachers in classrooms. Discuss both views and give your opinion.' }] }
                ]
              }
            },
            {
              id: 2002,
              type: 'task2',
              category: 'society',
              title_json: {
                type: 'doc',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'Some people believe remote work weakens communities, while others think it improves quality of life. Discuss both views and give your opinion.' }] }
                ]
              }
            },
            {
              id: 3001,
              type: 'task1',
              category: 'line_chart',
              title_json: {
                type: 'doc',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'The chart below shows energy use in four countries between 1990 and 2020.' }] }
                ]
              }
            }
          ];
          const LOCAL_API_BASE_URL = 'http://127.0.0.1:3905';

          const createHeaders = (contentType = 'application/json') => ({
            get(name) {
              return String(name || '').toLowerCase() === 'content-type' ? contentType : '';
            }
          });

          const createJsonResponse = (payload, ok = true, status = 200) => ({
            ok,
            status,
            headers: createHeaders('application/json'),
            async json() {
              return payload;
            },
            async text() {
              return JSON.stringify(payload);
            }
          });

          class StubEventSource {
            constructor(url) {
              this.url = url;
              this.readyState = 1;
              this.listeners = new Map();
              this.onerror = null;
            }

            addEventListener(type, callback) {
              if (!this.listeners.has(type)) {
                this.listeners.set(type, []);
              }
              this.listeners.get(type).push(callback);
            }

            removeEventListener(type, callback) {
              const list = this.listeners.get(type) || [];
              this.listeners.set(type, list.filter((item) => item !== callback));
            }

            close() {
              this.readyState = 2;
            }
          }

          window.__writingStartCalls = [];
          window.__writingStartMode = 'success';
          window.__topicListDelayConfig = {};
          window.__topicListRequests = [];
          window.__writingStubState = { localApiBaseUrl: LOCAL_API_BASE_URL };
          window.electronAPI = {
            getLocalApiInfo: async () => ({
              success: true,
              data: { baseUrl: LOCAL_API_BASE_URL }
            })
          };
          window.EventSource = StubEventSource;
          window.fetch = async (input, init = {}) => {
            const url = typeof input === 'string' ? input : String(input && input.url ? input.url : '');
            if (!url.startsWith(LOCAL_API_BASE_URL)) {
              throw new Error(`unexpected_fetch_url:${url}`);
            }

            const parsed = new URL(url);
            const pathname = parsed.pathname;
            const method = String(init.method || 'GET').toUpperCase();
            const body = init.body ? JSON.parse(init.body) : null;

            if (pathname === '/api/writing/evaluations' && method === 'POST') {
              window.__writingStartCalls.push(body);
              if (window.__writingStartMode === 'fail') {
                return createJsonResponse({
                  error: 'network_error',
                  message: 'simulated failure'
                }, false, 503);
              }
              return createJsonResponse({
                success: true,
                data: { sessionId: '11111111-1111-4111-8111-111111111111' }
              });
            }

            if (pathname === '/api/writing/evaluations/11111111-1111-4111-8111-111111111111' && method === 'GET') {
              return createJsonResponse({
                success: true,
                data: { sessionId: '11111111-1111-4111-8111-111111111111', events: [] }
              });
            }

            if (pathname === '/api/writing/evaluations/11111111-1111-4111-8111-111111111111' && method === 'DELETE') {
              return createJsonResponse({
                success: true,
                data: { ok: true }
              });
            }

            if (pathname === '/api/topics' && method === 'GET') {
              const type = parsed.searchParams.get('type') || '';
              const category = parsed.searchParams.get('category') || '';
              const delayConfig = window.__topicListDelayConfig || {};
              const delay = Number(
                delayConfig[`${type}:${category}`]
                || delayConfig[type]
                || delayConfig[category]
                || 0
              );
              if (delay > 0) {
                await new Promise((resolve) => setTimeout(resolve, delay));
              }
              window.__topicListRequests.push({ type, category, delay });
              const list = topicFixtures.filter((topic) => {
                if (type && topic.type !== type) return false;
                if (category && topic.category !== category) return false;
                return true;
              });
              return createJsonResponse({
                success: true,
                data: { data: list, total: list.length }
              });
            }

            if (pathname.startsWith('/api/topics/') && method === 'GET') {
              const id = Number(pathname.split('/').pop());
              const topic = topicFixtures.find((item) => item.id === id);
              if (!topic) {
                return createJsonResponse({
                  error: 'not_found',
                  message: 'topic not found'
                }, false, 404);
              }
              return createJsonResponse({
                success: true,
                data: topic
              });
            }

            throw new Error(`unhandled_local_api_request:${method}:${pathname}`);
          };
        })();
        """
    )


async def wait_for_compose(page) -> None:
    await page.wait_for_selector('h2:has-text("作文输入")', timeout=20000)
    await page.wait_for_selector('#custom-topic-text', timeout=20000)
    await page.wait_for_selector('.essay-input', timeout=20000)


async def read_draft(page):
    raw = await page.evaluate(f"() => window.localStorage.getItem('{DRAFT_KEY}')")
    return json.loads(raw) if raw else None


async def set_start_mode(page, mode: str) -> None:
    await page.evaluate(f"(value) => {{ window.__writingStartMode = value; }}", mode)


async def run_regression() -> dict:
    ensure_bundle()
    entry_url = DIST_ENTRY.as_uri()

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            headless=True,
            args=["--allow-file-access-from-files"],
        )
        page = await browser.new_page()
        await install_api_stub(page)

        await page.goto(entry_url)
        await wait_for_compose(page)
        await page.evaluate("() => { localStorage.clear(); sessionStorage.clear(); }")
        await page.reload()
        await wait_for_compose(page)

        await page.evaluate(f"() => localStorage.setItem('{DRAFT_KEY}', '{{bad-json')")  # malformed payload probe
        await page.reload()
        await wait_for_compose(page)
        if await page.locator(".draft-notification").count() != 0:
            raise AssertionError("malformed_draft_should_not_surface_notification")
        malformed_remaining = await page.evaluate(f"() => window.localStorage.getItem('{DRAFT_KEY}')")
        if malformed_remaining is not None:
            raise AssertionError("malformed_draft_not_cleared")

        task1_btn = page.locator('.task-btn:has-text("Task 1")')
        await task1_btn.click()
        await page.fill("#custom-topic-text", TOPIC_TEXT)
        await page.fill(".essay-input", ESSAY_TEXT)
        await page.wait_for_timeout(50)
        await page.reload()
        await wait_for_compose(page)
        await page.wait_for_selector('.draft-notification:has-text("检测到未保存的草稿")', timeout=10000)

        stored_draft = await read_draft(page)
        if not stored_draft:
            raise AssertionError("draft_not_saved_during_beforeunload_flush")
        if stored_draft.get("task_type") != "task1":
            raise AssertionError(f"draft_task_type_mismatch:{stored_draft.get('task_type')}")
        if stored_draft.get("topic_mode") != "free":
            raise AssertionError(f"draft_topic_mode_mismatch:{stored_draft.get('topic_mode')}")
        if stored_draft.get("topic_text") != TOPIC_TEXT:
            raise AssertionError("draft_topic_text_mismatch")
        if stored_draft.get("content") != ESSAY_TEXT:
            raise AssertionError("draft_content_mismatch")
        await page.click('.draft-notification .btn.btn-primary:has-text("恢复草稿")')
        await page.wait_for_timeout(250)

        recovered_topic = await page.input_value("#custom-topic-text")
        recovered_content = await page.input_value(".essay-input")
        task1_active = await task1_btn.evaluate("(node) => node.classList.contains('active')")
        if recovered_topic != TOPIC_TEXT:
            raise AssertionError("recovered_topic_text_mismatch")
        if recovered_content != ESSAY_TEXT:
            raise AssertionError("recovered_content_mismatch")
        if not task1_active:
            raise AssertionError("recovered_task_type_not_active")

        submit_btn = page.locator('.submit-btn')
        disabled_before_submit = await submit_btn.is_disabled()
        if disabled_before_submit:
            raise AssertionError("submit_disabled_after_recovery")

        await set_start_mode(page, "fail")
        await submit_btn.click()
        await page.wait_for_timeout(250)
        if "#/evaluating/" in page.url:
            raise AssertionError("submit_failure_should_not_navigate")
        failed_calls = await page.evaluate("() => window.__writingStartCalls")
        if len(failed_calls) != 1:
            raise AssertionError(f"unexpected_failure_start_call_count:{len(failed_calls)}")
        error_text = await page.locator(".error-message").text_content()
        if not error_text or "网络连接失败" not in error_text:
            raise AssertionError(f"submit_failure_error_mismatch:{error_text}")
        failed_draft = await read_draft(page)
        if not failed_draft or failed_draft.get("content") != ESSAY_TEXT:
            raise AssertionError("draft_missing_after_submit_failure")

        await page.reload()
        await wait_for_compose(page)
        await page.wait_for_selector('.draft-notification:has-text("检测到未保存的草稿")', timeout=10000)
        await page.click('.draft-notification .btn.btn-primary:has-text("恢复草稿")')
        await page.wait_for_timeout(250)
        if await page.input_value(".essay-input") != ESSAY_TEXT:
            raise AssertionError("draft_not_recoverable_after_submit_failure")

        await set_start_mode(page, "success")
        await page.evaluate(
            """
            () => {
              const btn = document.querySelector('.submit-btn');
              if (!btn) throw new Error('missing_submit_btn');
              btn.click();
              btn.click();
            }
            """
        )
        await page.wait_for_url(f"**#/evaluating/{SESSION_ID}", timeout=10000)
        start_calls = await page.evaluate("() => window.__writingStartCalls")
        if len(start_calls) != 1:
            raise AssertionError(f"unexpected_start_call_count:{len(start_calls)}")
        payload = start_calls[0]
        if payload.get("task_type") != "task1":
            raise AssertionError("submit_task_type_mismatch")
        if payload.get("topic_id", "__missing__") is not None:
            raise AssertionError("submit_topic_id_should_be_null")
        if payload.get("topic_text") != TOPIC_TEXT:
            raise AssertionError("submit_topic_text_mismatch")
        if payload.get("content") != ESSAY_TEXT:
            raise AssertionError("submit_content_mismatch")
        if int(payload.get("word_count") or 0) <= 0:
            raise AssertionError("submit_word_count_invalid")

        await page.goto(entry_url)
        await wait_for_compose(page)
        if await read_draft(page) is not None:
            raise AssertionError("draft_not_cleared_after_success_submit")
        if await page.locator(".draft-notification").count() != 0:
            raise AssertionError("draft_notification_visible_after_success_submit")

        await page.evaluate(
            f"""() => localStorage.setItem('{DRAFT_KEY}', JSON.stringify({{
              task_type: 'task2',
              topic_mode: 'bank',
              topic_id: {BANK_TOPIC_ID},
              topic_text: '',
              category: '{BANK_TOPIC_CATEGORY}',
              content: {json.dumps(BANK_ESSAY_TEXT)},
              word_count: {len(BANK_ESSAY_TEXT.split())},
              last_saved: new Date().toISOString()
            }}))"""
        )
        await page.reload()
        await wait_for_compose(page)
        await page.wait_for_selector('.draft-notification:has-text("检测到未保存的草稿")', timeout=10000)
        await page.click('.draft-notification .btn.btn-primary:has-text("恢复草稿")')
        await page.wait_for_timeout(350)
        category_value = await page.input_value("#topic-category")
        topic_select_value = await page.input_value("#topic-select")
        recovered_bank_content = await page.input_value(".essay-input")
        bank_mode_active = await page.locator('.mode-btn.active:has-text("从题库选择")').count()
        if bank_mode_active == 0:
            raise AssertionError("bank_mode_not_active_after_restore")
        if category_value != BANK_TOPIC_CATEGORY:
            raise AssertionError(f"bank_category_mismatch:{category_value}")
        if topic_select_value != str(BANK_TOPIC_ID):
            raise AssertionError(f"bank_topic_id_mismatch:{topic_select_value}")
        if recovered_bank_content != BANK_ESSAY_TEXT:
            raise AssertionError("bank_content_not_restored")

        await page.click(".submit-btn")
        await page.wait_for_url(f"**#/evaluating/{SESSION_ID}", timeout=10000)
        start_calls = await page.evaluate("() => window.__writingStartCalls")
        if len(start_calls) != 1:
            raise AssertionError(f"unexpected_start_call_count_after_bank_submit:{len(start_calls)}")
        bank_payload = start_calls[0]
        if bank_payload.get("task_type") != "task2":
            raise AssertionError("bank_submit_task_type_mismatch")
        if bank_payload.get("topic_id") != BANK_TOPIC_ID:
            raise AssertionError("bank_submit_topic_id_mismatch")
        if bank_payload.get("topic_text", "__missing__") is not None:
            raise AssertionError("bank_submit_topic_text_should_be_null")
        if bank_payload.get("content") != BANK_ESSAY_TEXT:
            raise AssertionError("bank_submit_content_mismatch")
        if int(bank_payload.get("word_count") or 0) <= 0:
            raise AssertionError("bank_submit_word_count_invalid")

        await page.goto(entry_url)
        await wait_for_compose(page)
        if await read_draft(page) is not None:
            raise AssertionError("draft_not_cleared_after_bank_submit")

        await page.click('.mode-btn:has-text("从题库选择")')
        await page.wait_for_timeout(120)
        await page.evaluate(
            """
            () => {
              window.__topicListDelayConfig = { task1: 220, task2: 20 };
              window.__topicListRequests = [];
            }
            """
        )
        await page.click('.task-btn:has-text("Task 1")')
        await page.wait_for_timeout(50)
        await page.click('.task-btn:has-text("Task 2")')
        await page.wait_for_timeout(420)
        race_task2_option = await page.locator(f'#topic-select option[value="{BANK_TOPIC_ID}"]').count()
        race_task1_option = await page.locator('#topic-select option[value="3001"]').count()
        if race_task2_option != 1:
            raise AssertionError("topic_race_guard_failed_task2_option_missing")
        if race_task1_option != 0:
            raise AssertionError("topic_race_guard_failed_stale_task1_option_visible")

        await page.fill(".essay-input", BANK_ESSAY_TEXT)
        await page.evaluate(
            """
            () => {
              window.__topicListDelayConfig = {
                'task2:technology': 220,
                'task2:society': 20
              };
              window.__topicListRequests = [];
            }
            """
        )
        await page.select_option("#topic-category", BANK_TOPIC_CATEGORY)
        await page.select_option("#topic-category", BANK_SOCIETY_TOPIC_CATEGORY)
        await page.wait_for_timeout(360)

        category_race_option_texts = await page.locator("#topic-select option").all_text_contents()
        category_race_option_blob = " | ".join(text.strip() for text in category_race_option_texts if text.strip())
        if BANK_SOCIETY_TOPIC_LABEL_SNIPPET not in category_race_option_blob:
            raise AssertionError("topic_category_race_guard_failed_latest_option_missing")
        if "artificial intelligence will replace teachers" in category_race_option_blob.lower():
            raise AssertionError("topic_category_race_guard_failed_stale_option_visible")
        if await page.input_value("#topic-select") != "":
            raise AssertionError("topic_category_race_should_reset_selected_topic")
        if not await page.locator(".submit-btn").is_disabled():
            raise AssertionError("topic_category_race_should_keep_submit_disabled_without_valid_topic")

        await page.select_option("#topic-category", "")
        await page.click('.mode-btn:has-text("自由写作")')
        await page.fill(".essay-input", "")
        await page.fill("#custom-topic-text", "")
        await page.wait_for_timeout(700)

        await page.goto(entry_url)
        await wait_for_compose(page)
        await page.evaluate(
            f"""() => localStorage.setItem('{DRAFT_KEY}', JSON.stringify({{
              task_type: 'task2',
              topic_mode: 'bank',
              topic_id: {BANK_TOPIC_ID},
              topic_text: '',
              category: 'weird-category',
              content: {json.dumps(BANK_ESSAY_TEXT)},
              word_count: {len(BANK_ESSAY_TEXT.split())},
              last_saved: new Date().toISOString()
            }}))"""
        )
        await page.reload()
        await wait_for_compose(page)
        await page.wait_for_selector('.draft-notification:has-text("检测到未保存的草稿")', timeout=10000)
        await page.click('.draft-notification .btn.btn-primary:has-text("恢复草稿")')
        await page.wait_for_timeout(350)
        healed_bank_mode_active = await page.locator('.mode-btn.active:has-text("从题库选择")').count()
        healed_bank_category = await page.input_value("#topic-category")
        healed_bank_topic = await page.input_value("#topic-select")
        healed_bank_content = await page.input_value(".essay-input")
        if healed_bank_mode_active == 0:
            raise AssertionError("invalid_bank_category_should_keep_bank_mode_for_valid_topic")
        if healed_bank_category != "":
            raise AssertionError(f"invalid_bank_category_should_self_heal_to_all:{healed_bank_category}")
        if healed_bank_topic != str(BANK_TOPIC_ID):
            raise AssertionError(f"invalid_bank_category_should_preserve_topic_id:{healed_bank_topic}")
        if healed_bank_content != BANK_ESSAY_TEXT:
            raise AssertionError("invalid_bank_category_should_preserve_content")

        await page.goto(entry_url)
        await wait_for_compose(page)

        await page.evaluate(
            f"""() => localStorage.setItem('{DRAFT_KEY}', JSON.stringify({{
              task_type: 'task2',
              topic_mode: 'bank',
              topic_id: {BANK_MISSING_TOPIC_ID},
              topic_text: {json.dumps(BANK_MISSING_TOPIC_TEXT)},
              category: '{BANK_TOPIC_CATEGORY}',
              content: {json.dumps(BANK_ESSAY_TEXT)},
              word_count: {len(BANK_ESSAY_TEXT.split())},
              last_saved: new Date().toISOString()
            }}))"""
        )
        await page.reload()
        await wait_for_compose(page)
        await page.wait_for_selector('.draft-notification:has-text("检测到未保存的草稿")', timeout=10000)
        await page.click('.draft-notification .btn.btn-primary:has-text("恢复草稿")')
        await page.wait_for_timeout(500)
        fallback_mode_active = await page.locator('.mode-btn.active:has-text("自由写作")').count()
        fallback_topic = await page.input_value("#custom-topic-text")
        fallback_content = await page.input_value(".essay-input")
        fallback_notice = await page.locator(".restore-notice").text_content()
        if fallback_mode_active == 0:
            raise AssertionError("missing_bank_topic_should_fallback_to_free_mode")
        if fallback_topic != BANK_MISSING_TOPIC_TEXT:
            raise AssertionError("missing_bank_topic_text_not_restored")
        if fallback_content != BANK_ESSAY_TEXT:
            raise AssertionError("missing_bank_topic_content_not_restored")
        if not fallback_notice or "题库题目已失效" not in fallback_notice:
            raise AssertionError(f"missing_bank_topic_notice_mismatch:{fallback_notice}")

        await page.evaluate(
            """
            () => {
              window.__writingStartCalls = [];
              window.__writingStartMode = 'success';
            }
            """
        )
        await page.click(".submit-btn")
        await page.wait_for_url(f"**#/evaluating/{SESSION_ID}", timeout=10000)
        missing_topic_calls = await page.evaluate("() => window.__writingStartCalls")
        if len(missing_topic_calls) != 1:
            raise AssertionError(f"unexpected_missing_topic_start_call_count:{len(missing_topic_calls)}")
        missing_topic_payload = missing_topic_calls[0]
        if missing_topic_payload.get("topic_id", "__missing__") is not None:
            raise AssertionError("missing_bank_topic_submit_should_become_free_mode")
        if missing_topic_payload.get("topic_text") != BANK_MISSING_TOPIC_TEXT:
            raise AssertionError("missing_bank_topic_submit_text_mismatch")

        await page.goto(entry_url)
        await wait_for_compose(page)
        if await read_draft(page) is not None:
            raise AssertionError("draft_not_cleared_after_missing_bank_topic_submit")

        await page.evaluate(
            f"""() => localStorage.setItem('{DRAFT_KEY}', JSON.stringify({{
              task_type: 'task3',
              topic_mode: 'weird',
              topic_id: null,
              topic_text: 'self-heal probe topic',
              category: '',
              content: 'self-heal probe content',
              word_count: 6,
              last_saved: new Date().toISOString()
            }}))"""
        )
        await page.reload()
        await wait_for_compose(page)
        await page.wait_for_selector('.draft-notification:has-text("检测到未保存的草稿")', timeout=10000)
        await page.click('.draft-notification .btn.btn-primary:has-text("恢复草稿")')
        await page.wait_for_selector('.mode-btn.active:has-text("自由写作")', timeout=10000)
        task2_active = await page.locator('.task-btn:has-text("Task 2")').evaluate("(node) => node.classList.contains('active')")
        if not task2_active:
            raise AssertionError("invalid_task_type_not_self_healed_to_task2")
        healed_topic = await page.input_value("#custom-topic-text")
        healed_content = await page.input_value(".essay-input")
        if healed_topic != "self-heal probe topic":
            raise AssertionError("self_healed_topic_text_mismatch")
        if healed_content != "self-heal probe content":
            raise AssertionError("self_healed_content_mismatch")

        await page.goto(entry_url)
        await wait_for_compose(page)
        await page.evaluate(
            f"""() => localStorage.setItem('{DRAFT_KEY}', JSON.stringify({{
              task_type: 'task2',
              topic_mode: 'free',
              topic_id: null,
              topic_text: 'discard probe topic',
              category: '',
              content: 'discard probe content',
              word_count: 3,
              last_saved: new Date().toISOString()
            }}))"""
        )
        await page.reload()
        await wait_for_compose(page)
        await page.wait_for_selector('.draft-notification:has-text("检测到未保存的草稿")', timeout=10000)
        await page.click('.draft-notification .btn.btn-secondary:has-text("放弃")')
        await page.wait_for_timeout(250)

        remaining_draft = await read_draft(page)
        if remaining_draft is not None:
            raise AssertionError("draft_not_cleared_after_discard")
        if await page.locator(".draft-notification").count() != 0:
            raise AssertionError("draft_notification_still_visible_after_discard")

        await browser.close()

    return {
        "status": "pass",
        "detail": "自由写作与题库模式草稿在 file:// 下通过坏草稿自愈、恢复、重复提交单发、题库竞态防陈旧覆盖、失效题目回退、失败保稿、成功清稿与放弃回归",
        "evidence": {
            "draftKey": DRAFT_KEY,
            "entry": str(DIST_ENTRY),
            "sessionId": SESSION_ID,
            "wordCount": len(ESSAY_TEXT.split()),
            "bankWordCount": len(BANK_ESSAY_TEXT.split()),
            "bankTopicId": BANK_TOPIC_ID,
            "bankSocietyTopicId": BANK_SOCIETY_TOPIC_ID,
            "missingBankTopicId": BANK_MISSING_TOPIC_ID,
            "startCallCount": 1,
        },
    }


def main() -> None:
    try:
        result = asyncio.run(run_regression())
    except AssertionError as exc:
        print(json.dumps({"status": "fail", "detail": str(exc)}, ensure_ascii=False))
        raise SystemExit(1)
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"status": "fail", "detail": f"unexpected_error:{exc}"}, ensure_ascii=False))
        raise SystemExit(1)

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
