"""Regression for legacy Browse projection, termite questions and suite clearance."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]
REPORTS = ROOT / 'developer/tests/e2e/reports'


def main():
    REPORTS.mkdir(exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--allow-file-access-from-files'])
        context = browser.new_context()
        page = context.new_page()
        page.goto((ROOT / 'index.html').as_uri() + '?test_env=1')
        page.wait_for_function('window.app && window.app.isInitialized')
        page.evaluate('async () => { await AppData.ready; await LicenseModal.accept(); await ensureBrowseGroup(); }')
        result = page.evaluate('''async () => {
            const exams = await resolveActiveExamIndex();
            const exam = exams.find(item => item.id === 'p3-low-175');
            const original = listCanonicalPracticeRecordSummaries;
            listCanonicalPracticeRecordSummaries = async () => [{ id: 'legacy-attempt',
                examId: exam.id, title: 'Old title', type: 'reading', metadata: {},
                correctAnswers: 5, totalQuestions: 14, completedAt: '2026-08-01' }];
            try {
                await syncPracticeRecords({ forceRender: true });
                const status = getBrowseLearningStatus(exam);
                if (!status || !status.wrong) throw new Error('Legacy attempt missing from Browse');
                await AppData.library.updateConfiguration({ id: 'custom', name: 'Isolated test library' });
                await syncPracticeRecords({ forceRender: true });
                if (!getBrowseLearningStatus(exam)?.wrong) throw new Error('Library source hid the legacy attempt');
                return { legacyPercentage: status.percentage };
            } finally {
                listCanonicalPracticeRecordSummaries = original;
                await AppData.library.remove('custom');
            }
        }''')
        reading = (ROOT / 'assets/generated/reading-exams/reading-practice-unified.html').as_uri()
        for width, height in [(1440, 900), (390, 844)]:
            page = browser.new_page(viewport={'width': width, 'height': height})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(reading + '?examId=p3-low-175&suiteSessionId=clearance-test&test_env=1')
            page.wait_for_selector('#q37_input')
            page.wait_for_function('''() => {
                const image = document.querySelector('.diagram-container img');
                return image && image.complete && image.naturalWidth > 0;
            }''')
            assert page.locator('#question-groups .group').count() == 3
            assert page.locator('.paragraph-dropzone').count() == 7
            assert page.locator('#question-groups input').count() == 13
            assert page.locator('.diagram-container img').get_attribute('src').endswith('.png')
            assert 'constant 35' in page.locator('.diagram-container img').get_attribute('alt')
            page.evaluate('''() => {
                document.getElementById('right').scrollTop = 100000;
                window.scrollTo(0, document.documentElement.scrollHeight);
            }''')
            page.wait_for_timeout(150)
            geometry = page.evaluate('''() => {
                const option = document.querySelector('input[name="q14"][value="NOT GIVEN"]');
                const a = option.closest('label').getBoundingClientRect();
                const b = document.getElementById('floating-passage-nav').getBoundingClientRect();
                return { optionBottom: a.bottom, navTop: b.top,
                    clear: a.bottom <= b.top || a.top >= b.bottom || a.right <= b.left || a.left >= b.right,
                    visible: a.top >= 0 && a.bottom <= innerHeight };
            }''')
            assert geometry['clear'] and geometry['visible'], geometry
            page.locator('input[name="q14"][value="NOT GIVEN"]').check()
            assert page.locator('input[name="q14"][value="NOT GIVEN"]').is_checked()
            assert not errors, errors
            page.screenshot(path=str(REPORTS / f'atlas-clearance-{width}.png'))
            result[str(width)] = geometry
            page.close()
        browser.close()
    print(json.dumps({'status': 'pass', **result}))


if __name__ == '__main__':
    main()

