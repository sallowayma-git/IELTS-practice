#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const npmCliPath = require.resolve('npm/bin/npm-cli.js');

function runNpm(args) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [npmCliPath, ...args], {
            stdio: 'inherit',
            env: process.env
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`npm ${args.join(' ')} exited with code ${code}`));
        });
    });
}

function sanitizeSigningEnv() {
    const maybeEmptyKeys = [
        'CSC_LINK',
        'CSC_KEY_PASSWORD',
        'WIN_CSC_LINK',
        'WIN_CSC_KEY_PASSWORD',
        'APPLE_ID',
        'APPLE_APP_SPECIFIC_PASSWORD',
        'APPLE_TEAM_ID'
    ];

    maybeEmptyKeys.forEach((key) => {
        const raw = process.env[key];
        if (typeof raw !== 'string') {
            return;
        }
        if (raw.trim() === '') {
            delete process.env[key];
        }
    });

    const hasCodeSignIdentity = Boolean(
        (process.env.CSC_LINK && process.env.CSC_LINK.trim())
        || (process.env.WIN_CSC_LINK && process.env.WIN_CSC_LINK.trim())
        || (process.env.CSC_NAME && process.env.CSC_NAME.trim())
    );

    if (!hasCodeSignIdentity) {
        process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
    }
}

async function main() {
    const publishMode = process.argv.includes('--publish-on-tag') ? 'onTag' : 'never';
    sanitizeSigningEnv();
    await runNpm(['run', 'build:writing']);
    await runNpm(['exec', '--', 'electron-builder', '--publish', publishMode]);
}

main().catch((error) => {
    const message = error && error.message ? error.message : String(error);
    console.error(message);
    process.exit(1);
});
