#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function read(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const guardedFiles = [
    'js/app/examSessionMixin.js',
    'js/app/suitePracticeMixin.js',
    'js/components/DataIntegrityManager.js',
    'js/core/goalManager.js',
    'js/core/practiceCore.js',
    'js/core/practiceRecorder.js',
    'js/core/scoreStorage.js',
    'js/data/repositories/backupRepository.js',
    'js/data/repositories/practiceRepository.js',
    'js/services/libraryManager.js',
    'js/utils/dataBackupManager.js',
    'js/utils/suiteBackGuard.js'
];

for (const file of guardedFiles) {
    const source = read(file);
    assert(
        source.includes('randomUUID') || source.includes('getRandomValues'),
        `${file} should use Web Crypto for generated identifiers`
    );
    assert(
        !/Math\.random\(\)\.toString/.test(source),
        `${file} must not use Math.random().toString() for generated identifiers`
    );
}

console.log(JSON.stringify({
    status: 'pass',
    detail: 'secure identifier guard tests passed'
}, null, 2));
