#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const indexHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const indexSnapshot = fs.readFileSync(path.join(repoRoot, 'developer', 'tests', 'js', 'e2e', 'indexSnapshot.js'), 'utf8');
const scannedSources = `${indexHtml}\n${indexSnapshot}`;

assert(
    !scannedSources.includes('docs.qq.com'),
    'homepage and E2E snapshot must not include the removed third-party feedback link'
);
assert(
    !/xiaohongshu|小红书|小紅書|xhs/i.test(scannedSources),
    'homepage and E2E snapshot must not include removed Xiaohongshu links or labels'
);
assert(
    !indexHtml.includes('settings-footer__feedback'),
    'settings footer must not expose the removed feedback entry'
);
assert(
    indexHtml.includes('https://github.com/sallowayma-git/IELTS-practice'),
    'homepage must keep the GitHub repository link'
);

const externalLinks = Array.from(indexHtml.matchAll(/<a\b[\s\S]*?<\/a>/gi))
    .map((match) => match[0])
    .filter((link) => /href="https?:\/\//i.test(link));

assert(externalLinks.length > 0, 'homepage should still expose at least one external project link');
for (const link of externalLinks) {
    assert(/target="_blank"/i.test(link), 'external links should open in a separate context');
    assert(/rel="noopener noreferrer"/i.test(link), 'external links must not retain opener access');
}

console.log(JSON.stringify({
    status: 'pass',
    detail: 'external link guard tests passed'
}, null, 2));
