#!/usr/bin/env node
import assert from 'assert';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);
const core = require(path.join(repoRoot, 'js/utils/answerMatchCore.js'));

function run() {
    assert.strictEqual(
        core.normalizeToken('a panoramic camera'),
        'a panoramic camera',
        'lowercase article phrase must not collapse to option letter'
    );
    assert.strictEqual(
        core.normalizeToken('A. panoramic camera'),
        'A',
        'explicit option label with punctuation should still normalize to the letter'
    );
    assert.strictEqual(
        core.compareAnswers('panoramic camera', ['a panoramic camera', 'panoramic camera']),
        true,
        'accepted-answer arrays should still accept textual alternates'
    );
    assert.strictEqual(
        core.compareAnswers('A', ['a panoramic camera', 'panoramic camera']),
        false,
        'single option letter must not falsely match a textual accepted answer'
    );

    process.stdout.write(JSON.stringify({
        status: 'pass',
        detail: 'answerMatchCore accepted-answer regression checks passed'
    }));
}

try {
    run();
} catch (error) {
    const detail = error && error.stack ? error.stack : String(error);
    process.stdout.write(JSON.stringify({ status: 'fail', detail }));
    process.exit(1);
}
