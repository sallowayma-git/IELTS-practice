#!/usr/bin/env node
/**
 * Node fallback runner for suite_practice_flow.py when Python Playwright is unavailable.
 *
 * Keeps output artifacts identical:
 * - developer/tests/e2e/reports/suite-practice-record-list.png
 * - developer/tests/e2e/reports/suite-practice-record-detail.png
 * - developer/tests/e2e/reports/suite-practice-flow-report.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../../..');
const INDEX_PATH = path.join(REPO_ROOT, 'index.html');
const INDEX_URL = `${pathToFileURL(INDEX_PATH).href}?test_env=1`;
const REPORT_DIR = path.join(REPO_ROOT, 'developer', 'tests', 'e2e', 'reports');
const TMP_DIR = '/tmp/ielts-playwright-tmp';
const BROWSERS_DIR = path.join(REPO_ROOT, 'developer', 'tests', 'e2e', '.pw-browsers');

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

async function ensureAppReady(page) {
  await page.waitForLoadState('load');
  await page.waitForFunction(
    () => window.app && window.app.isInitialized && window.storage && typeof window.storage.get === 'function',
    { timeout: 60_000 }
  );
}

async function clickNav(page, view) {
  await page.locator(`nav button[data-view='${view}']`).click();
  await page.waitForSelector(`#${view}-view.active`, { timeout: 15_000 });
}

async function dismissOverlays(page) {
  const overlay = page.locator('#library-loader-overlay');
  if (await overlay.count()) {
    try {
      await overlay.waitFor({ state: 'visible', timeout: 2_000 });
      const closeBtn = overlay.locator("[data-library-action='close']");
      if (await closeBtn.count()) {
        await closeBtn.first().click();
        await overlay.waitFor({ state: 'detached', timeout: 5_000 });
      }
    } catch (_) {}
  }

  const backupModal = page.locator('.backup-modal-close');
  if (await backupModal.count()) {
    try {
      await backupModal.first().click();
    } catch (_) {}
  }
}

async function completePassage(suitePage, totalCount, index) {
  if (suitePage.isClosed()) return false;

  await suitePage.waitForLoadState('load');
  await suitePage.waitForSelector('#complete-exam-btn', { timeout: 20_000 });
  await suitePage.waitForFunction(() => {
    const btn = document.getElementById('complete-exam-btn');
    return btn && !btn.disabled;
  }, { timeout: 20_000 });

  const currentExamId = await suitePage.evaluate(() => document.body.dataset.examId || '');
  await suitePage.click('#complete-exam-btn');

  await suitePage.waitForFunction(() => {
    const btn = document.getElementById('complete-exam-btn');
    return btn && btn.disabled;
  }, { timeout: 20_000 });

  if (index + 1 >= totalCount) return true;

  await suitePage.waitForFunction(
    (initialId) => (document.body.dataset.examId || '') !== initialId,
    currentExamId,
    { timeout: 30_000 }
  );

  await suitePage.waitForFunction(() => {
    const btn = document.getElementById('complete-exam-btn');
    return btn && !btn.disabled;
  }, { timeout: 20_000 });

  return true;
}

async function run() {
  ensureDir(REPORT_DIR);
  ensureDir(TMP_DIR);
  ensureDir(BROWSERS_DIR);

  process.env.TMPDIR = TMP_DIR;
  process.env.TMP = TMP_DIR;
  process.env.TEMP = TMP_DIR;
  process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS_DIR;

  const consoleLogs = [];
  const startTime = Date.now();
  let passed = false;

  const { firefox } = await import('playwright');
  const browser = await firefox.launch({
    headless: true,
  });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    const attachConsole = (pg) => {
      pg.on('console', (msg) => {
        consoleLogs.push({
          type: msg.type(),
          text: msg.text(),
          timestamp: nowIso(),
          page: pg.url(),
        });
      });
    };
    attachConsole(page);
    context.on('page', attachConsole);

    await page.goto(INDEX_URL);
    await ensureAppReady(page);
    await dismissOverlays(page);

    await clickNav(page, 'overview');

    const startButton = page.locator("button[data-action='start-suite-mode']");
    await startButton.scrollIntoViewIfNeeded();

    const [suitePage] = await Promise.all([
      page.waitForEvent('popup'),
      startButton.click(),
    ]);

    attachConsole(suitePage);

    for (let i = 0; i < 3; i += 1) {
      const ok = await completePassage(suitePage, 3, i);
      if (!ok) break;
    }

    if (!suitePage.isClosed()) {
      try {
        await suitePage.waitForTimeout(1000);
        await suitePage.close();
      } catch (_) {}
    }

    await clickNav(page, 'practice');
    await page.waitForTimeout(2000);

    await page.waitForFunction(() => {
      return window.app && window.app.state && window.app.state.practice &&
        Array.isArray(window.app.state.practice.records) &&
        window.app.state.practice.records.length > 0;
    }, { timeout: 30_000 });

    await page.evaluate(() => {
      if (typeof window.updatePracticeView === 'function') window.updatePracticeView();
    });
    await page.waitForTimeout(500);

    await page.waitForSelector('#history-list .history-record-item', { timeout: 20_000 });
    const suiteRecord = page.locator("#history-list .history-record-item[data-record-id^='suite_']").first();
    await suiteRecord.waitFor({ state: 'visible', timeout: 5_000 });

    const recordId = await suiteRecord.getAttribute('data-record-id');
    if (!recordId) throw new Error('Suite practice record not found in history list');

    const titleText = await page.evaluate((id) => {
      const base = `#history-list .history-record-item[data-record-id='${id}']`;
      const titleEl = document.querySelector(`${base} .record-title`) ||
        document.querySelector(`${base} .practice-record-title`);
      return titleEl ? titleEl.textContent.trim() : null;
    }, recordId);

    if (!titleText) throw new Error('Suite practice record title element missing');
    if (!/^\d{2}月\d{2}日套题练习\d+$/.test(titleText)) {
      throw new Error(`Unexpected suite record title: ${titleText}`);
    }

    await page.locator('#practice-view').screenshot({
      path: path.join(REPORT_DIR, 'suite-practice-record-list.png'),
    });

    await page.evaluate((id) => {
      if (window.app?.components?.practiceHistory?.showRecordDetails) {
        window.app.components.practiceHistory.showRecordDetails(id);
        return;
      }
      if (window.practiceHistoryEnhancer?.showRecordDetails) {
        window.practiceHistoryEnhancer.showRecordDetails(id);
        return;
      }
      const selector = `#history-list .history-record-item[data-record-id="${id}"] button[data-history-action="details"]`;
      const button = document.querySelector(selector);
      if (button) button.click();
    }, recordId);

    await page.waitForSelector('#practice-record-modal.modal-overlay.show', { timeout: 15_000 });
    await page.locator('#practice-record-modal .modal-container').screenshot({
      path: path.join(REPORT_DIR, 'suite-practice-record-detail.png'),
    });

    passed = true;
  } finally {
    await browser.close().catch(() => {});

    const report = {
      generatedAt: nowIso(),
      duration: (Date.now() - startTime) / 1000,
      status: passed ? 'pass' : 'fail',
      consoleLogs,
    };
    fs.writeFileSync(
      path.join(REPORT_DIR, 'suite-practice-flow-report.json'),
      JSON.stringify(report, null, 2) + '\n',
      'utf8'
    );
  }

  process.exit(passed ? 0 : 1);
}

run().catch((error) => {
  try {
    ensureDir(REPORT_DIR);
    fs.writeFileSync(
      path.join(REPORT_DIR, 'suite-practice-flow-report.json'),
      JSON.stringify({ generatedAt: nowIso(), status: 'fail', error: String(error && (error.stack || error.message || error)) }, null, 2) + '\n',
      'utf8'
    );
  } catch (_) {}
  process.stderr.write(String(error && (error.stack || error.message || error)) + '\n');
  process.exit(1);
});
