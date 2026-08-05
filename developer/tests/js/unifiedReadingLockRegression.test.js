#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import vm from 'vm';
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

async function testEndlessLifecycle(failed) {
  const appActionsSource = read('js/presentation/app-actions.js');
  const intervalCallbacks = new Map();
  let nextIntervalId = 0;
  let messageHandler = null;
  const practiceWindow = {
    closed: false,
    focus() {},
    postMessage() {},
    location: { href: 'about:blank' }
  };
  const openCalls = [];
  const examWindows = new Map();
  const exams = [{
    id: 'reading-endless',
    type: 'reading',
    hasHtml: true,
    title: 'Endless Reading'
  }];
  const windowStub = {
    location: { href: 'https://example.test/index.html' },
    document: {
      readyState: 'loading',
      addEventListener() {},
      querySelector() { return null; }
    },
    resolveActiveLibraryIndex: async () => exams,
    showMessage() {},
    addEventListener(type, listener) {
      if (type === 'message') messageHandler = listener;
    },
    removeEventListener(type, listener) {
      if (type === 'message' && messageHandler === listener) messageHandler = null;
    },
    app: {
      examWindows,
      async openExam(examId, options) {
        openCalls.push({ examId, options });
        examWindows.set(examId, {
          expectedOrigin: 'https://example.test',
          allowOpaqueOrigin: false,
          windowSessionToken: 'endless-token'
        });
        return practiceWindow;
      },
      _postExamMessage() { return true; }
    }
  };
  const context = vm.createContext({
    window: windowStub,
    document: windowStub.document,
    console,
    URL,
    Promise,
    Math,
    Date,
    setInterval(callback) {
      const id = ++nextIntervalId;
      intervalCallbacks.set(id, callback);
      return id;
    },
    clearInterval(id) {
      intervalCallbacks.delete(id);
    }
  });
  vm.runInContext(appActionsSource, context, { filename: 'app-actions.js' });

  await windowStub.AppActions.startEndlessPractice();
  ok(openCalls.length === 1, 'endless_first_open_not_called', failed);
  ok(openCalls[0]?.options?.endlessMode === true, 'endless_first_open_missing_mode', failed);
  ok(openCalls[0]?.options?.windowName === 'ielts-endless-mode-tab', 'endless_first_open_missing_stable_window_name', failed);
  ok(typeof messageHandler === 'function', 'endless_message_handler_not_installed', failed);

  messageHandler?.({
    source: practiceWindow,
    origin: 'https://example.test',
    data: {
      type: 'PRACTICE_COMPLETE',
      source: 'practice_page',
      data: { windowSessionToken: 'endless-token' }
    }
  });
  const countdownId = Math.max(...intervalCallbacks.keys());
  for (let tick = 0; tick < 5; tick += 1) {
    intervalCallbacks.get(countdownId)?.();
  }
  await Promise.resolve();
  await Promise.resolve();
  ok(openCalls.length === 2, 'endless_next_exam_did_not_use_openExam', failed);
  ok(openCalls[1]?.options?.reuseWindow === practiceWindow, 'endless_next_exam_did_not_reuse_window', failed);
  ok(openCalls[1]?.options?.endlessMode === true, 'endless_next_exam_missing_mode', failed);
  windowStub.AppActions.stopEndlessPractice({ silent: true });
}

async function run() {
  const failed = [];
  const unifiedHtml = read('assets/generated/reading-exams/reading-practice-unified.html');
  const unifiedPage = read('js/runtime/unifiedReadingPage.js');
  const highlightShared = read('js/runtime/readingHighlightShared.js');

  ok(!/practice-page-ui\.js/.test(unifiedHtml), 'unified_html_loads_practice_page_ui', failed);
  ok(!/leftHtmlWithHighlights/.test(unifiedPage), 'unified_page_contains_leftHtmlWithHighlights', failed);
  ok(/function enterSubmittedReadOnlyState\s*\(/.test(unifiedPage), 'missing_enterSubmittedReadOnlyState', failed);
  ok(/function setTimerLockMode\s*\([\s\S]*data-note-outline-add[\s\S]*disabled/.test(unifiedPage), 'timer_lock_does_not_disable_note_controls', failed);
  ok(/function canEditReadingNotes\s*\(\)\s*\{\s*if \(state\.timerLocked\) return false;/.test(unifiedPage), 'can_edit_notes_allows_timer_lock', failed);
  ok(/function upsertNote\s*\([\s\S]*if \(!canEditReadingNotes\(\)\) return null;/.test(unifiedPage), 'note_upsert_not_guarded_by_timer_lock', failed);
  ok(/function syncReadingAnnotation\s*\([\s\S]*if \(!canEditReadingNotes\(\)\) return;/.test(unifiedPage), 'annotation_sync_not_guarded_by_timer_lock', failed);
  ok(/function canSyncReadingDraft\s*\([\s\S]*!state\.timerLocked/.test(unifiedPage), 'draft_sync_not_guarded_by_timer_lock', failed);
  ok(/dom\.exitBtn\?\.addEventListener\('click',\s*handleExitClick\)/.test(unifiedPage), 'missing_exit_btn_binding', failed);
  ok(/ENDLESS_USER_EXIT/.test(unifiedPage), 'missing_endless_exit_message', failed);
  ok(/stopEndlessPractice/.test(unifiedPage), 'missing_endless_stop_function', failed);
  ok(/AppActions\.stopEndlessPractice/.test(unifiedPage), 'missing_endless_appactions_stop', failed);
  ok(/postMessage\('SUITE_USER_EXIT'/.test(unifiedPage), 'missing_suite_user_exit_message', failed);
  ok(/function normalizeAnswerForReplay\s*\(/.test(unifiedPage), 'missing_review_answer_normalizer', failed);
  ok(/displayAnswerValue\(entry\.userAnswer\)/.test(unifiedPage), 'review_results_user_answer_not_normalized', failed);
  ok(/displayAnswerValue\(entry\.correctAnswer,\s*''\)/.test(unifiedPage), 'review_results_correct_answer_not_normalized', failed);
  ok(/setDropzoneAnswer\(dropzone,\s*value,\s*label\)/.test(unifiedPage), 'dropzone_replay_label_not_preserved', failed);
  ok(/value:\s*item\.dataset\.heading\s*\|\|\s*item\.dataset\.option\s*\|\|\s*item\.dataset\.key/.test(unifiedPage), 'drag_payload_ignores_data_key', failed);
  ok(/const valueList = splitAnswerTokens\(rawValue\);/.test(unifiedPage), 'replay_field_value_list_not_normalized', failed);
  ok(!/String\(rawValue == null \? '' : rawValue\)\.split/.test(unifiedPage), 'replay_raw_object_string_split_regressed', failed);
  ok(/--reading-left-pane-width/.test(unifiedHtml), 'missing_resizable_reading_pane_width_var', failed);
  ok(/grid-template-columns:[\s\S]*var\(--reading-left-pane-width\)/.test(unifiedHtml), 'reading_shell_not_css_grid_resizable', failed);
  ok(/id="divider"[^>]*role="separator"/.test(unifiedHtml), 'divider_missing_separator_role', failed);
  ok(/function attachPaneResizer\s*\(/.test(unifiedPage), 'missing_pane_resizer_function', failed);
  ok(/addEventListener\('pointerdown'/.test(unifiedPage), 'pane_resizer_missing_pointer_binding', failed);
  ok(/addEventListener\('keydown'/.test(unifiedPage), 'pane_resizer_missing_keyboard_binding', failed);
  ok(/attachPaneResizer\(\);/.test(unifiedPage), 'pane_resizer_not_bootstrapped', failed);
  ok(!/unified-group__lead/.test(unifiedPage), 'question_group_outer_lead_rendered_again', failed);
  ok(/#right\s*\{[\s\S]*padding:\s*12px 14px/.test(unifiedHtml), 'question_area_padding_not_compact', failed);
  ok(/\.unified-group\s*\{[\s\S]*margin-bottom:\s*16px/.test(unifiedHtml), 'question_group_spacing_not_compact', failed);
  ok(/\.group\s*\{[\s\S]*border-radius:\s*8px[\s\S]*padding:\s*18px 22px[\s\S]*margin-bottom:\s*0/.test(unifiedHtml), 'question_card_padding_not_compact', failed);
  ok(/\.matching-table\s*\{[\s\S]*border-spacing:\s*0 4px/.test(unifiedHtml), 'matching_table_row_spacing_missing', failed);
  ok(/\.matching-table tbody td:first-child\s*\{[\s\S]*line-height:\s*1\.35/.test(unifiedHtml), 'matching_table_question_text_spacing_missing', failed);
  ok(/\.tfng-item\s*\{[\s\S]*margin:\s*0 0 14px/.test(unifiedHtml), 'tfng_question_block_spacing_missing', failed);
  ok(/#right \.tfng-item > p\s*\{[\s\S]*margin:\s*0 0 6px/.test(unifiedHtml), 'tfng_stem_option_spacing_not_scoped', failed);
  ok(/\.tfng-options\s*\{[\s\S]*gap:\s*4px 12px/.test(unifiedHtml), 'tfng_option_row_spacing_missing', failed);
  ok(/function restoreHighlights\s*\([\s\S]*?return restoredCount;/.test(highlightShared), 'restoreHighlights_no_restore_count', failed);
  await testEndlessLifecycle(failed);

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

await run();
