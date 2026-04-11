import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { triggersShellUpdate } from '../../../scripts/build-resource-release.mjs';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const nextToken = argv[index + 1];
    if (!nextToken || nextToken.startsWith('--')) {
      args[key] = true;
      continue;
    }

    args[key] = nextToken;
    index += 1;
  }
  return args;
}

function sha256OfBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function copyDirectory(sourceRoot, targetRoot) {
  fs.rmSync(targetRoot, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetRoot), { recursive: true });
  fs.cpSync(sourceRoot, targetRoot, { recursive: true });
}

function tamperDeltaArchive(outputRoot) {
  const manifestPath = path.join(outputRoot, 'resources-manifest.json');
  const archivePath = path.join(outputRoot, 'resources-delta.zip');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const zip = new AdmZip(archivePath);

  zip.addFile('evil.txt', Buffer.from('tampered resource payload', 'utf8'));
  zip.writeZip(archivePath);

  const archiveBuffer = fs.readFileSync(archivePath);
  manifest.packages.delta.integrity.sha256 = sha256OfBuffer(archiveBuffer);
  manifest.packages.delta.integrity.size = archiveBuffer.length;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function expectVerifierToReject(outputRoot) {
  let rejected = false;
  try {
    execFileSync(process.execPath, ['scripts/verify-resource-release.mjs', '--dir', outputRoot], {
      stdio: 'pipe'
    });
  } catch (error) {
    rejected = true;
  }

  if (!rejected) {
    throw new Error('verify-resource-release 未能拒绝自洽但被篡改的资源包');
  }
}

function verifyShellTriggerContract() {
  const shellContractPaths = [
    'electron/preload.js',
    'electron/main.js',
    'package.json',
    'package-lock.json',
    'js/app/main-entry.js',
    'js/integration/updateManager.js'
  ];
  const resourceOnlyPaths = [
    'index.html',
    'css/main.css',
    'js/main.js',
    'assets/logo.png'
  ];

  for (const filePath of shellContractPaths) {
    if (!triggersShellUpdate(filePath)) {
      throw new Error(`壳层契约路径未触发 requiresShellUpdate: ${filePath}`);
    }
  }

  for (const filePath of resourceOnlyPaths) {
    if (triggersShellUpdate(filePath)) {
      throw new Error(`纯资源路径不应触发 requiresShellUpdate: ${filePath}`);
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceRoot = path.resolve(args.dir || 'dist/resources');
  const tamperedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'resource-release-smoke-'));

  verifyShellTriggerContract();
  copyDirectory(sourceRoot, tamperedRoot);
  tamperDeltaArchive(tamperedRoot);
  expectVerifierToReject(tamperedRoot);

  console.log(`Resource release smoke passed for ${sourceRoot}`);
}

main();
