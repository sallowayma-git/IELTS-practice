import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

test('IELTS core phonetic assets are deterministic, covered, and within budget', () => {
    const output = execFileSync(process.execPath, [
        path.join(repoRoot, 'scripts', 'build-ielts-core-phonetics.mjs'),
        '--check'
    ], {
        cwd: repoRoot,
        encoding: 'utf8'
    });

    assert.match(output, /3536\/3610 rows, 3535\/3609 unique headwords/);
    assert.match(output, /IELTS core phonetic assets are current/);
});
