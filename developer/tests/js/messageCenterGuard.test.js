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

function assertExtendedUrlAttributes(source, label) {
    for (const attr of ['srcset', 'imagesrcset', 'ping', 'background']) {
        assert(source.includes(attr), `${label} must treat ${attr} as a guarded URL-bearing attribute`);
    }
    assert(
        source.includes("key === 'srcset' || key === 'imagesrcset'") &&
        source.includes("key === 'ping'"),
        `${label} must split multi-URL attributes before checking unsafe URL values`
    );
}

const messageCenterSource = readSource('js/presentation/message-center.js');
assert(
    messageCenterSource.includes('function normalizeMessageType') &&
    messageCenterSource.includes("['info', 'success', 'warning', 'error'].includes(value)") &&
    messageCenterSource.includes("const safeType = normalizeMessageType(type)") &&
    messageCenterSource.includes("note.className = 'message ' + safeType + ' message-entering'") &&
    messageCenterSource.includes('text.textContent = String(message || \'\')'),
    'message center must render message text safely and normalize toast type classes'
);
assert(
    !messageCenterSource.includes("note.className = 'message ' + (type || 'info') + ' message-entering'"),
    'message center must not interpolate raw toast type into className'
);

const bootFallbacksSource = readSource('js/boot-fallbacks.js');
assertExtendedUrlAttributes(bootFallbacksSource, 'boot fallback DOM helper');
assert(
    bootFallbacksSource.includes('normalizeFallbackMessageType') &&
    bootFallbacksSource.includes('var safeType = normalizeFallbackMessageType(type)') &&
    bootFallbacksSource.includes("note.className = 'message ' + safeType + ' message-entering'") &&
    bootFallbacksSource.includes("text.textContent = message || ''"),
    'fallback message renderer must normalize toast type classes and use textContent'
);
assert(
    !bootFallbacksSource.includes("note.className = 'message ' + (type || 'info') + ' message-entering'"),
    'fallback message renderer must not interpolate raw toast type into className'
);
assert(
    bootFallbacksSource.includes('function isFallbackUnsafeAttributeName') &&
    bootFallbacksSource.includes('function isFallbackUnsafeUrlAttribute') &&
    bootFallbacksSource.includes('function isFallbackUnsafeObjectKey') &&
    bootFallbacksSource.includes('isFallbackUnsafeAttributeName(key) || isFallbackUnsafeUrlAttribute(key, value, element.tagName)') &&
    bootFallbacksSource.includes('if (isFallbackUnsafeObjectKey(dataKey))'),
    'fallback DOM helper must skip unsafe attributes, URLs, and prototype-polluting dataset keys'
);
assert(
    bootFallbacksSource.includes("var safeStatus = ['info', 'success', 'empty', 'warning', 'error'].includes(report.status) ? report.status : 'info'") &&
    bootFallbacksSource.includes("container.className = 'library-loader-report library-loader-report--' + safeStatus") &&
    bootFallbacksSource.includes("var title = safeStatus === 'success'"),
    'fallback library import report must normalize status before using it in className'
);
assert(
    !bootFallbacksSource.includes("container.className = 'library-loader-report library-loader-report--' + (report.status || 'info')") &&
    !bootFallbacksSource.includes("var title = report.status === 'success'"),
    'fallback library import report must not interpolate raw status into className'
);

const dataPanelSource = readSource('js/components/dataManagementPanel.js');
assertExtendedUrlAttributes(dataPanelSource, 'data management panel DOM helper');
assert(
    dataPanelSource.includes('function normalizeMessageType') &&
    dataPanelSource.includes("['info', 'success', 'warning', 'error'].includes(value)") &&
    dataPanelSource.includes('const safeType = normalizeMessageType(type)') &&
    dataPanelSource.includes('className: `message-toast ${safeType}`') &&
    dataPanelSource.includes('className: `fas fa-${this.getMessageIcon(safeType)}`'),
    'data management panel toast renderer must normalize toast type classes'
);
assert(
    !dataPanelSource.includes('className: `message-toast ${type}`') &&
    !dataPanelSource.includes('className: `fas fa-${this.getMessageIcon(type)}`'),
    'data management panel must not use raw toast type for className or icon selection'
);

const vocabSwitcherSource = readSource('js/app/vocabListSwitcher.js');
assert(
    vocabSwitcherSource.includes('function normalizeToastType') &&
    vocabSwitcherSource.includes("const SAFE_TOAST_TYPES = new Set(['info', 'success', 'warning', 'error'])") &&
    vocabSwitcherSource.includes('const safeType = normalizeToastType(type)') &&
    vocabSwitcherSource.includes('window.Toast.show(message, safeType)') &&
    vocabSwitcherSource.includes('toast.className = `vocab-switcher-toast toast-${safeType}`'),
    'vocab list switcher fallback toast must normalize type before rendering'
);
assert(
    !vocabSwitcherSource.includes('window.Toast.show(message, type)') &&
    !vocabSwitcherSource.includes('toast.className = `vocab-switcher-toast toast-${type}`'),
    'vocab list switcher must not use raw toast type in Toast or className'
);

const authOverlaySource = readSource('js/data/authOverlay.js');
assert(
    authOverlaySource.includes('function normalizeTotpQrDataUrl') &&
    authOverlaySource.includes('^data:image\\/(?:png|gif|jpeg|webp);base64,') &&
    authOverlaySource.includes('setupQr.src = normalizeTotpQrDataUrl(setup.qrCodeDataUrl)') &&
    authOverlaySource.includes('qr.src = normalizeTotpQrDataUrl(setup.qrCodeDataUrl)'),
    'auth overlay must restrict TOTP QR images to base64 image data URLs'
);
assert(
    !authOverlaySource.includes("setupQr.src = setup.qrCodeDataUrl || ''") &&
    !authOverlaySource.includes("qr.src = setup.qrCodeDataUrl || ''"),
    'auth overlay must not assign raw TOTP QR URLs to image src'
);
assert(
    authOverlaySource.includes('let clearOverlaySensitiveFields = null') &&
    authOverlaySource.includes('clearOverlaySensitiveFields = function (options = {})') &&
    authOverlaySource.includes("setupQr.removeAttribute('src')") &&
    authOverlaySource.includes("setupSecret.textContent = ''") &&
    authOverlaySource.includes("recoveryList.textContent = ''") &&
    authOverlaySource.includes('pendingRecoveryUser = null') &&
    authOverlaySource.includes('clearOverlaySensitiveFields();\n            }\n            if (setOverlayMode)') &&
    authOverlaySource.includes('clearOverlaySensitiveFields();\n            }\n            overlay.hidden = true') &&
    authOverlaySource.includes("totpPanel.textContent = ''"),
    'auth overlay must clear hidden password, TOTP setup secret, QR data, and recovery codes when leaving auth surfaces'
);
assert(
    !authOverlaySource.includes('window.prompt(') &&
    authOverlaySource.includes("passwordInput.type = 'password'") &&
    authOverlaySource.includes('function renderTotpActionForm') &&
    authOverlaySource.includes('apiClient.disableTotp(password, token)'),
    'auth overlay must collect TOTP management credentials through masked inline fields, not window.prompt'
);

const appSource = readSource('js/app.js');
assertExtendedUrlAttributes(appSource, 'app fallback DOM helper');
assert(
    appSource.includes('function isAppUnsafeAttributeName') &&
    appSource.includes('function isAppUnsafeUrlAttribute') &&
    appSource.includes('function isAppUnsafeObjectKey') &&
    appSource.includes('function applySafeElementAttributes') &&
    appSource.includes('isAppUnsafeAttributeName(key) || isAppUnsafeUrlAttribute(key, value, element.tagName)') &&
    appSource.includes('!isAppUnsafeObjectKey(dataKey)') &&
    (appSource.match(/applySafeElementAttributes\(element, attrs\);/g) || []).length >= 2,
    'app fallback DOM helpers must share unsafe attribute, URL, and dataset key guards'
);
assert(
    !appSource.includes("if (attrs && typeof attrs === 'object')") &&
    !appSource.includes('Object.keys(value).forEach((dataKey) => {\n                                element.dataset[dataKey] = String(value[dataKey]);') &&
    !appSource.includes('element.setAttribute(key, value);\n                    });'),
    'app fallback DOM helpers must not keep the old unguarded attribute loops'
);

const legacyViewSource = readSource('js/views/legacyViewBundle.js');
assertExtendedUrlAttributes(legacyViewSource, 'legacy view DOM helper');
assert(
    legacyViewSource.includes('function isLegacyUnsafeAttributeName') &&
    legacyViewSource.includes('function isLegacyUnsafeUrlAttribute') &&
    legacyViewSource.includes('function isLegacyUnsafeObjectKey') &&
    legacyViewSource.includes('function applyLegacyElementAttributes') &&
    legacyViewSource.includes('isLegacyUnsafeAttributeName(key) || isLegacyUnsafeUrlAttribute(key, value, element.tagName)') &&
    legacyViewSource.includes('!isLegacyUnsafeObjectKey(dataKey)') &&
    (legacyViewSource.match(/applyLegacyElementAttributes\(element, attributes\);/g) || []).length >= 3,
    'legacy view helpers must share unsafe attribute, URL, and dataset key guards'
);
assert(
    !legacyViewSource.includes('Object.assign(element.style, value)') &&
    !legacyViewSource.includes('element.setAttribute(key, value === true ? \'\' : value);'),
    'legacy view helpers must not keep the old unguarded attribute loops'
);

console.log(JSON.stringify({
    status: 'pass',
    detail: 'message center guard tests passed'
}, null, 2));
