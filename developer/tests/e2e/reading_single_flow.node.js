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
    } catch (_) {}
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
      try { window.loadExamList(); } catch (_) {}
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

async function openPlayableExam(page, consoleLog) {
  const examIds = await page.evaluate(
    () => Array.from(document.querySelectorAll('#exam-list-container .exam-item[data-exam-id]'))
      .map((item) => (item.dataset && item.dataset.examId) || '')
      .filter((examId) => !!examId)
  );

  if (!examIds.length) {
    throw new Error('题库列表为空，无法执行单篇 E2E');
  }

  const maxTry = Math.min(examIds.length, 8);
  for (let index = 0; index < maxTry; index += 1) {
    const examId = examIds[index];
    const selector = `#exam-list-container .exam-item[data-exam-id='${examId}'] button[data-action='start']`;
    const startBtn = page.locator(selector).first();
    if (await startBtn.count() === 0) {
      continue;
    }

    let practicePage = null;
    try {
      const popupPromise = page.waitForEvent('popup', { timeout: 30_000 });
      await startBtn.click();
      practicePage = await popupPromise;
      collectConsole(practicePage, consoleLog);
      await practicePage.waitForLoadState('load');

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

      const sessionId = await page.evaluate(
        (targetExamId) => window.app?.examWindows?.get?.(targetExamId)?.expectedSessionId || '',
        examId
      );
      const collectorReady = await page.evaluate(
        (targetExamId) => !!window.app?.examWindows?.get?.(targetExamId)?.dataCollectorReady,
        examId
      );
      if (!sessionId) {
        throw new Error(`题目 ${examId} 未生成 expectedSessionId`);
      }
      return { examId, practicePage, index, sessionId, collectorReady };
    } catch (error) {
      logStep(`candidate #${index + 1} (${examId}) 不可用: ${String(error)}`, 'DEBUG');
      if (practicePage && !practicePage.isClosed()) {
        try { await practicePage.close(); } catch (_) {}
      }
    }
  }

  throw new Error('未找到可建立父页会话映射的单篇题目');
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
    const opened = await openPlayableExam(page, consoleLog);
    examId = opened.examId;
    sessionId = opened.sessionId;
    logStep(`选中题目: ${examId} (candidate #${opened.index + 1})`, 'DEBUG');
    logStep(`父页通信会话已就绪: ${sessionId}`, 'SUCCESS');
    logStep(`SESSION_READY 状态: ${opened.collectorReady ? 'ready' : 'pending'}`, 'DEBUG');

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

    status = 'pass';
  } catch (error) {
    failure = String(error && (error.stack || error.message || error));
    logStep(`测试失败: ${failure}`, 'ERROR');
  } finally {
    await browser.close().catch(() => {});
    const report = {
      generatedAt: nowIso(),
      duration: (Date.now() - startedAt) / 1000,
      status,
      examId,
      sessionId,
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
  } catch (_) {}
  process.stderr.write(String(error && (error.stack || error.message || error)) + '\n');
  process.exit(1);
});
