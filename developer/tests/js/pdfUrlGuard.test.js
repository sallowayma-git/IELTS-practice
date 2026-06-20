#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function loadPDFHandler(locationOverrides = {}) {
    const windowStub = {
        location: {
            href: 'http://127.0.0.1:3000/',
            origin: 'http://127.0.0.1:3000',
            protocol: 'http:',
            ...locationOverrides
        },
        screen: {
            availWidth: 1280,
            availHeight: 800
        },
        console: { log() {}, warn() {}, error() {}, info() {} }
    };
    const context = vm.createContext({
        window: windowStub,
        console: windowStub.console,
        URL,
        Date,
        Map,
        String,
        Math,
        Number,
        Object
    });
    const source = fs.readFileSync(path.join(repoRoot, 'js/components/PDFHandler.js'), 'utf8');
    vm.runInContext(source, context, { filename: 'js/components/PDFHandler.js' });
    return new windowStub.PDFHandler();
}

function testPDFHandlerRejectsUntrustedUrls() {
    const handler = loadPDFHandler();

    assert.equal(handler.isValidPDFPath('/assets/sample.pdf'), true);
    assert.equal(handler.resolvePDFPath('docs/sample.PDF?download=1'), 'http://127.0.0.1:3000/docs/sample.PDF?download=1');
    assert.equal(handler.isValidPDFPath('http://127.0.0.1:3000/assets/sample.pdf'), true);

    assert.equal(handler.isValidPDFPath('https://evil.example/sample.pdf'), false);
    assert.equal(handler.isValidPDFPath('javascript:alert(1).pdf'), false);
    assert.equal(handler.isValidPDFPath('data:application/pdf;base64,AAAA.pdf'), false);
    assert.equal(handler.isValidPDFPath('blob:http://127.0.0.1:3000/123.pdf'), false);
    assert.equal(handler.isValidPDFPath('../secret.pdf'), false);
    assert.equal(handler.isValidPDFPath('/assets/%2e%2e/secret.pdf'), false);
    assert.equal(handler.isValidPDFPath('assets/%2e%2e/secret.pdf'), false);
    assert.equal(handler.isValidPDFPath('/assets/sample.pdf\u0000'), false);
    assert.equal(handler.isValidPDFPath('/assets/%E0%A4%A.pdf'), false);
    assert.equal(handler.isValidPDFPath('/assets/sample.html'), false);
}

function testPDFHandlerAllowsFileOnlyInFileMode() {
    const httpHandler = loadPDFHandler();
    assert.equal(httpHandler.isValidPDFPath('file:///tmp/sample.pdf'), false);

    const fileHandler = loadPDFHandler({
        href: 'file:///tmp/index.html',
        origin: 'null',
        protocol: 'file:'
    });
    assert.equal(fileHandler.isValidPDFPath('file:///tmp/sample.pdf'), true);
}

function testPDFHandlerForcesNoOpenerWindowFeatures() {
    const handler = loadPDFHandler();
    const features = handler.prepareWindowOptions({
        noopener: 'no',
        noreferrer: 'no',
        width: 640
    });
    assert(features.includes('width=640'), 'custom harmless window dimensions should still apply');
    assert(features.includes('noopener=yes'), 'PDF windows must force noopener');
    assert(features.includes('noreferrer=yes'), 'PDF windows must force noreferrer');
    assert(!features.includes('noopener=no'), 'callers must not be able to disable noopener');
    assert(!features.includes('noreferrer=no'), 'callers must not be able to disable noreferrer');

    const injected = handler.prepareWindowOptions({
        evil: 'yes',
        toolbar: 'false',
        menubar: 'maybe',
        width: '640,noopener=no',
        height: 1200.6
    });
    assert(!injected.includes('evil='), 'unknown window features must be ignored');
    assert(!injected.includes('640,noopener=no'), 'numeric window features must not allow feature injection');
    assert(injected.includes('toolbar=no'), 'boolean-like window features should be normalized');
    assert(injected.includes('menubar=no'), 'invalid boolean window features should fall back safely');
    assert(injected.includes('height=1201'), 'numeric window features should be rounded');
    assert(injected.includes('noopener=yes'), 'injected options must still force noopener');
}

function testPDFHandlerWindowNamesAreBounded() {
    const handler = loadPDFHandler();
    const generated = handler.generateWindowName('Unsafe Title / With Symbols ' + 'a'.repeat(500));
    assert(generated.startsWith('pdf_'), 'window names should keep the expected prefix');
    assert(generated.length < 120, 'window names should be bounded even for long exam titles');
    assert(!generated.includes('/'), 'window names should strip unsafe separators');
}

testPDFHandlerRejectsUntrustedUrls();
testPDFHandlerAllowsFileOnlyInFileMode();
testPDFHandlerForcesNoOpenerWindowFeatures();
testPDFHandlerWindowNamesAreBounded();
console.log(JSON.stringify({
    status: 'pass',
    detail: 'PDF URL guard tests passed'
}, null, 2));
