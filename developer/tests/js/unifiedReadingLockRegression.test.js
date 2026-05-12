#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function ok(cond, label, failed) {
  if (!cond) failed.push(label);
}

function run() {
  const failed = [];
  const unifiedHtml = read('assets/generated/reading-exams/reading-practice-unified.html');
  const unifiedPage = read('js/runtime/unifiedReadingPage.js');
  const highlightShared = read('js/runtime/readingHighlightShared.js');

  ok(!/practice-page-ui\.js/.test(unifiedHtml), 'unified_html_loads_practice_page_ui', failed);
  ok(!/leftHtmlWithHighlights/.test(unifiedPage), 'unified_page_contains_leftHtmlWithHighlights', failed);
  ok(/function enterSubmittedReadOnlyState\s*\(/.test(unifiedPage), 'missing_enterSubmittedReadOnlyState', failed);
  ok(/dom\.exitBtn\?\.addEventListener\('click',\s*handleExitClick\)/.test(unifiedPage), 'missing_exit_btn_binding', failed);
  ok(/ENDLESS_USER_EXIT/.test(unifiedPage), 'missing_endless_exit_message', failed);
  ok(/stopEndlessPractice/.test(unifiedPage), 'missing_endless_stop_function', failed);
  ok(/AppActions\.stopEndlessPractice/.test(unifiedPage), 'missing_endless_appactions_stop', failed);
  ok(/postMessage\('SUITE_USER_EXIT'/.test(unifiedPage), 'missing_suite_user_exit_message', failed);
  ok(/function restoreHighlights\s*\([\s\S]*?return restoredCount;/.test(highlightShared), 'restoreHighlights_no_restore_count', failed);

  if (failed.length) {
    process.stdout.write(JSON.stringify({
      status: 'fail',
      detail: 'unified reading lock regression static checks failed',
      failed
    }));
    process.exit(1);
  }

  process.stdout.write(JSON.stringify({
    status: 'pass',
    detail: 'unified reading lock regression static checks passed'
  }));
}

run();
