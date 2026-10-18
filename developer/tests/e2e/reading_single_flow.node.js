#!/usr/bin/env node
/**
 * Node fallback runner for reading_single_flow.py when Python Playwright is unavailable.
 *
 * Report artifact:
 * - developer/tests/e2e/reports/reading-single-flow-report.json
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../../..');
const INDEX_PATH = path.join(REPO_ROOT, 'index.html');
const INDEX_URL = `${pathToFileURL(INDEX_PATH).href}?test_env=1`;
const REPORT_DIR = path.join(REPO_ROOT, 'developer', 'tests', 'e2e', 'reports');
const REPORT_FILE = path.join(REPORT_DIR, 'reading-single-flow-report.json');
const TMP_DIR = path.join(os.tmpdir(), 'ielts-playwright-tmp');
const BROWSERS_DIR = path.join(REPO_ROOT, 'developer', 'tests', 'e2e', '.pw-browsers');
const TARGET_UNIFIED_EXAM_ID = 'p2-medium-243';
const TARGET_MANUAL_PDF_EXAM_ID = 'p2-high-26';

function nowIso() {
  return new Date().toISOString();
}

function logStep(message, level = 'INFO') {
  const timestamp = new Date().toISOString().slice(11, 23);
  const prefix = {
    INFO: '[INFO]',
    SUCCESS: '[PASS]',
    WARNING: '[WARN]',
    ERROR: '[FAIL]',
    DEBUG: '[DEBUG]',
  }[level] || '[INFO]';
  process.stdout.write(`[${timestamp}] ${prefix} ${message}\n`);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function collectConsole(page, store) {
  page.on('console', (msg) => {
    store.push({
      page: page.url(),
      type: msg.type(),
      text: msg.text(),
      timestamp: nowIso(),
    });
  });
}

async function ensureAppReady(page) {
  await page.waitForLoadState('load');
  await page.waitForFunction(() => !!window.AppData, null, { timeout: 60_000 });
  await page.evaluate(async () => { await window.AppData.ready; });
  await page.waitForFunction(() => window.app?.isInitialized === true, null, { timeout: 60_000 });
}

async function dismissOverlays(page) {
  const accepted = await page.evaluate(async () => {
    if (!window.LicenseModal || typeof window.LicenseModal.accept !== 'function') {
      throw new Error('LicenseModal.accept is unavailable');
    }
    return window.LicenseModal.accept();
  });
  if (!accepted) throw new Error('GPL license consent was not committed');
  await page.waitForFunction(
    () => !document.getElementById('license-modal')?.classList.contains('show'),
    null,
    { timeout: 5_000 }
  );

  const overlay = page.locator('#library-loader-overlay');
  if (await overlay.count()) {
    try {
      await overlay.waitFor({ state: 'visible', timeout: 2_000 });
      const closeBtn = overlay.locator("[data-library-action='close']");
      if (await closeBtn.count()) {
        await closeBtn.first().click();
        await overlay.waitFor({ state: 'detached', timeout: 5_000 });
      }
    } catch (_) { }
  }
}

async function clickNav(page, view) {
  await page.locator(`nav button[data-view='${view}']`).click();
  await page.waitForSelector(`#${view}-view.active`, { timeout: 15_000 });
}

async function waitExamIndexReady(page) {
  await page.waitForFunction(
    async () => {
      try {
        const index = await window.resolveActiveLibraryIndex();
        return Array.isArray(index) && index.length > 0;
      } catch (_) {
        return false;
      }
    },
    { timeout: 60_000 }
  );
}

async function ensureReadingListReady(page) {
  await waitExamIndexReady(page);
  await page.evaluate(() => {
    if (window.app && typeof window.app.browseCategory === 'function') {
      window.app.browseCategory('all', 'reading');
    } else if (typeof window.browseCategory === 'function') {
      window.browseCategory('all', 'reading');
    }

    if (typeof window.loadExamList === 'function') {
      try { window.loadExamList(); } catch (_) { }
    }
  });

  await page.waitForFunction(
    () => document.querySelectorAll('#exam-list-container .exam-item[data-exam-id]').length > 0,
    { timeout: 30_000 }
  );

  return await page.evaluate(
    () => document.querySelectorAll('#exam-list-container .exam-item[data-exam-id]').length
  );
}

async function assertUnavailablePdfCardState(page, examId) {
  await page.waitForSelector(
    `#exam-list-container .exam-item[data-exam-id='${examId}']`,
    { timeout: 30_000 }
  );
  const state = await page.evaluate((targetExamId) => {
    const card = document.querySelector(
      `#exam-list-container .exam-item[data-exam-id='${targetExamId}']`
    );
    if (!card) return null;
    const unavailable = Array.from(card.querySelectorAll('*')).find(
      (node) => node.textContent?.trim() === '此PDF不存在'
    );
    return {
      text: unavailable?.textContent?.trim() || '',
      tagName: unavailable?.tagName || '',
      role: unavailable?.getAttribute('role') || '',
      tabIndex: unavailable?.getAttribute('tabindex') || '',
      visible: unavailable
        ? Boolean(unavailable.offsetWidth || unavailable.offsetHeight || unavailable.getClientRects().length)
        : false,
      pdfActions: card.querySelectorAll('[data-action="pdf"]').length,
      pdfButtons: Array.from(card.querySelectorAll('button')).filter(
        (button) => /PDF/i.test(button.textContent || '')
      ).length,
    };
  }, examId);

  if (!state || state.text !== '此PDF不存在') {
    throw new Error(`题目 ${examId} 未显示精确的 PDF 不可用状态`);
  }
  if (!state.visible || state.tagName === 'BUTTON' || state.role === 'button' || state.tabIndex || state.pdfActions || state.pdfButtons) {
    throw new Error(`题目 ${examId} 的 PDF 不可用状态仍可交互: ${JSON.stringify(state)}`);
  }
  return state;
}

async function openExamPopup(page, examId, consoleLog) {
  const selector = `#exam-list-container .exam-item[data-exam-id='${examId}'] button[data-action='start']`;
  const startBtn = page.locator(selector).first();
  const popupPromise = page.waitForEvent('popup', { timeout: 30_000 });
  await triggerExamOpen(page, examId, startBtn);
  const practicePage = await popupPromise;
  collectConsole(practicePage, consoleLog);
  await practicePage.waitForLoadState('load');
  return practicePage;
}

async function triggerExamOpen(page, examId, startBtn = null) {
  const button = startBtn || page.locator(
    `#exam-list-container .exam-item[data-exam-id='${examId}'] button[data-action='start']`
  ).first();

  if (await button.count() > 0) {
    await button.evaluate((node) => node.click());
    return;
  }

  await page.evaluate(async (targetExamId) => {
    if (!window.app || typeof window.app.openExam !== 'function') {
      throw new Error('openExam_missing');
    }
    await window.app.openExam(targetExamId);
  }, examId);
}

async function openUnifiedExam(page, examId, consoleLog) {
  const practicePage = await openExamPopup(page, examId, consoleLog);

  await page.waitForFunction(
    (targetExamId) => {
      const app = window.app;
      if (!app || !app.examWindows || typeof app.examWindows.get !== 'function') {
        return false;
      }
      const info = app.examWindows.get(targetExamId);
      return !!(info && info.expectedSessionId);
    },
    examId,
    { timeout: 12_000 }
  );

  await practicePage.waitForFunction(
    () => window.location.href.includes('assets/generated/reading-exams/reading-practice-unified.html') && !!document.getElementById('question-groups'),
    undefined,
    { timeout: 20_000 }
  );
  await practicePage.waitForFunction(
    () => document.getElementById('exam-title')?.textContent?.trim() === 'The internal body clock',
    undefined,
    { timeout: 20_000 }
  );
  await practicePage.locator('input[type="radio"][name="q1"][value="F"]').waitFor({
    state: 'visible',
    timeout: 20_000,
  });

  const sessionId = await page.evaluate(
    (targetExamId) => window.app?.examWindows?.get?.(targetExamId)?.expectedSessionId || '',
    examId
  );
  const collectorReady = await page.evaluate(
    (targetExamId) => !!window.app?.examWindows?.get?.(targetExamId)?.dataCollectorReady,
    examId
  );
  const popupUrl = await practicePage.evaluate(() => window.location.href);

  if (!sessionId) {
    throw new Error(`题目 ${examId} 未生成 expectedSessionId`);
  }

  return { practicePage, sessionId, collectorReady, popupUrl };
}

async function openManualPdfExam(page, examId) {
  await page.evaluate(() => {
    window.__readingPdfCapture = { urls: [] };
    window.__readingPdfNativeOpen = window.open;
    window.open = function (url) {
      const normalized = String(url || '');
      window.__readingPdfCapture.urls.push(normalized);
      return {
        closed: false,
        focus() { },
        location: { href: normalized },
      };
    };
  });

  try {
    await page.evaluate(async (targetExamId) => {
      if (!window.app || typeof window.app.openExam !== 'function') {
        throw new Error('openExam_missing');
      }
      await window.app.openExam(targetExamId, {
        target: 'tab',
        examDefinition: {
          id: targetExamId,
          type: 'reading',
          title: 'Manual PDF regression fixture',
          hasHtml: false,
          hasPdf: true,
          pdfFilename: 'ReadingPractice/PDF/26. P1 - The Tuatara of New Zealand 新西兰蜥蜴.pdf',
        },
      });
    }, examId);
    await page.waitForTimeout(300);
    const popupUrl = await page.evaluate(
      () => window.__readingPdfCapture?.urls?.slice(-1)[0] || ''
    );
    const hasSession = await page.evaluate(
      (targetExamId) => !!window.app?.examWindows?.get?.(targetExamId)?.expectedSessionId,
      examId
    );
    return { popupUrl, hasSession };
  } finally {
    await page.evaluate(() => {
      if (window.__readingPdfNativeOpen) {
        window.open = window.__readingPdfNativeOpen;
        delete window.__readingPdfNativeOpen;
      }
    });
  }
}

async function run() {
  ensureDir(REPORT_DIR);
  ensureDir(TMP_DIR);
  ensureDir(BROWSERS_DIR);

  process.env.TMPDIR = TMP_DIR;
  process.env.TMP = TMP_DIR;
  process.env.TEMP = TMP_DIR;
  const localBrowserEntries = fs.readdirSync(BROWSERS_DIR, { withFileTypes: true });
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH
    && localBrowserEntries.some((entry) => entry.isDirectory() && /^(?:chromium|firefox)-/.test(entry.name))) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS_DIR;
  }

  const startedAt = Date.now();
  const consoleLog = [];
  let status = 'fail';
  let examId = null;
  let sessionId = null;
  let manualPdfUrl = null;
  let failure = null;

  const { chromium, firefox } = await import('playwright');
  let browser;
  try {
    browser = await firefox.launch({ headless: true });
  } catch (firefoxError) {
    try {
      browser = await chromium.launch({
        headless: true,
        args: ['--allow-file-access-from-files'],
      });
    } catch (chromiumError) {
      throw new AggregateError([firefoxError, chromiumError], 'No installed Playwright browser could be launched');
    }
  }

  try {
    const context = await browser.newContext();
    context.on('page', (pg) => collectConsole(pg, consoleLog));
    const page = await context.newPage();
    collectConsole(page, consoleLog);

    logStep(`打开页面: ${INDEX_URL}`);
    await page.goto(INDEX_URL);
    await ensureAppReady(page);
    await dismissOverlays(page);
    logStep('应用初始化完成', 'SUCCESS');

    await clickNav(page, 'browse');
    await page.waitForFunction(
      () => window.AppLazyLoader && window.AppLazyLoader.getStatus('browse-runtime').loaded === true,
      { timeout: 20_000 }
    );
    logStep('browse-runtime 已按需加载', 'SUCCESS');

    const readingCount = await ensureReadingListReady(page);
    logStep(`reading 题目列表已就绪，数量: ${readingCount}`, 'SUCCESS');

    await assertUnavailablePdfCardState(page, TARGET_UNIFIED_EXAM_ID);
    logStep(`PDF 不可用卡片状态已锁定: ${TARGET_UNIFIED_EXAM_ID}`, 'SUCCESS');

    const openExamType = await page.evaluate(() => typeof (window.app && window.app.openExam));
    if (openExamType !== 'function') {
      throw new Error(`window.app.openExam 不可用: ${openExamType}`);
    }
    logStep('window.app.openExam 可用', 'SUCCESS');

    const checkpoint = consoleLog.length;
    examId = TARGET_UNIFIED_EXAM_ID;
    const opened = await openUnifiedExam(page, examId, consoleLog);
    sessionId = opened.sessionId;
    logStep(`选中统一页题目: ${examId}`, 'DEBUG');
    logStep(`父页通信会话已就绪: ${sessionId}`, 'SUCCESS');
    logStep(`SESSION_READY 状态: ${opened.collectorReady ? 'ready' : 'pending'}`, 'DEBUG');
    if (!opened.popupUrl.includes('assets/generated/reading-exams/reading-practice-unified.html')) {
      throw new Error(`统一阅读页 URL 非预期: ${opened.popupUrl}`);
    }

    await opened.practicePage.waitForSelector('#timer', { state: 'visible', timeout: 15_000 });
    await opened.practicePage.waitForSelector('#submit-btn', { state: 'visible', timeout: 15_000 });
    await opened.practicePage.locator('input[name="q1"][value="F"]').check();
    await opened.practicePage.locator('#submit-btn').click();

    const resultsScore = opened.practicePage.locator('#results .results-score-text');
    await resultsScore.waitFor({ state: 'visible', timeout: 15_000 });
    const resultsScoreText = String(await resultsScore.textContent() || '').trim();
    if (!resultsScoreText.includes('得分 1 / 13')) {
      throw new Error(`受影响题目的真实评分结果非预期: ${resultsScoreText}`);
    }

    await page.waitForTimeout(1800);
    if (!opened.practicePage.isClosed()) {
      await opened.practicePage.close();
    }

    await clickNav(page, 'practice');
    const semanticHandle = await page.waitForFunction(
      async (target) => {
        try {
          const records = await window.AppData.practice.list({ projection: 'full' });
          const matched = Array.isArray(records)
            ? records.filter((record) => String(record?.examId || '') === target.examId
              && String(record?.sessionId || '') === target.sessionId)
            : [];
          const record = matched.length ? matched[matched.length - 1] : null;
          const q1 = record?.answerComparison?.q1 || null;
          return record ? {
            q1Answer: record.answers?.q1 || '',
            q1UserAnswer: q1?.userAnswer || '',
            q1CorrectAnswer: q1?.correctAnswer || '',
            q1IsCorrect: q1?.isCorrect === true,
            correctAnswers: Number(record.correctAnswers),
            totalQuestions: Number(record.totalQuestions),
          } : null;
        } catch (_) {
          return null;
        }
      },
      { examId, sessionId },
      { timeout: 30_000 }
    );
    const semantic = await semanticHandle.jsonValue();
    if (!semantic
      || semantic.q1Answer !== 'F'
      || semantic.q1UserAnswer !== 'F'
      || semantic.q1CorrectAnswer !== 'F'
      || semantic.q1IsCorrect !== true
      || semantic.correctAnswers !== 1
      || semantic.totalQuestions !== 13) {
      throw new Error(`受影响题目的答案判定未正确持久化: ${JSON.stringify(semantic)}`);
    }
    logStep('练习记录和答案判定已落地', 'SUCCESS');

    const tailLogs = consoleLog.slice(checkpoint);
    const fallbackHits = tailLogs.filter((entry) => entry.text.includes('[Fallback]'));
    const syntheticHits = tailLogs.filter(
      (entry) => entry.text.includes('未找到匹配的活动会话') || entry.text.includes('合成数据')
    );

    if (fallbackHits.length > 0) {
      throw new Error(`检测到 fallback 握手路径: ${fallbackHits[0].text}`);
    }
    if (syntheticHits.length > 0) {
      throw new Error(`检测到 synthetic 保存路径: ${syntheticHits[0].text}`);
    }
    logStep('未检测到 fallback/synthetic 路径', 'SUCCESS');

    const manualPdf = await openManualPdfExam(page, TARGET_MANUAL_PDF_EXAM_ID);
    manualPdfUrl = manualPdf.popupUrl;
    logStep(`手工 PDF 题目已打开: ${TARGET_MANUAL_PDF_EXAM_ID}`, 'SUCCESS');
    if (manualPdfUrl.includes('reading-practice-unified.html') || !manualPdfUrl.toLowerCase().includes('.pdf')) {
      throw new Error(`手工 PDF 题目未打开 PDF: ${manualPdfUrl}`);
    }
    if (manualPdf.hasSession) {
      throw new Error('手工 PDF 题目不应建立 unified/session 会话');
    }

    status = 'pass';
  } catch (error) {
    failure = String(error && (error.stack || error.message || error));
    logStep(`测试失败: ${failure}`, 'ERROR');
  } finally {
    await browser.close().catch(() => { });
    const report = {
      generatedAt: nowIso(),
      duration: (Date.now() - startedAt) / 1000,
      status,
      examId,
      sessionId,
      manualPdfExamId: TARGET_MANUAL_PDF_EXAM_ID,
      manualPdfUrl,
      error: failure,
      consoleSummary: {
        total: consoleLog.length,
        errors: consoleLog.filter((entry) => String(entry.type).toLowerCase() === 'error').length,
        warnings: consoleLog.filter((entry) => String(entry.type).toLowerCase() === 'warning').length,
      },
      consoleLogs: consoleLog,
    };
    fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  process.exit(status === 'pass' ? 0 : 1);
}

run().catch((error) => {
  try {
    ensureDir(REPORT_DIR);
    fs.writeFileSync(
      REPORT_FILE,
      `${JSON.stringify({ generatedAt: nowIso(), status: 'fail', error: String(error && (error.stack || error.message || error)) }, null, 2)}\n`,
      'utf8'
    );
  } catch (_) { }
  process.stderr.write(String(error && (error.stack || error.message || error)) + '\n');
  process.exit(1);
});
