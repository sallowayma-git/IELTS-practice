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
  ok(/POOL_CONTAINER_SELECTOR[^\n]*\.cardpool/.test(unifiedPage), 'cardpool_container_missing', failed);
  ok(/POOL_CONTAINER_SELECTOR[^\n]*\.option-pool/.test(unifiedPage), 'option_pool_container_missing', failed);
  ok(/\.card\.option-consumed\s*\{[\s\S]*?opacity:\s*0\.45/.test(unifiedPage), 'card_consumed_style_missing', failed);
  ok(/\.card\.option-consumed\s*\{[\s\S]*?opacity:\s*0\.45/.test(unifiedHtml), 'unified_html_card_consumed_style_missing', failed);
  ok(/splitAnswerTokens\(rawValue\)\s*\.map\(\(entry\) => canonicalizeAnswerToken\(entry\)\)/.test(unifiedPage), 'replay_field_value_list_not_normalized', failed);
  ok(!/String\(rawValue == null \? '' : rawValue\)\.split/.test(unifiedPage), 'replay_raw_object_string_split_regressed', failed);
  ok(/--reading-left-pane-width/.test(unifiedHtml), 'missing_resizable_reading_pane_width_var', failed);
  ok(/grid-template-columns:[\s\S]*var\(--reading-left-pane-width\)/.test(unifiedHtml), 'reading_shell_not_css_grid_resizable', failed);
  ok(/id="divider"[^>]*role="separator"/.test(unifiedHtml), 'divider_missing_separator_role', failed);
  ok(/function attachPaneResizer\s*\(/.test(unifiedPage), 'missing_pane_resizer_function', failed);
  ok(/addEventListener\('pointerdown'/.test(unifiedPage), 'pane_resizer_missing_pointer_binding', failed);
  ok(/addEventListener\('keydown'/.test(unifiedPage), 'pane_resizer_missing_keyboard_binding', failed);
  ok(/attachPaneResizer\(\);/.test(unifiedPage), 'pane_resizer_not_bootstrapped', failed);
  ok(!/unified-group__lead/.test(unifiedPage), 'question_group_outer_lead_rendered_again', failed);
  // The question pane follows the official paper layout: flat groups, no cards.
  // These locks pin the reference metrics so the card chrome cannot creep back.
  ok(/#right\s*\{[^}]*padding-left:\s*17px[^}]*padding-right:\s*31px/.test(unifiedHtml), 'question_area_padding_not_reference', failed);
  ok(/\.unified-group\s*\{[^}]*margin:\s*0 0 31px/.test(unifiedHtml), 'question_group_spacing_not_reference', failed);
  ok(/\.group\s*\{[^}]*background:\s*transparent[^}]*box-shadow:\s*none/.test(unifiedHtml), 'question_card_chrome_regressed', failed);
  ok(/\.matching-table\s*\{[\s\S]*border-spacing:\s*0 4px/.test(unifiedHtml), 'matching_table_row_spacing_missing', failed);
  ok(/\.matching-table tbody td:first-child\s*\{[\s\S]*line-height:\s*1\.35/.test(unifiedHtml), 'matching_table_question_text_spacing_missing', failed);
  ok(/\.tfng-item\s*\{[\s\S]*margin:\s*0 0 14px/.test(unifiedHtml), 'tfng_question_block_spacing_missing', failed);
  ok(/#right \.tfng-item > p\s*\{[\s\S]*margin:\s*0 0 6px/.test(unifiedHtml), 'tfng_stem_option_spacing_not_scoped', failed);
  ok(/\.tfng-options\s*\{[\s\S]*gap:\s*4px 12px/.test(unifiedHtml), 'tfng_option_row_spacing_missing', failed);
  ok(/function restoreHighlights\s*\([\s\S]*?return restoredCount;/.test(highlightShared), 'restoreHighlights_no_restore_count', failed);
  // Body grid is a 4-row layout: header / part intro / reading shell / nav.
  ok(/grid-template-rows: var\(--header-height\) auto minmax\(0, 1fr\) var\(--footer-height\)/.test(unifiedHtml), 'body_grid_rows_not_reference', failed);
  ok(/\.shell\s*\{[\s\S]*?grid-row: 3/.test(unifiedHtml), 'reading_shell_grid_row_not_reference', failed);
  ok(/\.practice-nav\s*\{[\s\S]*?grid-row: 4/.test(unifiedHtml), 'practice_nav_grid_row_not_reference', failed);
  ok(/dom\.submitBtn\.querySelector\('\.submit-btn-icon'\)/.test(unifiedPage), 'readonly_submit_icon_not_preserved', failed);
  ok(
    /dom\.resetBtn\.style\.display = shouldShowReset \? '' : 'none';/.test(unifiedPage)
      && /const shouldShowReset = canResetSubmittedSingle \|\| state\.reviewMode;/.test(unifiedPage),
    'footer_reset_not_limited_to_review_and_retake',
    failed
  );
  ok(/id="options-clear-answers"[^>]*>Clear answers<\/button>/.test(unifiedHtml), 'options_clear_answers_action_missing', failed);
  ok(/function canClearDraftAnswers\s*\([\s\S]*state\.submissionStatus === 'draft'[\s\S]*!state\.readOnly[\s\S]*!state\.submitted[\s\S]*!state\.reviewMode[\s\S]*!state\.memorizeMode/.test(unifiedPage), 'options_clear_answers_not_draft_gated', failed);
  ok(/getElementById\('options-clear-answers'\)\?\.addEventListener\('click', handleReset\)/.test(unifiedPage), 'options_clear_answers_not_bound_to_reset', failed);
  ok(/setSettingsBackgroundInert\(true\)/.test(unifiedPage), 'options_background_not_inert', failed);
  ok(/settingsPanel\?\.addEventListener\('keydown', trapSettingsFocus\)/.test(unifiedPage), 'options_focus_trap_not_bound', failed);
  ok(/body\?\.focus\(\)/.test(unifiedPage), 'note_editor_body_focus_missing', failed);
  ok(!/String\(note\.title \|\| ''\)\.trim\(\) \|\| 'Untitled note'/.test(unifiedPage), 'note_title_fallback_not_using_buildDefaultNoteTitle', failed);
  ok(/buildDefaultNoteTitle\(note\.quote\)/.test(unifiedPage), 'note_title_buildDefaultNoteTitle_not_called', failed);
  ok(/id="connection-indicator"[^>]*role="status"/.test(unifiedHtml), 'connection_indicator_id_missing', failed);
  ok(/@media \(max-width: 480px\)[\s\S]*?#connection-indicator\s*\{[^}]*display: none/.test(unifiedHtml), 'connection_indicator_not_collapsed_at_480', failed);
  ok(/@media \(max-width: 400px\)[\s\S]*?#messages-indicator\s*\{[^}]*display: none/.test(unifiedHtml), 'messages_indicator_not_collapsed_at_400', failed);
  ok(/@media \(max-width: 360px\)[\s\S]*?\.ielts-brand\s*\{[^}]*display: none/.test(unifiedHtml), 'ielts_brand_not_collapsed_at_360', failed);
  // Notes: an icon button in the header, and noted text uses the reference's
  // .note-anchor blue rather than the marker-chip yellow.
  ok(/id="notes-drawer-btn"[^>]*class="header-btn reading-notes-btn"|class="header-btn reading-notes-btn" id="notes-drawer-btn"/.test(unifiedHtml), 'notes_button_not_in_header', failed);
  ok(/id="notes-drawer-btn"[\s\S]{0,600}?svg class="header-icon"/.test(unifiedHtml), 'notes_button_missing_icon', failed);
  ok(/id="notes-drawer-btn"[\s\S]{0,900}?class="reading-note-count"/.test(unifiedHtml), 'notes_button_missing_count_badge', failed);
  ok(/\.hl\[data-hl-type="note"\]\s*\{[^}]*background-color: rgb\(32, 76, 207\)/.test(unifiedHtml), 'note_highlight_colour_regressed', failed);
  ok(/\.hl\[data-note-id\]\{[^}]*background:rgb\(32,76,207\)!important/.test(unifiedPage), 'injected_note_highlight_colour_regressed', failed);
  ok(!/rgba\(191,219,254/.test(unifiedPage), 'pale_blue_note_highlight_returned', failed);
  // Part intro is a thin bar butted under the header, not an inset card, and
  // the reading panes scroll without showing a scrollbar.
  ok(/--intro-height: 34px/.test(unifiedHtml), 'part_intro_not_thin_bar_height', failed);
  ok(/\.sub-header-bar\s*\{[^}]*margin: 0;[^}]*border-radius: 0/.test(unifiedHtml), 'part_intro_card_chrome_regressed', failed);
  ok(/\.sub-header-bar\s*\{[^}]*border-bottom: 1px solid var\(--soft-line\)/.test(unifiedHtml), 'part_intro_missing_bottom_rule', failed);
  ok(/\.pane\s*\{[^}]*scrollbar-width: none/.test(unifiedHtml), 'pane_scrollbar_not_hidden', failed);
  ok(/\.pane::-webkit-scrollbar\s*\{[^}]*display: none/.test(unifiedHtml), 'pane_webkit_scrollbar_not_hidden', failed);
  ok(!/\.pane::-webkit-scrollbar-thumb/.test(unifiedHtml), 'pane_scrollbar_thumb_regressed', failed);
  ok(/\.pane\s*\{[^}]*overflow-y: auto/.test(unifiedHtml), 'pane_scrolling_disabled', failed);
  // Selection bar sits below the selected text; its arrow points up at it, and
  // both bar and arrow flip together when there is no room below.
  ok(/#selbar\s*\{[^}]*position: fixed/.test(unifiedHtml), 'selection_bar_not_viewport_positioned', failed);
  ok(/#selbar\.is-above::before\s*\{[^}]*bottom: -5px[^}]*transform: rotate\(45deg\)/.test(unifiedHtml), 'selection_bar_flipped_arrow_missing', failed);
  ok(/const fitsBelow = below \+ height <= viewportHeight - margin;/.test(unifiedPage), 'selection_bar_below_placement_regressed', failed);
  ok(/toolbar\.classList\.toggle\('is-above', isAbove\);/.test(unifiedPage), 'selection_bar_arrow_flip_not_wired', failed);
  ok(!/global\.scrollY \+ rect\.top - toolbar\.offsetHeight/.test(unifiedPage), 'selection_bar_above_first_placement_returned', failed);
  // The bell is decorative: this project has no messages surface to open.
  ok(!/id="messages-btn"/.test(unifiedHtml), 'dead_messages_button_reintroduced', failed);
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
