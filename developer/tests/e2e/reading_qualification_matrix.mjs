import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { checkout } from './helpers/readingQualification.mjs';

assert.equal(process.platform, 'win32', 'The mandatory installed Chrome/Edge matrix must run on Windows');
const provenance = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const integrated = provenance.artifacts.integrated;
assert.ok(integrated?.directory, 'Regenerate provenance with an unpatched integrated artifact');
assert.equal(integrated.sourceRevision, provenance.integrated, 'The integrated artifact must match the recorded revision');
const section = process.env.READING_MATRIX_SECTION || 'all';
assert.ok(['all', 'baseline', 'compatibility'].includes(section));
const output = fs.mkdtempSync(path.join(checkout, 'developer/tests/e2e/reports/issue-296-matrix-'));
const browsers = { Chrome: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    Edge: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' };
const report = { generatedAt: new Date().toISOString(), section,
    artifacts: Object.fromEntries(Object.entries(provenance.artifacts).map(([name, { directory, ...item }]) => [name, item])),
    cases: [], runs: [], status: 'running' };
const persist = () => fs.writeFileSync(path.join(output, 'matrix.json'), JSON.stringify(report, null, 2) + '\n');
function run(script, label, browserName, mode, repetition = 1, options = {}) {
    const scriptPath = path.join(checkout, 'developer/tests/e2e', script);
    const basename = `${label}-${browserName.toLowerCase()}-${mode}-${repetition}`;
    const reportPath = path.join(output, basename + '.json');
    console.log(`RUN ${basename}`);
    const scriptSha256 = createHash('sha256').update(fs.readFileSync(scriptPath)).digest('hex');
    const child = spawnSync(process.execPath, [scriptPath], {
        cwd: checkout, timeout: 600000, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, READING_FREEZE_SCENARIOS: '', READING_RECOVERY_SCENARIOS: '',
            READING_FREEZE_EXPECT_BASELINE: '0', READING_QUALIFICATION_ROOT: integrated.directory,
            READING_QUALIFICATION_REVISION: provenance.integrated, READING_QUALIFICATION_SYNC: '0',
            PLAYWRIGHT_EXECUTABLE_PATH: browsers[browserName], READING_QUALIFICATION_BROWSER: browserName,
            READING_QUALIFICATION_MODE: mode, READING_QUALIFICATION_REPETITION: String(repetition),
            READING_QUALIFICATION_REPORT: reportPath, ...options }
    });
    fs.writeFileSync(path.join(output, basename + '.log'), (child.stdout || '') + (child.stderr || ''));
    const result = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : { status: 'failed', cases: [] };
    report.runs.push({ label, browserName, mode, repetition, status: result.status, exitCode: child.status,
        script, scriptSha256,
        report: path.basename(reportPath), browser: result.browser, buildId: result.buildId,
        failure: child.error?.message || result.failure });
    report.cases.push(...result.cases.map(item => ({ label, browserName, mode, repetition, ...item })));
    persist();
    assert.equal(child.status, 0, `${basename} failed; inspect ${path.join(output, basename + '.log')}`);
    assert.equal(result.status, 'passed');
    console.log(`PASS ${basename}: ${result.cases.length} cases`);
}
try {
    for (const [browser, executable] of Object.entries(browsers)) assert.ok(fs.existsSync(executable), `Installed ${browser} is required`);
    if (section !== 'compatibility') {
        for (const artifact of ['baseline', 'sync-baseline']) run('reading_submission_freeze.node.js', artifact, 'Chrome', 'file', 1, {
            READING_QUALIFICATION_ROOT: provenance.artifacts[artifact].directory,
            READING_QUALIFICATION_REVISION: provenance.artifacts[artifact].sourceRevision,
            READING_FREEZE_EXPECT_BASELINE: '1'
        });
        for (const browser of Object.keys(browsers)) for (const mode of ['file', 'http']) {
            run('reading_submission_freeze.node.js', 'integrated-submit', browser, mode);
            run('reading_recovery_qualification.node.js', 'integrated-recovery', browser, mode);
            for (const repetition of [2, 3]) {
                run('reading_submission_freeze.node.js', 'integrated-race', browser, mode, repetition, { READING_FREEZE_SCENARIOS: 'question-click' });
                run('reading_recovery_qualification.node.js', 'integrated-fixture', browser, mode, repetition, { READING_RECOVERY_SCENARIOS: 'persisted-fixture' });
            }
        }
    }
    if (section !== 'baseline') {
        for (const browser of Object.keys(browsers)) for (const sync of [false, true]) {
            const options = { READING_QUALIFICATION_ROOT: provenance.artifacts.compatibility.directory,
                READING_QUALIFICATION_SYNC: sync ? '1' : '0' };
            const mode = sync ? 'http' : 'file';
            run('reading_submission_freeze.node.js', `compatibility-${sync ? 'sync' : 'offline'}-submit`, browser, mode, 1,
                { ...options, READING_FREEZE_SCENARIOS: 'ordinary,control,question-click,delayed-checkpoint,unknown-ack,legacy-host-reload' });
            run('reading_recovery_qualification.node.js', `compatibility-${sync ? 'sync' : 'offline'}-recovery`, browser, mode, 1, options);
        }
    }
    report.status = 'passed';
} catch (error) { report.status = 'failed'; throw error; }
finally { persist(); console.log(`Matrix evidence: ${path.join(output, 'matrix.json')}`); }
