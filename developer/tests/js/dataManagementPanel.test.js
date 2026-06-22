#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const panelSource = fs.readFileSync(path.join(repoRoot, 'js/components/dataManagementPanel.js'), 'utf8');

function createPanelHarness({ missingControls = false, importFile = null } = {}) {
    const selectedFileName = { textContent: '' };
    const importButton = { disabled: true };
    const importInput = importFile
        ? { files: [importFile], value: importFile.name }
        : null;
    const documentStub = {
        getElementById(id) {
            if (missingControls) {
                return null;
            }
            if (id === 'selectedFileName') {
                return selectedFileName;
            }
            if (id === 'importFile') {
                return importInput;
            }
            return null;
        },
        querySelector(selector) {
            if (missingControls) {
                return null;
            }
            return selector === '[data-action="import"]' ? importButton : null;
        },
        createElement() {
            return {};
        }
    };
    const context = vm.createContext({
        window: {},
        document: documentStub,
        console: { log() {}, warn() {}, error() {}, info() {} },
        setTimeout,
        clearTimeout,
        Blob,
        URL,
        String,
        Number,
        Object,
        Array,
        Set,
        JSON
    });
    vm.runInContext(panelSource, context, { filename: 'js/components/dataManagementPanel.js' });

    const pendingReads = new Map();
    const messages = [];
    const panel = Object.create(context.window.DataManagementPanel.prototype);
    panel.selectedFileContent = null;
    panel.fileReadToken = 0;
    panel.showMessage = (message, type) => {
        messages.push({ message, type });
    };
    panel.loadDataStats = async () => {};
    panel.loadHistory = async () => {};
    panel.backupManager = {
        async importPracticeData() {
            return { success: true, importedCount: 1, skippedCount: 0 };
        }
    };
    panel.readFile = (file) => new Promise((resolve, reject) => {
        pendingReads.set(file.name, { resolve, reject });
    });

    const makeFile = (name) => ({ name, size: 32, type: 'application/json' });
    const makeEvent = (file) => ({
        target: {
            files: [file],
            value: file.name
        }
    });

    return {
        panel,
        pendingReads,
        selectedFileName,
        importButton,
        messages,
        makeFile,
        makeEvent
    };
}

async function flushPromises() {
    await Promise.resolve();
    await Promise.resolve();
}

{
    const harness = createPanelHarness();
    const oldFile = harness.makeFile('old.json');
    const nextFile = harness.makeFile('next.json');

    harness.panel.handleFileSelect(harness.makeEvent(oldFile));
    harness.panel.handleFileSelect(harness.makeEvent(nextFile));

    harness.pendingReads.get('next.json').resolve('{"id":"next"}');
    await flushPromises();
    assert.deepEqual(harness.panel.selectedFileContent, { id: 'next' });

    harness.pendingReads.get('old.json').resolve('{"id":"old"}');
    await flushPromises();
    assert.deepEqual(harness.panel.selectedFileContent, { id: 'next' });
}

{
    const harness = createPanelHarness();
    const oldFile = harness.makeFile('stale.json');
    const nextFile = harness.makeFile('current.json');

    harness.panel.handleFileSelect(harness.makeEvent(oldFile));
    harness.panel.handleFileSelect(harness.makeEvent(nextFile));

    harness.pendingReads.get('current.json').resolve('{"id":"current"}');
    await flushPromises();
    harness.pendingReads.get('stale.json').reject(new Error('stale read failed'));
    await flushPromises();

    assert.deepEqual(harness.panel.selectedFileContent, { id: 'current' });
    assert.equal(harness.selectedFileName.textContent, 'current.json');
    assert.equal(harness.importButton.disabled, false);
}

{
    const harness = createPanelHarness({ missingControls: true });

    assert.doesNotThrow(() => harness.panel.handleFileSelect({
        target: {
            files: [],
            value: ''
        }
    }));
    assert.equal(harness.panel.selectedFileContent, null);

    assert.doesNotThrow(() => harness.panel.showProgress('loading'));
    assert.doesNotThrow(() => harness.panel.updateProgress('still loading'));
    assert.doesNotThrow(() => harness.panel.hideProgress());
}

{
    const harness = createPanelHarness();
    const file = harness.makeFile('oversized.json');

    harness.panel.handleFileSelect(harness.makeEvent(file));
    harness.pendingReads.get('oversized.json').resolve('x'.repeat(10 * 1024 * 1024 + 1));
    await flushPromises();

    assert.equal(harness.panel.selectedFileContent, null);
    assert.equal(harness.importButton.disabled, true);
    assert.equal(harness.messages.at(-1)?.type, 'error');
}

{
    const harness = createPanelHarness({ missingControls: true });
    harness.panel.selectedFileContent = { practiceRecords: [{ id: 'cached' }] };
    await harness.panel.handleImport('merge');
    assert.equal(harness.panel.selectedFileContent, null);
}

{
    const file = { name: 'null.json', size: 4, type: 'application/json' };
    const harness = createPanelHarness({ importFile: file });
    let importedPayload = Symbol('unset');
    harness.panel.backupManager = {
        async importPracticeData(payload) {
            importedPayload = payload;
            return { success: true, importedCount: 0, skippedCount: 0 };
        }
    };
    harness.panel.readFile = async () => 'null';

    await harness.panel.handleImport('merge');
    assert.equal(importedPayload, null);
}

{
    const file = { name: 'small-size.json', size: 4, type: 'application/json' };
    const harness = createPanelHarness({ importFile: file });
    let importCalled = false;
    harness.panel.backupManager = {
        async importPracticeData() {
            importCalled = true;
            return { success: true, importedCount: 0, skippedCount: 0 };
        }
    };
    harness.panel.readFile = async () => 'x'.repeat(10 * 1024 * 1024 + 1);

    await harness.panel.handleImport('merge');
    assert.equal(importCalled, false);
    assert.equal(harness.messages.at(-1)?.type, 'error');
}

assert(
    panelSource.includes('function dataManagementDebugLog') &&
    panelSource.includes('window.__IELTS_DEBUG_IMPORTS__ === true') &&
    !panelSource.includes("console.log('[DataManagementPanel] handleFileSelect called") &&
    !panelSource.includes("console.log('[DataManagementPanel] JSON parsed") &&
    !panelSource.includes("console.log('[DataManagementPanel] importPracticeData returned"),
    'data management panel must gate import diagnostics behind an explicit debug flag'
);

console.log(JSON.stringify({
    status: 'pass',
    detail: 'data management panel stale file read guard tests passed'
}, null, 2));
