#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const guardedFiles = [
    'js/app/examSessionMixin.js',
    'js/practice-page-enhancer.js',
    'js/runtime/unifiedReadingPage.js',
    'templates/exam-placeholder.html'
];

for (const relativePath of guardedFiles) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    assert(
        source.includes('resolveTrustedSuiteNavigationUrl'),
        `${relativePath} must validate suite navigation URLs before navigating`
    );
    assert(
        !/location\.href\s*=\s*data\.url/.test(source),
        `${relativePath} must not navigate directly to postMessage data.url`
    );
    assert(
        source.includes("resolved.protocol === 'http:'") && source.includes("resolved.protocol === 'https:'"),
        `${relativePath} must explicitly allow only same-origin HTTP(S) navigation`
    );
    assert(
        source.includes("resolved.protocol === 'file:'"),
        `${relativePath} must keep the local file fallback explicit`
    );
}

const examSessionMixinSource = fs.readFileSync(path.join(repoRoot, 'js/app/examSessionMixin.js'), 'utf8');
assert(
    examSessionMixinSource.includes('function escapeCssSelectorValue') &&
    examSessionMixinSource.includes('document.querySelectorAll(`[data-exam-id="${escapeCssSelectorValue(examId)}"]`)') &&
    !examSessionMixinSource.includes('document.querySelectorAll(`[data-exam-id="${examId}"]`)'),
    'exam session UI updates must escape dynamic exam IDs before using them in selectors'
);
assert(
    examSessionMixinSource.includes('replace(/[\\u0000-\\u001F\\u007F"\\\\]/g') &&
    examSessionMixinSource.includes("return '\\\\' + char.charCodeAt(0).toString(16) + ' ';"),
    'exam session CSS selector fallback must escape control characters as CSS code points'
);
assert(
    examSessionMixinSource.includes("const safeStatus = ['in-progress', 'completed', 'interrupted', 'error'].includes(status) ? status : 'error'") &&
    examSessionMixinSource.includes('statusIndicator.className = `exam-status ${safeStatus}`') &&
    examSessionMixinSource.includes('detail: { examId, status: safeStatus }') &&
    !examSessionMixinSource.includes('statusIndicator.className = `exam-status ${status}`'),
    'exam session UI updates must normalize status before using it in className or events'
);

const practicePageEnhancerSource = fs.readFileSync(path.join(repoRoot, 'js/practice-page-enhancer.js'), 'utf8');
assert(
    practicePageEnhancerSource.includes('const normalizedSuiteId = String(suiteId || \'\')') &&
    practicePageEnhancerSource.includes('document.querySelector(`[data-suite-id="${cssEscape(normalizedSuiteId)}"]`)') &&
    !practicePageEnhancerSource.includes('document.querySelector(`[data-suite-id="${suiteId}"]`)'),
    'practice page enhancer must escape dynamic suite IDs before using them in selectors'
);
assert(
    practicePageEnhancerSource.includes('replace(/[\\u0000-\\u001F\\u007F"\\\\]/g') &&
    practicePageEnhancerSource.includes("return '\\\\' + char.charCodeAt(0).toString(16) + ' ';"),
    'practice page enhancer CSS selector fallback must escape control characters as CSS code points'
);
assert(
    practicePageEnhancerSource.includes('document.querySelector(`label[for="${cssEscape(input.id)}"]`)') &&
    !practicePageEnhancerSource.includes('document.querySelector(`label[for="${input.id}"]`)'),
    'practice page enhancer must escape dynamic input IDs before looking up labels'
);

const vocabSessionViewSource = fs.readFileSync(path.join(repoRoot, 'js/components/vocabSessionView.js'), 'utf8');
assert(
    vocabSessionViewSource.includes('function escapeCssSelectorValue') &&
    vocabSessionViewSource.includes('state.elements.sessionCard.querySelector(`[data-action="${escapeCssSelectorValue(action)}"]`)') &&
    !vocabSessionViewSource.includes('state.elements.sessionCard.querySelector(`[data-action="${action}"]`)'),
    'vocab session view must escape dynamic action names before using them in selectors'
);

const appSource = fs.readFileSync(path.join(repoRoot, 'js/app.js'), 'utf8');
assert(
    appSource.includes('function escapeCssSelectorValue') &&
    appSource.includes('document.querySelector(`[data-view="${escapeCssSelectorValue(viewName)}"]`)') &&
    !appSource.includes('document.querySelector(`[data-view="${viewName}"]`)'),
    'app navigation must escape dynamic view names before using them in selectors'
);
assert(
    appSource.includes('const escapedCategory = escapeCssSelectorValue(category)') &&
    appSource.includes('document.querySelector(`[data-category="${escapedCategory}"] .progress-fill`)') &&
    appSource.includes('document.querySelector(`[data-category="${escapedCategory}"] .progress-text`)') &&
    !appSource.includes('document.querySelector(`[data-category="${category}"] .progress-fill`)') &&
    !appSource.includes('document.querySelector(`[data-category="${category}"] .progress-text`)'),
    'app category progress updates must escape dynamic category values before using them in selectors'
);

const bootFallbacksSource = fs.readFileSync(path.join(repoRoot, 'js/boot-fallbacks.js'), 'utf8');
assert(
    bootFallbacksSource.includes('function escapeFallbackCssSelectorValue') &&
    bootFallbacksSource.includes('navContainer.querySelector(\'[data-view="\' + escapeFallbackCssSelectorValue(normalized) + \'"]\')') &&
    !bootFallbacksSource.includes('navContainer.querySelector(\'[data-view="\' + normalized + \'"]\')'),
    'boot fallback navigation must escape dynamic view names before using them in selectors'
);

const unifiedReadingPageSource = fs.readFileSync(path.join(repoRoot, 'js/runtime/unifiedReadingPage.js'), 'utf8');
assert(
    unifiedReadingPageSource.includes('replace(/[\\u0000-\\u001F\\u007F"\\\\]/g') &&
    unifiedReadingPageSource.includes("return '\\\\' + char.charCodeAt(0).toString(16) + ' ';"),
    'unified reading CSS selector fallback must escape control characters as CSS code points'
);
assert(
    unifiedReadingPageSource.includes('const escapedSourceDropzoneId = payload.sourceDropzoneId ? escapeSelector(payload.sourceDropzoneId) : \'\'') &&
    unifiedReadingPageSource.includes('document.querySelector(`[data-dropzone-id="${escapedSourceDropzoneId}"]`)') &&
    unifiedReadingPageSource.includes('document.querySelector(`[data-dropzone-id="${escapeSelector(payload.sourceDropzoneId)}"]`)') &&
    !unifiedReadingPageSource.includes('document.querySelector(`[data-dropzone-id="${payload.sourceDropzoneId}"]`)'),
    'unified reading drag/drop must escape dynamic dropzone IDs before using them in selectors'
);
assert(
    unifiedReadingPageSource.includes('const MAX_DRAG_PAYLOAD_CHARS = 4096') &&
    unifiedReadingPageSource.includes('const MAX_DRAG_TEXT_CHARS = 500') &&
    unifiedReadingPageSource.includes('if (rawText.length > MAX_DRAG_PAYLOAD_CHARS)') &&
    unifiedReadingPageSource.includes('function cleanDragText(value)') &&
    unifiedReadingPageSource.includes('const normalizedValue = cleanDragText(value)') &&
    unifiedReadingPageSource.includes('const fallback = cleanDragText(rawText)'),
    'unified reading drag/drop must bound external dataTransfer payloads before parsing or storing them'
);
assert(
    unifiedReadingPageSource.includes('document.querySelectorAll(`[name="${escapeSelector(alias)}"]`)') &&
    unifiedReadingPageSource.includes('document.querySelectorAll(`input[type="radio"][name="${escapeSelector(questionId)}"]`)') &&
    !unifiedReadingPageSource.includes('document.querySelectorAll(`[name="${alias}"]`)') &&
    !unifiedReadingPageSource.includes('document.querySelectorAll(`input[type="radio"][name="${questionId}"]`)'),
    'unified reading answer collection must escape dynamic question aliases before using them in selectors'
);
assert(
    unifiedReadingPageSource.includes('function isAllowedIncomingMessageSource') &&
    unifiedReadingPageSource.includes('const candidates = [state.parentWindow, global.opener, global.parent]') &&
    unifiedReadingPageSource.includes('if (!isAllowedIncomingMessageSource(event))') &&
    unifiedReadingPageSource.includes('source === candidate'),
    'unified reading postMessage control flow must reject messages from untrusted windows'
);

const examPlaceholderSource = fs.readFileSync(path.join(repoRoot, 'templates/exam-placeholder.html'), 'utf8');
assert(
    examPlaceholderSource.includes('const nextUrl = resolveTrustedSuiteNavigationUrl(data.url || \'\')') &&
    !examPlaceholderSource.includes('const nextUrl = data.url || \'\''),
    'exam placeholder suite navigation must resolve postMessage URLs before assigning location.href'
);

const listeningRecordBridgeSource = fs.readFileSync(path.join(repoRoot, 'js/listeningRecordBridge.js'), 'utf8');
assert(
    listeningRecordBridgeSource.includes('function cssAttr') &&
    listeningRecordBridgeSource.includes('replace(/[\\u0000-\\u001F\\u007F"\\\\]/g') &&
    listeningRecordBridgeSource.includes("return '\\\\' + char.charCodeAt(0).toString(16) + ' ';"),
    'listening record bridge selector fallback must escape control characters as CSS code points'
);

console.log(JSON.stringify({
    status: 'pass',
    detail: 'suite navigation URL guard tests passed'
}, null, 2));
