#!/usr/bin/env node
/**
 * Node fallback runner for reading_single_flow.py when Python Playwright is unavailable.
 *
 * Report artifact:
 * - developer/tests/e2e/reports/reading-single-flow-report.json
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
const REPORT_FILE = path.join(REPORT_DIR, 'reading-single-flow-report.json');
const TMP_DIR = '/tmp/ielts-playwright-tmp';
const BROWSERS_DIR = path.join(REPO_ROOT, 'developer', 'tests', 'e2e', '.pw-browsers');
const TARGET_UNIFIED_EXAM_ID = 'p3-medium-169';
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
  await page.waitForFunction(
    () => window.app && window.app.isInitialized && window.storage && typeof window.storage.get === 'function',
    { timeout: 60_000 }
  );
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
    } catch (_) { }
  }
}

async function clickNav(page, view) {
  await page.locator(`nav button[data-view='${view}']`).click();
  await page.waitForSelector(`#${view}-view.active`, { timeout: 15_000 });
}

async function waitExamIndexReady(page) {
  await page.waitForFunction(
    () => {
      const candidates = [];
      if (window.appStateService && typeof window.appStateService.getExamIndex === 'function') {
        candidates.push(window.appStateService.getExamIndex());
      }
      if (typeof window.getExamIndexState === 'function') {
        candidates.push(window.getExamIndexState());
      }
      if (window.app && window.app.state && Array.isArray(window.app.state.examIndex)) {
        candidates.push(window.app.state.examIndex);
      }
      if (Array.isArray(window.examIndex)) {
        candidates.push(window.examIndex);
      }
      return candidates.some((item) => Array.isArray(item) && item.length > 0);
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
    { timeout: 20_000 }
  );

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
      await window.app.openExam(targetExamId, { target: 'tab' });
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
  process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS_DIR;

  const startedAt = Date.now();
  const consoleLog = [];
  let status = 'fail';
  let examId = null;
  let sessionId = null;
  let manualPdfUrl = null;
  let failure = null;

  const { firefox } = await import('playwright');
  const browser = await firefox.launch({ headless: true });

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

    const completionPayload = {
      examId,
      sessionId,
      duration: 95,
      startTime: nowIso(),
      endTime: nowIso(),
      scoreInfo: {
        correct: 1,
        total: 2,
        accuracy: 0.5,
        percentage: 50,
        source: 'practice_page',
      },
      answers: { q1: 'A', q2: 'B' },
      correctAnswers: { q1: 'A', q2: 'C' },
      answerComparison: {
        q1: { questionId: 'q1', userAnswer: 'A', correctAnswer: 'A', isCorrect: true },
        q2: { questionId: 'q2', userAnswer: 'B', correctAnswer: 'C', isCorrect: false },
      },
      metadata: { source: 'reading_single_e2e' },
    };

    await opened.practicePage.evaluate((payload) => {
      const target = window.opener || window.parent;
      if (!target || typeof target.postMessage !== 'function') {
        throw new Error('missing_message_target');
      }
      target.postMessage({ type: 'PRACTICE_COMPLETE', data: payload, source: 'practice_page' }, '*');
    }, completionPayload);

    await page.waitForTimeout(1800);
    if (!opened.practicePage.isClosed()) {
      await opened.practicePage.close();
    }

    await clickNav(page, 'practice');
    await page.waitForFunction(
      (targetExamId) => {
        const recordsFromState = window.app?.state?.practice?.records;
        if (Array.isArray(recordsFromState) &&
          recordsFromState.some((r) => String(r?.examId || '') === targetExamId)) {
          return true;
        }
        if (typeof window.getPracticeRecordsState === 'function') {
          try {
            const records = window.getPracticeRecordsState();
            return Array.isArray(records) &&
              records.some((r) => String(r?.examId || '') === targetExamId);
          } catch (_) {
            return false;
          }
        }
        return false;
      },
      examId,
      { timeout: 30_000 }
    );
    logStep('练习记录已落地', 'SUCCESS');

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
