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

const examSessionMixinSource = readSource('js/app/examSessionMixin.js');
assert(
    examSessionMixinSource.includes("_sanitizeWindowName('exam', exam && exam.id)") &&
    examSessionMixinSource.includes("_sanitizeWindowName('practice', sessionData.sessionId)") &&
    examSessionMixinSource.includes("_sanitizeWindowName('pdf', exam && exam.id)"),
    'exam session windows must sanitize dynamic window names'
);
assert(
    examSessionMixinSource.includes('const finalUrl = this._ensureAbsoluteUrl(examUrl)') &&
    examSessionMixinSource.includes('const practiceUrl = this._ensureAbsoluteUrl(`templates/ielts-exam-template.html?${params.toString()}`)') &&
    examSessionMixinSource.includes('window.open(practiceUrl, windowName, \'width=1200,height=800\')') &&
    !examSessionMixinSource.includes('_detachWindowOpener'),
    'interactive exam windows must keep same-origin URL checks while preserving opener-based practice messaging'
);
assert(
    examSessionMixinSource.includes("'width=1000,height=800,scrollbars=yes,resizable=yes,status=yes,toolbar=yes,noopener,noreferrer'") &&
    examSessionMixinSource.includes('try { pdfWin.opener = null; } catch (_) { }'),
    'PDF windows opened by exam sessions must force noopener/noreferrer'
);

const themeAdapterSource = readSource('js/plugins/themes/theme-adapter-base.js');
const themeAdapterExamOpenClearsOpener = /window\.open\(trustedPath,\s*windowName,\s*windowFeatures\)[\s\S]{0,160}examWindow\.opener\s*=\s*null/.test(themeAdapterSource);
assert(
    themeAdapterSource.includes('function safeWindowName(prefix, value)') &&
    themeAdapterSource.includes("const windowName = safeWindowName('exam', options.windowName || exam.id)") &&
    themeAdapterSource.includes("safeWindowName('pdf', exam.id)"),
    'theme adapter windows must sanitize dynamic names'
);
assert(
    themeAdapterSource.includes("resolveTrustedResourceUrl(fullPath)") &&
    themeAdapterSource.includes("'width=1000,height=800,scrollbars=yes,resizable=yes,noopener,noreferrer'") &&
    !themeAdapterExamOpenClearsOpener,
    'theme adapter must trust-check resource URLs and force noopener for PDF windows'
);

const hpBridgeSource = readSource('js/plugins/hp/hp-core-bridge.js');
const hpExamOpenClearsOpener = /width=1200,height=800,scrollbars=yes,resizable=yes[\s\S]{0,180}win\.opener\s*=\s*null/.test(hpBridgeSource);
assert(
    hpBridgeSource.includes('function safeWindowName(prefix, value)') &&
    hpBridgeSource.includes("safeWindowName('exam', examId)") &&
    hpBridgeSource.includes("safeWindowName('pdf', examId)") &&
    hpBridgeSource.includes("resolveAttemptUrl(entry.path)") &&
    hpBridgeSource.includes("'width=1000,height=800,scrollbars=yes,resizable=yes,noopener,noreferrer'") &&
    !hpExamOpenClearsOpener,
    'HP bridge windows must sanitize names, trust-check URLs, and force noopener for PDF windows'
);

const appActionsSource = readSource('js/presentation/app-actions.js');
assert(
    appActionsSource.includes('url = resolveTrustedAppActionUrl(url)') &&
    appActionsSource.includes('window.open(url, ENDLESS_WINDOW_NAME);') &&
    !appActionsSource.includes('win.opener = null'),
    'endless practice windows must trust-check URLs while preserving opener-based practice messaging'
);

const systemDiagnosticsSource = readSource('js/components/SystemDiagnostics.js');
assert(
    systemDiagnosticsSource.includes('const trustedPath = resolveTrustedDiagnosticUrl(fullPath)') &&
    systemDiagnosticsSource.includes("'width=1000,height=700,scrollbars=yes,resizable=yes'") &&
    !systemDiagnosticsSource.includes('examWindow.opener = null'),
    'diagnostic test windows must trust-check URLs while preserving opener-based communication tests'
);

console.log(JSON.stringify({
    status: 'pass',
    detail: 'window.open guard tests passed'
}, null, 2));
