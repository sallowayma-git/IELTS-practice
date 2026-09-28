#!/usr/bin/env node
// Run against a disposable Compose project; never connect to an existing deployment.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const reportDir = path.join(repoRoot, 'developer/tests/e2e/reports/multi-device-deploy');
const cleanupOnly = process.argv[2] === '--cleanup';
assert.ok(process.argv.length === 2 || (cleanupOnly && process.argv.length === 3),
    'Usage: node backend/scripts/ci-smoke.mjs [--cleanup]');
assert.ok(!cleanupOnly || process.env.MD_SMOKE_STATE_DIR,
    'Set MD_SMOKE_STATE_DIR to the interrupted run\'s state directory before cleanup');
const stateDir = process.env.MD_SMOKE_STATE_DIR
    ? path.resolve(process.env.MD_SMOKE_STATE_DIR)
    : await fs.mkdtemp(path.join(os.tmpdir(), 'ielts-ci-'));
const statePath = path.join(stateDir, 'state.json');
const envPath = path.join(stateDir, 'smoke.env');

function compose(state, args, { capture = false, timeout = 180_000 } = {}) {
    assert.match(state.project, /^ielts-ci-[a-f0-9]{12}$/);
    return execFileSync('docker', [
        'compose', '--project-name', state.project, '--env-file', envPath,
        '-f', path.join(repoRoot, 'backend/docker-compose.yml'),
        '-f', path.join(repoRoot, 'backend/docker-compose.ci.yml'),
        ...args
    ], {
        cwd: repoRoot,
        // Explicit values prevent an existing shell configuration overriding the test.
        env: { ...process.env, ...state.environment },
        encoding: 'utf8',
        stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
        maxBuffer: 16 * 1024 * 1024,
        timeout
    })?.trim();
}

async function cleanup(state) {
    await fs.mkdir(reportDir, { recursive: true });
    for (const [filename, args] of [
        ['compose.log', ['logs', '--no-color', '--timestamps']],
        ['containers.json', ['ps', '--all', '--format', 'json']]
    ]) {
        try {
            const output = compose(state, args, { capture: true, timeout: 30_000 });
            await fs.writeFile(path.join(reportDir, filename), `${output}\n`);
        } catch (error) {
            console.error(`Could not collect ${filename}: ${error.message}`);
        }
    }
    // Leave the state files in place if teardown fails, so --cleanup can retry it.
    compose(state, ['--profile', 'onion', 'down', '--volumes', '--remove-orphans', '--timeout', '10'],
        { timeout: 60_000 });
    await fs.unlink(statePath);
    await fs.unlink(envPath);
}

function randomPassword() {
    for (;;) {
        const value = randomBytes(24).toString('base64url');
        if (/[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value)) return value;
    }
}

function applicationUrl(state) {
    const address = compose(state, ['port', 'app', '3000'], { capture: true });
    assert.match(address, /^127\.0\.0\.1:\d+$/);
    return `http://${address}`;
}

function client(getBaseUrl) {
    const cookies = new Map();
    return {
        async request(method, route, body, csrf, expectedStatus = 200) {
            const response = await fetch(`${getBaseUrl()}${route}`, {
                method,
                redirect: 'error',
                signal: AbortSignal.timeout(15_000),
                headers: {
                    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
                    ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
                    Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ')
                },
                body: body === undefined ? undefined : JSON.stringify(body)
            });
            for (const cookie of response.headers.getSetCookie()) {
                const pair = cookie.split(';', 1)[0];
                const separator = pair.indexOf('=');
                cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
            }
            assert.equal(response.status, expectedStatus, `${method} ${route}`);
            return response.json();
        },
        async authenticate(action, credentials) {
            const { csrfToken } = await this.request('GET', '/api/auth/csrf');
            return this.request('POST', `/api/auth/${action}`, credentials, csrfToken,
                action === 'register' ? 201 : 200);
        }
    };
}

async function waitForHealth(baseUrl) {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2_000) });
            if (response.ok && (await response.json()).ok === true) return;
        } catch {
            // The application can be temporarily unavailable while restarting.
        }
        await delay(500);
    }
    throw new Error('Application did not become healthy within 120 seconds');
}

async function smoke(state, pass) {
    compose(state, ['config', '--quiet']);
    compose(state, ['--profile', 'onion', 'config', '--quiet']);
    pass('Default and onion Compose profiles are valid');
    compose(state, ['--profile', 'onion', 'build', 'app', 'tor'], { timeout: 660_000 });
    pass('Application and optional Tor images build');
    compose(state, ['up', '--detach', '--wait', '--wait-timeout', '120', 'app']);
    let baseUrl = applicationUrl(state);
    await waitForHealth(baseUrl);
    pass('Application starts with PostgreSQL and automatic migrations');

    for (const resource of [
        'index.html', 'css/main.css', 'js/bundles/core-foundation.bundle.js',
        'assets/generated/reading-exams/reading-practice-unified.html',
        'templates/exam-placeholder.html'
    ]) {
        const response = await fetch(`${baseUrl}/${resource === 'index.html' ? '' : resource}`,
            { signal: AbortSignal.timeout(15_000) });
        assert.equal(response.status, 200, resource);
        assert.ok((await response.text()) === (await fs.readFile(path.join(repoRoot, resource), 'utf8')),
            `${resource} must match the checkout`);
    }
    pass('Container serves the current homepage and practice resources');

    const credentials = { username: `ci_${randomBytes(6).toString('hex')}`, password: randomPassword() };
    const first = client(() => baseUrl);
    const second = client(() => baseUrl);
    await second.request('GET', '/api/practice-records', undefined, undefined, 401);
    const registered = await first.authenticate('register', credentials);
    await first.request('PUT', '/api/practice-records', { records: [] }, undefined, 403);
    const { csrfToken: anonymousCsrf } = await second.request('GET', '/api/auth/csrf');
    await second.request('POST', '/api/auth/register', { ...credentials, username: 'ci_second_user' },
        anonymousCsrf, 403);
    pass('First-user registration, authentication, and CSRF requirements hold');

    const record = {
        id: 'ci-suite-record', sessionId: 'ci-suite-session', examId: 'ci-reading-suite',
        type: 'reading', mode: 'suite', title: 'CI reading suite',
        totalQuestions: 2, correctAnswers: 1, score: 50, accuracy: 0.5, duration: 120,
        completedAt: '2026-09-01T00:00:00.000Z',
        answers: { 1: 'A', 2: 'C' }, correctAnswerMap: { 1: 'A', 2: 'B' },
        answerComparison: { 1: { isCorrect: true }, 2: { isCorrect: false } },
        markedQuestions: ['2'], highlights: [{ text: 'Evidence', start: 0, end: 8 }],
        notes: { 2: 'Review this answer.' }, metadata: { libraryConfigurationId: 'ci-library' },
        suiteEntries: [{
            id: 'ci-child', sessionId: 'ci-child-session', examId: 'ci-reading-child',
            answers: { 1: 'A' }, notes: { 1: 'Child note.' }, markedQuestions: ['1'],
            highlights: [{ text: 'Child evidence', start: 0, end: 14 }]
        }]
    };
    const saved = await first.request('PUT', '/api/practice-records', { records: [record] }, registered.csrfToken);
    assert.deepEqual(saved.records, [record]);
    const loggedIn = await second.authenticate('login', credentials);
    assert.equal(loggedIn.user.id, registered.user.id);
    assert.deepEqual((await second.request('GET', '/api/practice-records')).records, [record]);
    record.notes['2'] = 'Updated on the second device.';
    record.suiteEntries[0].notes['1'] = 'Updated child note.';
    await second.request('PUT', '/api/practice-records', { records: [record] }, loggedIn.csrfToken);
    assert.deepEqual((await first.request('GET', '/api/practice-records')).records, [record]);
    pass('Independent device sessions preserve complete records and annotations');

    for (let attempt = 0; attempt < 2; attempt += 1) {
        const migration = JSON.parse(compose(state, ['exec', '-T', 'app', 'node', 'scripts/migrate.mjs'],
            { capture: true }));
        assert.equal(migration.status, 'ok');
        assert.deepEqual(migration.applied, []);
        assert.ok(migration.total > 0);
    }
    pass('Repeated migrations do not reapply existing schema changes');
    compose(state, ['restart', 'app']);
    // Docker can assign a different ephemeral host port when a container restarts.
    baseUrl = applicationUrl(state);
    await waitForHealth(baseUrl);
    for (const device of [first, second]) {
        assert.equal((await device.request('GET', '/api/auth/me')).user.id, registered.user.id);
        assert.deepEqual((await device.request('GET', '/api/practice-records')).records, [record]);
    }
    const third = client(() => baseUrl);
    assert.equal((await third.authenticate('login', credentials)).user.id, registered.user.id);
    assert.deepEqual((await third.request('GET', '/api/practice-records')).records, [record]);
    record.notes['2'] = 'Saved after application restart.';
    await second.request('PUT', '/api/practice-records', { records: [record] }, loggedIn.csrfToken);
    assert.deepEqual((await first.request('GET', '/api/practice-records')).records, [record]);
    pass('Accounts, both sessions, CSRF tokens, and records survive application restart');
}

async function main() {
    if (cleanupOnly) {
        let state;
        try {
            state = JSON.parse(await fs.readFile(statePath, 'utf8'));
        } catch (error) {
            if (error.code === 'ENOENT') return;
            throw error;
        }
        await cleanup(state);
        return;
    }

    await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });
    const state = {
        project: `ielts-ci-${randomBytes(6).toString('hex')}`,
        environment: {
            POSTGRES_PASSWORD: randomBytes(24).toString('hex'),
            SESSION_SECRET: randomBytes(32).toString('hex'),
            REGISTRATION_MODE: 'first-user', APP_BIND_ADDRESS: '127.0.0.1', APP_PORT: '3000',
            COOKIE_SECURE: 'false', TRUST_PROXY: 'false', TRUSTED_PROXY_IPS: '',
            COMPOSE_PROFILES: '', COMPOSE_MENU: 'false'
        }
    };
    // Exclusive creation prevents overwriting an interrupted run's cleanup state.
    await fs.writeFile(statePath, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
    const report = { status: 'fail', checks: [] };
    console.log(`Smoke state directory: ${stateDir}`);
    try {
        await fs.writeFile(envPath, Object.entries(state.environment)
            .map(([key, value]) => `${key}=${value}`).join('\n'), { flag: 'wx', mode: 0o600 });
        await smoke(state, (name) => {
            report.checks.push({ name, status: 'pass' });
            console.log(`PASS: ${name}`);
        });
        report.status = 'pass';
    } catch (error) {
        report.error = error.message;
        throw error;
    } finally {
        try {
            await cleanup(state);
        } catch (error) {
            report.status = 'fail';
            report.cleanupError = error.message;
            process.exitCode = 1;
        }
        await fs.mkdir(reportDir, { recursive: true });
        await fs.writeFile(path.join(reportDir, 'smoke-report.json'), `${JSON.stringify(report, null, 2)}\n`);
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
