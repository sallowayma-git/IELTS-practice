#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';
import { test } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

test('postMessage origin guard tests pass', () => {
const files = [
    'js/core/practiceRecorder.js',
    'js/presentation/app-actions.js',
    'js/plugins/themes/theme-adapter-base.js',
    'js/runtime/unifiedReadingPage.js',
    'js/practice-page-enhancer.js',
    'js/listeningRecordBridge.js',
    'js/app/examSessionMixin.js',
    'js/main.js',
    'js/plugins/hp/hp-core-bridge.js',
    'js/components/SystemDiagnostics.js',
    'js/services/libraryDiscovery.js'
];

for (const relativePath of files) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    const allowsSandboxedListening = relativePath === 'js/app/examSessionMixin.js'
        && source.includes('allowSandboxedListeningOrigin')
        && source.includes('windowInfo.allowOpaqueOrigin')
        && source.includes("src === 'listening_record_bridge'")
        && source.includes('sourceWindow === expectedWindow');
    const allowsBoundedOpaqueSession = (
        relativePath === 'js/core/practiceRecorder.js'
        && source.includes('isAllowedOpaqueActiveSessionMessage')
        && source.includes('event.source === expectedWindow')
    ) || (
        relativePath === 'js/main.js'
        && source.includes('allowOpaqueFallbackMessage')
        && source.includes('matchedWindow')
        && source.includes('findFallbackSessionByWindow(event.source)')
    ) || (
        relativePath === 'js/plugins/themes/theme-adapter-base.js'
        && source.includes('_isKnownOpaqueSessionWindow')
        && source.includes('event.source === session.window')
    ) || (
        relativePath === 'js/plugins/hp/hp-core-bridge.js'
        && source.includes('isOpaqueOriginMessage')
        && source.includes('session.win === event.source')
    );
    assert(
        !/event\.origin\s*={2,3}\s*['"]null['"][\s\S]{0,120}return\s+true/.test(source),
        `${relativePath} must not accept null postMessage origins unconditionally`
    );
    assert(
        !/!event\.origin\s*\|\|\s*event\.origin\s*={2,3}\s*['"]null['"][\s\S]{0,120}return\s+true/.test(source),
        `${relativePath} must not accept missing/null postMessage origins unconditionally`
    );
    if (source.includes("event.origin === 'null'") || source.includes('event.origin === "null"')) {
        assert(
            source.includes("protocol === 'file:'")
                || source.includes('protocol === "file:"')
                || allowsSandboxedListening
                || allowsBoundedOpaqueSession,
            `${relativePath} must limit null postMessage origins to file:// compatibility or the bounded sandboxed Listening bridge exception`
        );
    }
    if (relativePath === 'js/app/examSessionMixin.js') {
        assert(
            source.includes('allowSandboxedListeningOrigin')
                && source.includes('sourceWindow === expectedWindow')
                && source.includes('getMessageTargetOrigin(windowInfo)'),
            `${relativePath} must keep sandboxed Listening postMessage handling bound to the expected window and wildcard target only for marked sessions`
        );
        assert(
            source.includes('var parentWindow = window.opener || (window.parent && window.parent !== window ? window.parent : null);')
                && source.includes('function isAllowedIncomingMessageSource(event)')
                && source.includes('event.source === parentWindow')
                && source.includes('if (!isAllowedIncomingMessageSource(event))'),
            `${relativePath} inline fallback collector must bind incoming postMessage events to the expected parent window`
        );
    }
    if (relativePath === 'js/listeningRecordBridge.js') {
        assert(
            source.includes('getTrustedParentOrigin')
                && source.includes('document.referrer')
                && source.includes('event.source !== expected'),
            `${relativePath} must validate sandboxed parent messages against the parent window and referrer origin`
        );
    }
    if (relativePath === 'js/services/libraryDiscovery.js') {
        assert(
            source.includes("var targetOrigin = (location.origin && location.origin !== 'null' && /^https?:\\\\/\\\\//i.test(location.origin)) ? location.origin : '*'")
                && source.includes('var allowedFromFrame = {')
                && source.includes('var allowedFromParent = {')
                && source.includes('if (frame && event.source === frame.contentWindow)')
                && source.includes('if (!allowedFromFrame[type]) return;')
                && source.includes('if (sameOriginParent(event) && allowedFromParent[type] && frame && frame.contentWindow)')
                && source.includes("return location.protocol === 'file:';")
                && source.includes('window.opener.postMessage(event.data, targetOrigin)')
                && source.includes("frame.contentWindow.postMessage(event.data, '*')"),
            `${relativePath} sandbox runtime must allowlist message types, validate parent origin, and only use wildcard for opaque sandbox targets`
        );
    }
    if (relativePath === 'js/main.js') {
        assert(
            source.includes('findFallbackSessionBySessionId')
                && source.includes('rec.win && rec.win !== sourceWindow')
                && source.includes('const matched = matchedBySession || matchedByWindow'),
            `${relativePath} must bind fallback completion sessionId matches to the registered child window`
        );
    }
}

for (const relativePath of ['js/app/examSessionMixin.js', 'js/bundles/browse.bundle.js']) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    assert(
        !source.includes('isLikelySameWindowContext')
            && !source.includes('resolveWindowName')
            && !source.includes('sourceHref')
            && !source.includes('expectedHref'),
        `${relativePath} must not use window.name or readable location.href as postMessage source identity`
    );
    assert(
        !/windowInfo\.window\s*=\s*sourceWindow/.test(source)
            && !source.includes('ensureExamWindowSession(examId, sourceWindow)'),
        `${relativePath} must not replace the expected practice window from a postMessage sender`
    );
    assert(
        source.includes('const sourceIsExpectedWindow = sourceWindow === expectedWindow;')
            && source.includes('if (!sourceIsExpectedWindow)')
            && source.includes('sessionBoundMessageTypes')
            && source.includes('carriesExpectedSessionToken')
            && source.includes('channelNonce: info.expectedSessionId')
            && source.includes('sessionToken: info.expectedSessionId'),
        `${relativePath} must require exact source plus the per-window session token for trusted practice messages`
    );
}

function assertNoUnsafeWildcardPostMessage(relativePath, source) {
    for (const match of source.matchAll(/postMessage\s*\([\s\S]{0,400}?,\s*['"]\*['"]/g)) {
        const snippet = match[0];
        const allowedSandboxForward = snippet.includes('frame.contentWindow.postMessage(event.data');
        assert(
            allowedSandboxForward,
            `${relativePath} must not use wildcard postMessage target outside the sandbox frame bridge`
        );
    }
    source.split(/\r?\n/).forEach((line, index) => {
        const hasWildcardTarget = /postMessage\s*\([^;]*(?:'[^']*'|"[^"]*")\s*,\s*['"]\*['"]/.test(line);
        if (!hasWildcardTarget) {
            return;
        }
        const allowedSandboxForward = line.includes("frame.contentWindow.postMessage(event.data, '*')")
            || line.includes('frame.contentWindow.postMessage(event.data, "*")');
        assert(
            allowedSandboxForward,
            `${relativePath}:${index + 1} must not use wildcard postMessage target outside the sandbox frame bridge`
        );
    });
}

const vipBundleRoot = path.join(repoRoot, 'ListeningPractice', 'vip special', 'js', 'bundles');
if (fs.existsSync(vipBundleRoot)) {
    for (const filename of fs.readdirSync(vipBundleRoot)) {
        if (!filename.endsWith('.js')) {
            continue;
        }
        const relativePath = path.join('ListeningPractice', 'vip special', 'js', 'bundles', filename);
        const source = fs.readFileSync(path.join(vipBundleRoot, filename), 'utf8');
        assertNoUnsafeWildcardPostMessage(relativePath, source);
        assert(
            !source.includes('isLikelySameWindowContext')
                && !source.includes('resolveWindowName')
                && !source.includes('sourceHref')
                && !source.includes('expectedHref')
                && !/windowInfo\.window\s*=\s*sourceWindow/.test(source),
            `${relativePath} must not use stale window source rebinding or name/href identity fallback`
        );
        if (filename === 'browse.bundle.js') {
            assert(
                source.includes('const sourceIsExpectedWindow = sourceWindow === expectedWindow;')
                    && source.includes('sessionBoundMessageTypes')
                    && source.includes('carriesExpectedSessionToken')
                    && source.includes('channelNonce: info.expectedSessionId')
                    && source.includes('sessionToken: info.expectedSessionId'),
                `${relativePath} must contain the exact source and channel nonce practice-message guard`
            );
        }
    }
}

const templateBaseSource = fs.readFileSync(path.join(repoRoot, 'templates/template_base.html'), 'utf8');
assert(
    templateBaseSource.includes('isTrustedParentMessage: function (event)') &&
    templateBaseSource.includes('event.source !== this.parentWindow') &&
    templateBaseSource.includes('event.origin !== window.location.origin') &&
    templateBaseSource.includes("return window.location.protocol === 'file:'") &&
    templateBaseSource.includes('this.parentWindow.postMessage({') &&
    templateBaseSource.includes('}, this.getTargetOrigin());') &&
    !templateBaseSource.includes("}, '*');"),
    'template_base inline fallback enhancer must validate parent postMessage origin and avoid wildcard targetOrigin on HTTP(S)'
);

const examPlaceholderSource = fs.readFileSync(path.join(repoRoot, 'templates/exam-placeholder.html'), 'utf8');
assert(
    examPlaceholderSource.includes('function isTrustedIncomingMessage(event)') &&
    examPlaceholderSource.includes('event.source !== opener') &&
    examPlaceholderSource.includes('event.origin !== window.location.origin') &&
    examPlaceholderSource.includes("return window.location.protocol === 'file:'") &&
    examPlaceholderSource.includes('opener.postMessage(buildEnvelope(type, payload), getMessageTargetOrigin())') &&
    examPlaceholderSource.includes('if (!isTrustedIncomingMessage(event))') &&
    !examPlaceholderSource.includes("opener.postMessage(buildEnvelope(type, payload), '*')"),
    'exam placeholder must validate parent postMessage origin and avoid wildcard targetOrigin on HTTP(S)'
);

const analysisFixtureSource = fs.readFileSync(path.join(repoRoot, 'templates/ci-practice-fixtures/analysis-of-fear.html'), 'utf8');
assert(
    analysisFixtureSource.includes('isTrustedParentMessage: function (event)') &&
    analysisFixtureSource.includes('event.source !== this.parentWindow') &&
    analysisFixtureSource.includes('event.origin !== window.location.origin') &&
    analysisFixtureSource.includes("return window.location.protocol === 'file:'") &&
    analysisFixtureSource.includes('this.parentWindow.postMessage(message, this.getTargetOrigin());') &&
    !analysisFixtureSource.includes("this.parentWindow.postMessage(message, '*');"),
    'analysis-of-fear fixture must validate parent postMessage origin and avoid wildcard targetOrigin on HTTP(S)'
);

});
