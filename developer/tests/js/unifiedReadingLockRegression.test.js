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
  ok(/function normalizeAnswerForReplay\s*\(/.test(unifiedPage), 'missing_review_answer_normalizer', failed);
  ok(/displayAnswerValue\(entry\.userAnswer\)/.test(unifiedPage), 'review_results_user_answer_not_normalized', failed);
  ok(/displayAnswerValue\(entry\.correctAnswer,\s*''\)/.test(unifiedPage), 'review_results_correct_answer_not_normalized', failed);
  ok(/setDropzoneAnswer\(dropzone,\s*value,\s*label\)/.test(unifiedPage), 'dropzone_replay_label_not_preserved', failed);
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
