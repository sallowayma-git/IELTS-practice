"""Real shipping-payload regressions for unified reading and shared drag behavior."""
import json
import os
from contextlib import contextmanager
from pathlib import Path

from playwright.sync_api import expect, sync_playwright
from exam_freeze_visual_check import serve

ROOT = Path(__file__).resolve().parents[3]
PACK = ROOT / 'assets/resource-pack/reading/payloads'
IDS = ('p1-high-01', 'p1-medium-57', 'p1-low-11', 'p1-low-61', 'p2-medium-217',
       'p2-high-134', 'p2-high-201', 'p3-high-156', 'p3-low-175', 'p3-low-54', 'p3-low-219')
PAYLOADS = {asset_id: json.loads((PACK / f'{asset_id}.json').read_bytes()) for asset_id in IDS}

MOCK = r"""
(() => {
  const {payloads, initialDraft} = __FIXTURE__;
  const read = (key, fallback) => JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  if (initialDraft && !read('fixture-seeded', false)) {
    write('drafts', {[initialDraft.assetId]: {attempt: initialDraft, timer: initialDraft.timer || null}});
    write('annotations', initialDraft.annotations || []);
    write('fixture-seeded', true);
  }
  window.__reviewCalls = [];
  const asset = id => ({id, title: payloads[id].meta.title, category: payloads[id].meta.category,
    activity: 'reading', schemaVersion: 1, pdfOnly: false, payloadRef: `payloads/${id}.json`});
  const invoke = async (command, args = {}) => {
    window.__reviewCalls.push({command, args: JSON.parse(JSON.stringify(args))});
    let data = null;
    const cmd = args.cmd || {};
    if (command === 'reading_list_assets') data = Object.keys(payloads).map(asset);
    if (command === 'reading_get_asset_payload') data = {asset: asset(args.assetId), payload: payloads[args.assetId]};
    if (command === 'reading_get_open_draft') data = read('drafts', {})[args.assetId] || null;
    if (command === 'reading_save_draft') {
      data = {id: cmd.attemptId, assetId: cmd.assetId, status: 'draft',
        answers: Object.entries(cmd.answers).map(([questionId, answer]) => ({questionId, answer}))};
      write('drafts', {...read('drafts', {}), [cmd.assetId]: {attempt: data, timer: cmd.timerSnapshot}});
    }
    if (command === 'reading_submit_attempt') {
      const payload = payloads[cmd.assetId];
      data = {attempt: {id: cmd.attemptId, assetId: cmd.assetId, status: 'completed', durationMs: cmd.durationMs},
        score: {correct: 0, total: payload.questionOrder.length, percentage: 0, accuracy: 0},
        comparisons: payload.questionOrder.map(questionId => ({questionId, userAnswer: cmd.answers[questionId] || '',
          correctAnswer: payload.answerKey[questionId], isCorrect: false, weight: 1, matchMode: 'single'}))};
      const drafts = read('drafts', {}); delete drafts[cmd.assetId]; write('drafts', drafts);
    }
    if (command === 'annotation_list') data = read('annotations', []).filter(item =>
      item.assetId === args.assetId && item.attemptId === args.attemptId);
    if (command === 'annotation_upsert') {
      data = {...cmd, id: cmd.id || `note-${Date.now()}`};
      write('annotations', [...read('annotations', []).filter(item => item.id !== data.id), data]);
    }
    if (command === 'annotation_delete') {
      write('annotations', read('annotations', []).filter(item => item.id !== args.id)); data = true;
    }
    if (command === 'timer_elapsed_seconds') {
      const t = args.timer;
      data = Math.max(0, Math.floor(((t.running ? args.nowMs : t.pausedAtMs) - t.anchorMs - t.pausedOffsetMs) / 1000));
    }
    if (command === 'timer_should_auto_submit') data = false;
    if (command === 'list_history') data = {items: [], total: 0};
    return {ok: true, data};
  };
  window.__TAURI_INTERNALS__ = {invoke};
  window.__TAURI__ = {core: {invoke}};
})();
"""


def selected(page, name):
    return page.locator(f'input[name="{name}"]:checked').evaluate_all('(nodes) => nodes.map(node => node.value)')


def calls(page, command):
    return page.evaluate('(command) => window.__reviewCalls.filter(call => call.command === command).map(call => call.args)', command)


def wait_save(page, expression):
    page.wait_for_function(f"() => window.__reviewCalls.some(call => call.command === 'reading_save_draft' && ({expression}))")


@contextmanager
def practice(browser, base, asset_id, draft=None, route='reading-unified', payloads=None):
    context = browser.new_context(viewport={'width': 1440, 'height': 960})
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    fixture = {'payloads': payloads or PAYLOADS, 'initialDraft': draft}
    page.add_init_script(MOCK.replace('__FIXTURE__', json.dumps(fixture, ensure_ascii=False)))
    page.goto(f'{base}/#/{route}/{asset_id}')
    page.wait_for_selector('#question-groups .unified-group')
    page.wait_for_timeout(100)
    try:
        yield page
        assert not errors, errors
    except Exception:
        print(json.dumps({'pageErrors': errors, 'calls': page.evaluate('window.__reviewCalls.slice(-15)'),
                          'checked': page.locator('input:checked').evaluate_all('(nodes) => nodes.map(n => [n.name,n.value])')}, ensure_ascii=False))
        raise
    finally:
        context.close()


def run(browser, base):
    with practice(browser, base, 'p3-low-219') as page:
        page.locator('.header #timer').click()
        expect(page.locator('.header #timer')).to_have_class('paused')
        for value in ('A', 'D', 'E'):
            page.locator(f'input[name="q12_40"][value="{value}"]').check()
        assert selected(page, 'q12_40') == ['A', 'D', 'E']
        wait_save(page, "JSON.stringify(call.args.cmd.answers.q12) === '[\"A\",\"D\",\"E\"]'")
        saved = calls(page, 'reading_save_draft')[-1]['cmd']['answers']
        assert set(saved) == set(PAYLOADS['p3-low-219']['questionOrder'])
        page.reload()
        expect(page.locator('input[name="q12_40"]:checked')).to_have_count(3)
        assert selected(page, 'q12_40') == ['A', 'D', 'E']
        page.wait_for_timeout(900)
        assert calls(page, 'reading_save_draft') == [], 'hydration must not write a draft'
        page.locator('#submit-btn').click()
        expect(page.locator('#results')).to_be_visible()
        submitted = calls(page, 'reading_submit_attempt')[-1]['cmd']['answers']
        assert submitted['q12'] == ['A', 'D', 'E']
        assert set(submitted) == set(PAYLOADS['p3-low-219']['questionOrder'])
        expect(page.locator('input[name="q12_40"]:checked')).to_have_count(3)
        for value in ('A', 'D', 'E'):
            expect(page.locator(f'label.option-correct input[name="q12_40"][value="{value}"]')).to_be_checked()
        page.locator('#reset-btn').click()
        expect(page.locator('input[name="q12_40"]:checked')).to_have_count(0)
        page.reload()
        expect(page.locator('#question-groups .unified-group')).to_have_count(3)
        expect(page.locator('input[name="q12_40"]:checked')).to_have_count(0)
    print('PASS: mixed checkbox name preserves its logical answer across save, reload, submit and reset')

    with practice(browser, base, 'p1-medium-57') as page:
        for value in ('C', 'E', 'G'):
            page.locator(f'input[name="q11"][value="{value}"]').check()
        wait_save(page, "JSON.stringify(call.args.cmd.answers.q11) === '[\"C\",\"E\",\"G\"]'")
        page.reload()
        expect(page.locator('input[name="q11"]:checked')).to_have_count(3)
        assert selected(page, 'q11') == ['C', 'E', 'G']
        page.locator('#submit-btn').click()
        expect(page.locator('#results')).to_be_visible()
        assert calls(page, 'reading_submit_attempt')[-1]['cmd']['answers']['q11'] == ['C', 'E', 'G']
        page.locator('#reset-btn').click()
        expect(page.locator('input[type="checkbox"]:checked')).to_have_count(0)
    print('PASS: array checkbox draft, reload, submission and reset')

    draft = {'id': 'checkbox-draft', 'assetId': 'p1-medium-57',
             'answers': [{'questionId': 'q9', 'answer': 'A'}, {'questionId': 'q10', 'answer': 'C'}]}
    with practice(browser, base, 'p1-medium-57', draft) as page:
        expect(page.locator('input[name="q9_10"]:checked')).to_have_count(2)
        assert selected(page, 'q9_10') == ['A', 'C']
        page.wait_for_timeout(900)
        assert calls(page, 'reading_save_draft') == [], 'hydration must not write a draft'
        page.locator('#submit-btn').click()
        expect(page.locator('#results')).to_be_visible()
        answers = calls(page, 'reading_submit_attempt')[-1]['cmd']['answers']
        assert (answers['q9'], answers['q10']) == ('A', 'C')
        page.locator('#reset-btn').click()
        expect(page.locator('input[type="checkbox"]:checked')).to_have_count(0)
    # Exercise the other compound spelling using the same real checkbox markup.
    compound = json.loads(json.dumps(PAYLOADS))
    p = compound['p1-medium-57']
    for group in p['questionGroups']:
        if 'name="q11"' in group['bodyHtml']:
            group['bodyHtml'] = group['bodyHtml'].replace('name="q11"', 'name="q11-12-13"')
            group['questionIds'] += ['q12', 'q13']
    p['questionOrder'] += ['q12', 'q13']
    p['answerKey'].update(q11='C', q12='E', q13='G')
    draft['answers'] = [{'questionId': q, 'answer': a} for q, a in zip(('q11', 'q12', 'q13'), ('C', 'E', 'G'))]
    with practice(browser, base, 'p1-medium-57', draft, payloads=compound) as page:
        expect(page.locator('input[name="q11-12-13"]:checked')).to_have_count(3)
        page.locator('#submit-btn').click()
        page.locator('#reset-btn').click()
        expect(page.locator('input[type="checkbox"]:checked')).to_have_count(0)
    print('PASS: compound checkbox hydration and clearing, with no hydration writes')

    with practice(browser, base, 'p1-low-11') as page:
        source = page.locator('#subfam-B')
        source.click()
        page.locator('[data-question="q5"]').click()
        assert 'option-consumed' not in (source.get_attribute('class') or '')
        source.click()
        page.locator('[data-question="q8"]').click()
        wait_save(page, "call.args.cmd.answers.q5 === 'B' && call.args.cmd.answers.q8 === 'B'")
        page.locator('[data-question="q5"] [data-dropzone-clear]').click()
        wait_save(page, "call.args.cmd.answers.q5 === '' && call.args.cmd.answers.q8 === 'B'")
        page.reload()
        expect(page.locator('[data-question="q8"]')).to_contain_text('B Bovinae')
        expect(page.locator('[data-question="q5"] [data-dropzone-clear]')).to_have_count(0)
    print('PASS: reusable drag answers and removal autosave survive reload')

    # R12: native reuse expressed only via data-clone="true" pool cards (no
    # allowOptionReuse metadata) — p2-high-201 group 2, q7 and q8 both need C.
    with practice(browser, base, 'p2-high-201') as page:
        source = page.locator('#card-C')
        source.click()
        page.locator('[data-question="q7"]').click()
        assert 'option-consumed' not in (source.get_attribute('class') or '')
        source.click()
        page.locator('[data-question="q8"]').click()
        wait_save(page, "String(call.args.cmd.answers.q7).toUpperCase() === 'C' && String(call.args.cmd.answers.q8).toUpperCase() === 'C'")
        expect(page.locator('[data-question="q8"]')).to_contain_text('C')
    print('PASS: data-clone native reuse keeps clone cards interactive for both questions')

    for route in ('reading-unified', 'reading'):
        with practice(browser, base, 'p2-medium-217', route=route) as page:
            page.locator('#pool-people [data-value="A"]').click()
            page.locator('[data-question="q8"]').click()
            expect(page.locator('[data-question="q8"]')).to_contain_text('Fumihide Tanaka')
            assert 'option-consumed' not in page.locator('#pool-paragraphs [data-value="A"]').get_attribute('class')
            page.locator('#pool-paragraphs [data-value="A"]').click()
            page.locator('[data-question="q1"]').click()
            expect(page.locator('[data-question="q1"] [data-dropzone-clear]')).to_have_text('A')
    non_reusable = json.loads(json.dumps(PAYLOADS))
    non_reusable['p2-medium-217']['questionGroups'][1]['allowOptionReuse'] = False
    with practice(browser, base, 'p2-medium-217', payloads=non_reusable) as page:
        page.locator('#pool-people [data-value="A"]').drag_to(page.locator('[data-question="q8"]'))
        expect(page.locator('[data-question="q8"]')).to_contain_text('Fumihide Tanaka')
        assert 'option-consumed' in page.locator('#pool-people [data-value="A"]').get_attribute('class')
        assert 'option-consumed' not in page.locator('#pool-paragraphs [data-value="A"]').get_attribute('class')
        wait_save(page, "call.args.cmd.answers.q8 === 'A'")
        page.locator('[data-question="q8"] [data-dropzone-clear]').click()
        expect(page.locator('#pool-people [data-value="A"]')).not_to_have_class('option-consumed')
        assert 'option-consumed' not in page.locator('#pool-people [data-value="A"]').get_attribute('class')
    print('PASS: labels and consumed state respect group ownership on both reading pages')

    note = {'id': 'saved-note', 'assetId': 'p1-high-01', 'attemptId': 'note-draft', 'scope': 'passage',
            'kind': 'note', 'anchor': {'text': 'Tea', 'occurrence': 0}, 'createdAt': '2026-01-01T00:00:00Z'}
    draft = {'id': 'note-draft', 'assetId': 'p1-high-01', 'answers': [],
             'annotations': [note, {**note, 'id': 'other-note', 'attemptId': 'other-attempt'}]}
    with practice(browser, base, 'p1-high-01', draft) as page:
        page.locator('#notes-drawer-btn').click()
        expect(page.locator('.reading-note-row')).to_have_count(1)
        expect(page.locator('#left [data-annotation-id="saved-note"]')).to_have_count(1)
        page.reload()
        page.locator('#notes-drawer-btn').click()
        expect(page.locator('.reading-note-row')).to_have_count(1)
        assert all(call['attemptId'] == 'note-draft' for call in calls(page, 'annotation_list'))
        page.evaluate("location.hash = '#/reading-unified/p1-low-11'")
        expect(page.locator('#subfam-B')).to_be_visible()
        expect(page.locator('.reading-note-row')).to_have_count(0)
        page.locator('#subfam-B').click()
        page.locator('[data-question="q5"]').click()
        wait_save(page, "call.args.cmd.assetId === 'p1-low-11' && call.args.cmd.attemptId !== 'note-draft'")
    print('PASS: note hydration stays scoped to the attempt and clears on asset change')

    with practice(browser, base, 'p1-low-61') as page:
        page.locator('#timer').click()
        expect(page.locator('#timer')).to_have_class('paused')
        wait_save(page, 'call.args.cmd.timerSnapshot.running === false')
        page.reload()
        expect(page.locator('#timer')).to_have_class('paused')
        page.locator('#timer').click()
        expect(page.locator('#timer')).not_to_have_class('paused')
        wait_save(page, 'call.args.cmd.timerSnapshot.running === true')
        page.locator('#submit-btn').click()
        expect(page.locator('.reading-passage-explanation')).to_have_count(9)
        assert page.locator('.reading-passage-explanation .reading-explanation-card__label').all_text_contents() == [
            f'Paragraph {letter}' for letter in 'ABCDEFGHI']
        page.locator('#exit-btn').click()
        page.wait_for_url(f'{base}/#/')
    print('PASS: timer pause/resume persistence, all paragraph explanations, and Exit navigation')

    for route in ('reading-unified', 'reading'):
        for asset_id in ('p2-high-134', 'p3-high-156', 'p3-low-175', 'p3-low-54'):
            with practice(browser, base, asset_id, route=route) as page:
                page.wait_for_function("() => [...document.querySelectorAll('#question-groups img')].length > 0 && "
                                       "[...document.querySelectorAll('#question-groups img')].every(img => img.complete && img.naturalWidth > 0)")
                assert page.locator('#question-groups img').evaluate_all("nodes => nodes.every(img => img.src.startsWith('data:image/'))")
    print('PASS: all four local diagram assets decode offline in both reading pages')


def main():
    base = os.environ.get('READING_UNIFIED_VISUAL_BASE_URL')
    server = None
    if not base:
        server, base = serve()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            try:
                run(browser, base.rstrip('/'))
            finally:
                browser.close()
    finally:
        if server:
            server.terminate()
            server.wait(timeout=5)


if __name__ == '__main__':
    main()
