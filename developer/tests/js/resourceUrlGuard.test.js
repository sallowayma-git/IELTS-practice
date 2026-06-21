#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function readSource(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const examSessionMixin = readSource('js/app/examSessionMixin.js');
assert(
    examSessionMixin.includes("resolved.origin === currentOrigin"),
    'exam session resource URLs must be restricted to same-origin HTTP(S)'
);
assert(
    examSessionMixin.includes("protocol === 'file:'") &&
    examSessionMixin.includes("window.location.protocol === 'file:'"),
    'exam session resource URLs must only allow file: while running from file:'
);
assert(
    !examSessionMixin.includes("protocol === 'blob:'"),
    'exam session resources must not allow blob: URLs'
);
assert(
    examSessionMixin.includes('Exam URL is invalid or untrusted') &&
    examSessionMixin.includes('PDF URL is invalid or untrusted') &&
    examSessionMixin.includes('Practice URL is invalid or untrusted'),
    'exam session window-open paths must fail closed on untrusted URLs'
);
assert(
    examSessionMixin.includes('new URLSearchParams()') &&
    examSessionMixin.includes("params.set('examId', String(examId || ''))"),
    'fallback practice URLs must encode examId instead of interpolating it directly'
);
assert(
    examSessionMixin.includes("window.open(resolvedPdfUrl, '_blank', 'noopener,noreferrer')") &&
    examSessionMixin.includes('status=yes,toolbar=yes,noopener,noreferrer') &&
    examSessionMixin.includes('pdfWin.opener = null'),
    'exam session PDF windows must not retain access to window.opener'
);
assert(
    examSessionMixin.includes('const allowSuiteSourceFallback = Boolean(') &&
    examSessionMixin.includes('&& payloadSuiteSessionId') &&
    examSessionMixin.includes('&& activeSuiteSessionId') &&
    examSessionMixin.includes('&& payloadSuiteSessionId === activeSuiteSessionId') &&
    !examSessionMixin.includes('|| isExamInActiveSuite\n                    )'),
    'suite postMessage fallback must require the current suiteSessionId instead of accepting examId-only messages from unknown same-origin windows'
);

const mainSource = readSource('js/main.js');
assert(
    mainSource.includes('status=yes,toolbar=yes,noopener,noreferrer') &&
    mainSource.includes('pdfWindow.opener = null'),
    'main PDF fallback windows must not retain access to window.opener'
);

const resourceCore = readSource('js/core/resourceCore.js');
assert(
    resourceCore.includes('function resolveTrustedProbeUrl') &&
    resourceCore.includes('resolved.origin === currentOrigin') &&
    resourceCore.includes("protocol === 'blob:'"),
    'resource core probes must restrict HTTP(S) and blob URLs to the current origin'
);
assert(
    resourceCore.includes('const trustedUrl = resolveTrustedProbeUrl(url)') &&
    resourceCore.includes("await fetch(trustedUrl, { method: 'HEAD', cache: 'no-store' })") &&
    !resourceCore.includes("await fetch(url, { method: 'HEAD', cache: 'no-store' })"),
    'resource core must not probe raw imported resource URLs'
);

const storageSource = readSource('js/utils/storage.js');
assert(
    storageSource.includes('const backupUrl = new URL(backupPath, baseHref)') &&
    storageSource.includes('backupUrl.origin !== currentOrigin') &&
    storageSource.includes("fetch(backupUrl.href, { credentials: 'same-origin', cache: 'no-store' })") &&
    !storageSource.includes('fetch(backupPath)'),
    'storage backup restore must resolve the fixed backup path against the current origin before fetching'
);

const themeAdapterBase = readSource('js/plugins/themes/theme-adapter-base.js');
assert(
    themeAdapterBase.includes('function resolveTrustedResourceUrl') &&
    themeAdapterBase.includes('resolved.origin === origin'),
    'theme adapter must resolve resource URLs through a same-origin guard'
);
assert(
    !themeAdapterBase.includes('window.open(fullPath') &&
    !themeAdapterBase.includes('openPDFSafely(fullPath'),
    'theme adapter must not open raw resource paths directly'
);
assert(
    themeAdapterBase.includes('window.open(trustedPath') &&
    themeAdapterBase.includes('openPDFSafely(trustedPath'),
    'theme adapter must open only trusted resource URLs'
);
assert(
    themeAdapterBase.includes('scrollbars=yes,resizable=yes,noopener,noreferrer') &&
    themeAdapterBase.includes('pdfWindow.opener = null'),
    'theme adapter PDF fallback windows must be opened without window.opener'
);

const hpCoreBridge = readSource('js/plugins/hp/hp-core-bridge.js');
assert(
    hpCoreBridge.includes('function resolveAttemptUrl') &&
    hpCoreBridge.includes('resolved.origin === origin'),
    'HP bridge attempt URLs must be restricted to same-origin HTTP(S)'
);
assert(
    hpCoreBridge.includes('const trustedUrl = resolveAttemptUrl(url)') &&
    hpCoreBridge.includes("fetch(trustedUrl, { method: 'HEAD', cache: 'no-store' })") &&
    hpCoreBridge.includes("fetch(trustedUrl, { method: 'GET', cache: 'no-store', mode: 'no-cors' })") &&
    !hpCoreBridge.includes("fetch(url, { method: 'HEAD', cache: 'no-store' })") &&
    !hpCoreBridge.includes("fetch(url, { method: 'GET', cache: 'no-store', mode: 'no-cors' })"),
    'HP bridge resource probes must validate URLs internally before fetch'
);
assert(
    !hpCoreBridge.includes('if (isAbsolutePath(path)) return path;') &&
    !hpCoreBridge.includes('return path;'),
    'HP bridge must not return absolute or unparsable resource paths unchanged'
);
assert(
    !hpCoreBridge.includes('probeResource(entry.path)'),
    'HP bridge must probe only trusted resolved URLs'
);
assert(
    hpCoreBridge.includes('if (!resolvedUrl)') &&
    hpCoreBridge.includes('tryOpen(index + 1);'),
    'HP bridge must skip untrusted attempt URLs before opening windows'
);
assert(
    hpCoreBridge.includes('scrollbars=yes,resizable=yes,noopener,noreferrer') &&
    hpCoreBridge.includes('win.opener = null'),
    'HP bridge PDF fallback windows must be opened without window.opener'
);

const systemDiagnostics = readSource('js/components/SystemDiagnostics.js');
assert(
    systemDiagnostics.includes('function resolveTrustedDiagnosticUrl') &&
    systemDiagnostics.includes('resolved.origin === origin'),
    'system diagnostics must validate exam URLs before opening diagnostic windows'
);
assert(
    !systemDiagnostics.includes('window.open(fullPath') &&
    systemDiagnostics.includes('window.open(trustedPath'),
    'system diagnostics must not open raw exam paths directly'
);
assert(
    systemDiagnostics.includes('const trustedPath = resolveTrustedDiagnosticUrl(fullPath)') &&
    systemDiagnostics.includes('await fetch(trustedPath, { method: \'HEAD\' })') &&
    systemDiagnostics.includes('Exam URL is invalid or untrusted'),
    'system diagnostics must validate exam URLs before probing files with fetch'
);
assert(
    !systemDiagnostics.includes('await fetch(fullPath'),
    'system diagnostics must not fetch raw exam paths directly'
);
assert(
    systemDiagnostics.includes('function escapeDiagnosticHtml') &&
    systemDiagnostics.includes('normalizeDiagnosticClassSuffix') &&
    systemDiagnostics.includes('escapeDiagnosticHtml(issue && issue.message)') &&
    systemDiagnostics.includes('escapeDiagnosticHtml(rec && rec.message)'),
    'system diagnostics reports must escape issue and recommendation messages'
);
assert(
    !systemDiagnostics.includes('${issue.message}</li>') &&
    !systemDiagnostics.includes('${rec.message}</li>') &&
    !systemDiagnostics.includes('issue-${issue.type}'),
    'system diagnostics reports must not interpolate raw issue content into HTML'
);
assert(
    systemDiagnostics.includes('diagnosticReport.issues = diagnosticReport.issues.concat(this.analyzeIssues(diagnosticReport))'),
    'system diagnostics must preserve validation errors captured before issue analysis'
);

const appActions = readSource('js/presentation/app-actions.js');
assert(
    appActions.includes('function resolveTrustedAppActionUrl') &&
    appActions.includes('resolved.origin === origin'),
    'presentation app actions must validate endless-mode exam URLs before opening windows'
);
assert(
    appActions.includes('url = resolveTrustedAppActionUrl(url);'),
    'presentation app actions must route endless-mode URLs through the trust guard'
);
assert(
    appActions.includes('function isAllowedEndlessMessageSource') &&
    appActions.includes('return event.source === currentWindow;') &&
    appActions.includes('if (!currentWindow || currentWindow.closed) return false;') &&
    !appActions.includes('if (!currentWindow || currentWindow.closed) return true;') &&
    appActions.includes('if (!isAllowedEndlessMessageSource(event)) return;'),
    'endless-mode postMessage handling must reject messages from non-current windows'
);

const practiceRecorder = readSource('js/core/practiceRecorder.js');
assert(
    practiceRecorder.includes('getExpectedExamMessageWindow') &&
    practiceRecorder.includes('event.source === expectedWindow') &&
    practiceRecorder.includes('isAllowedActiveSessionMessage(event, examId, sessionId)') &&
    !practiceRecorder.includes('candidateExamIds.some((examId) => this.activeSessions.has(examId))'),
    'practice recorder must bind active-session postMessage handling to the expected exam window or session id'
);

const hpPortal = readSource('js/plugins/hp/hp-portal.js');
assert(
    hpPortal.includes('function resolveTrustedPortalTarget') &&
    hpPortal.includes('resolved.origin === origin'),
    'HP portal must validate theme portal targets before navigation'
);
assert(
    hpPortal.includes('const trustedTarget = resolveTrustedPortalTarget(normalized);') &&
    !hpPortal.includes('window.location.href = normalized;'),
    'HP portal must not navigate directly to raw normalized targets'
);

const unifiedReadingPage = readSource('js/runtime/unifiedReadingPage.js');
assert(
    unifiedReadingPage.includes('function resolveTrustedReadingScriptUrl') &&
    unifiedReadingPage.includes('resolved.origin === origin'),
    'unified reading page must validate dynamic reading script URLs before loading'
);
assert(
    unifiedReadingPage.includes("path.toLowerCase().endsWith('.js')") &&
    unifiedReadingPage.includes("new URL('../reading-explanations/', baseHref).pathname"),
    'unified reading page dynamic script guard must restrict scripts to expected generated JS directories'
);
assert(
    unifiedReadingPage.includes('const safeUrl = resolveTrustedReadingScriptUrl(url);') &&
    unifiedReadingPage.includes('script.src = safeUrl') &&
    !unifiedReadingPage.includes('script.src = url'),
    'unified reading page must not assign raw manifest script URLs to script.src'
);
assert(
    unifiedReadingPage.includes("new Error('reading_exam_script_failed')") &&
    !unifiedReadingPage.includes('reading_exam_script_failed:${safeUrl}'),
    'unified reading page must not leak resolved script URLs through load failure errors'
);
assert(
    unifiedReadingPage.includes('function sanitizeReadingDatasetHtml') &&
    unifiedReadingPage.includes('UNSAFE_READING_HTML_TAGS') &&
    unifiedReadingPage.includes("'svg'") &&
    unifiedReadingPage.includes("'math'") &&
    unifiedReadingPage.includes("'style'") &&
    unifiedReadingPage.includes("key.startsWith('on') || key === 'srcdoc'") &&
    unifiedReadingPage.includes('READING_HTML_URL_ATTRIBUTES') &&
    unifiedReadingPage.includes("'srcset'") &&
    unifiedReadingPage.includes("'imagesrcset'") &&
    unifiedReadingPage.includes("'ping'") &&
    unifiedReadingPage.includes("'background'") &&
    unifiedReadingPage.includes('function getReadingHtmlUrlCandidates') &&
    unifiedReadingPage.includes("key === 'srcset' || key === 'imagesrcset'") &&
    unifiedReadingPage.includes("key === 'ping'") &&
    unifiedReadingPage.includes('function isTrustedReadingHtmlUrl') &&
    unifiedReadingPage.includes('resolved.origin === currentOrigin') &&
    unifiedReadingPage.includes('return !isTrustedReadingHtmlUrl(candidate);') &&
    unifiedReadingPage.includes('compact.startsWith(\'javascript:\')') &&
    unifiedReadingPage.includes('sanitizeReadingDatasetHtml(group.bodyHtml || \'\')') &&
    unifiedReadingPage.includes("sanitizeReadingDatasetHtml(block?.bodyHtml || block?.html || '')"),
    'unified reading page must sanitize generated passage and question HTML before inserting it'
);
assert(
    unifiedReadingPage.includes("isUnsafeReadingHtmlAttribute(name, value, '') ? '' : match") &&
    unifiedReadingPage.includes('foreignobject') &&
    unifiedReadingPage.includes('<(?:iframe|object|embed|svg|math|foreignobject|base|link|meta|style)'),
    'unified reading no-DOM sanitizer fallback must remove unsafe tags and attributes conservatively'
);
assert(
    !unifiedReadingPage.includes('${group.bodyHtml || \'\'}') &&
    !unifiedReadingPage.includes(".map((block) => block?.bodyHtml || block?.html || '')"),
    'unified reading page must not interpolate generated reading HTML directly'
);

const lazyLoader = readSource('js/runtime/lazyLoader.js');
assert(
    lazyLoader.includes('function resolveTrustedScriptUrl') &&
    lazyLoader.includes('resolved.origin === origin'),
    'lazy loader must validate dynamically registered script URLs before loading'
);
assert(
    lazyLoader.includes('var safeUrl = resolveTrustedScriptUrl(url);') &&
    lazyLoader.includes('script.src = safeUrl') &&
    !lazyLoader.includes('script.src = url;'),
    'lazy loader must not assign raw registered script URLs to script.src'
);

const practicePageEnhancer = readSource('js/practice-page-enhancer.js');
assert(
    practicePageEnhancer.includes('const resolveTrustedDependencyScriptUrl') &&
    practicePageEnhancer.includes('resolved.origin === origin'),
    'practice page enhancer must validate dependency script URLs before loading'
);
assert(
    practicePageEnhancer.includes('const safeUrl = resolveTrustedDependencyScriptUrl(url);') &&
    practicePageEnhancer.includes('script.src = safeUrl') &&
    !practicePageEnhancer.includes('script.src = url;'),
    'practice page enhancer must not assign raw dependency URLs to script.src'
);

const vocabStore = readSource('js/core/vocabStore.js');
assert(
    vocabStore.includes('function resolveTrustedVocabJsonUrl') &&
    vocabStore.includes("resolved.pathname.toLowerCase().endsWith('.json')") &&
    vocabStore.includes('resolved.origin === currentOrigin') &&
    vocabStore.includes("protocol === 'file:'") &&
    vocabStore.includes('const trustedUrl = resolveTrustedVocabJsonUrl(url)') &&
    vocabStore.includes("fetch(trustedUrl, { cache: 'no-store' })") &&
    vocabStore.includes("xhr.open('GET', trustedUrl, true)") &&
    !vocabStore.includes("fetch(url, { cache: 'no-store' })") &&
    !vocabStore.includes("xhr.open('GET', url, true)"),
    'vocab store bundled JSON loading must validate same-origin/file JSON URLs before fetch or XHR'
);

console.log(JSON.stringify({
    status: 'pass',
    detail: 'resource URL guard tests passed'
}, null, 2));
