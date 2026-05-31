#!/usr/bin/env node
'use strict';

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

function loadScript(relativePath, context) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    vm.runInContext(source, context, { filename: relativePath });
}

function createContext() {
    const context = {
        console,
        window: null,
        globalThis: null,
        fetch() {
            throw new Error('dictionary service must not fetch');
        },
        XMLHttpRequest: function XMLHttpRequest() {
            throw new Error('dictionary service must not use XHR');
        }
    };
    context.window = context;
    context.globalThis = context;
    return vm.createContext(context);
}

function main() {
    const context = createContext();
    loadScript('assets/wordlists/ecdict_reading.bundle.js', context);
    loadScript('assets/wordlists/ielts_core.bundle.js', context);
    loadScript('js/core/dictionaryService.js', context);

    const service = context.DictionaryService;
    assert(service, 'DictionaryService should be registered');
    assert.strictEqual(typeof service.lookup, 'function');

    const emperor = service.lookup('emperor');
    assert.strictEqual(emperor.found, true);
    assert.strictEqual(emperor.source, 'ecdict');
    assert(/皇帝|君主/.test(emperor.zh), 'emperor should include Chinese meaning');

    const hygienic = service.lookup('hygienic');
    assert.strictEqual(hygienic.found, true);
    assert(/卫生/.test(hygienic.zh), 'hygienic should include Chinese meaning');

    const boiled = service.lookup('boiled');
    assert.strictEqual(boiled.found, true);
    assert(/煮|沸|滚/.test(boiled.zh), 'boiled should resolve locally');

    const phrase = service.lookup('far-sighted edicts');
    assert.strictEqual(phrase.found, true);
    assert(Array.isArray(phrase.parts), 'phrase should fall back to word parts');
    assert(phrase.parts.length >= 2, 'phrase should resolve multiple parts');

    const stats = service.stats();
    assert(stats.entries > 1000, 'dictionary should include a real local corpus');

    const runtimeSource = fs.readFileSync(path.join(repoRoot, 'js/core/dictionaryService.js'), 'utf8');
    assert(!/\bfetch\s*\(/.test(runtimeSource), 'dictionary service must not fetch at runtime');
    assert(!/XMLHttpRequest/.test(runtimeSource), 'dictionary service must not use XHR at runtime');

    process.stdout.write(JSON.stringify({
        status: 'pass',
        detail: {
            entries: stats.entries,
            variants: stats.variants,
            checkedTerms: ['emperor', 'hygienic', 'boiled', 'far-sighted edicts']
        }
    }));
}

try {
    main();
} catch (error) {
    process.stdout.write(JSON.stringify({
        status: 'fail',
        detail: error && error.stack ? error.stack : String(error)
    }));
    process.exitCode = 1;
}
