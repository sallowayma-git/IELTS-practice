import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function sha512OfBuffer(buffer) {
  return crypto.createHash('sha512').update(buffer).digest('base64');
}

function writeShellFixture(rootDir, config) {
  fs.mkdirSync(rootDir, { recursive: true });

  const installerBuffer = Buffer.from(`installer:${config.assetName}:${config.version}`, 'utf8');
  const installerSha512 = sha512OfBuffer(installerBuffer);
  fs.writeFileSync(path.join(rootDir, config.assetName), installerBuffer);
  fs.writeFileSync(path.join(rootDir, `${config.assetName}.blockmap`), 'blockmap');
  if (config.extraAssets) {
    for (const assetName of config.extraAssets) {
      fs.writeFileSync(path.join(rootDir, assetName), `extra:${assetName}`);
    }
  }

  const metadataText = [
    `version: ${config.version}`,
    'files:',
    `  - url: ${config.assetName}`,
    `    sha512: ${installerSha512}`,
    `    size: ${installerBuffer.length}`,
    `path: ${config.assetName}`,
    `sha512: ${installerSha512}`,
    "releaseDate: '2026-04-11T00:00:00.000Z'"
  ].join('\n');

  fs.writeFileSync(path.join(rootDir, config.metadataFile), `${metadataText}\n`, 'utf8');
}

function runVerifier(rootDir, platform, tag) {
  execFileSync(process.execPath, [
    'scripts/verify-shell-release.mjs',
    '--dir', rootDir,
    '--platform', platform,
    '--tag', tag
  ], {
    stdio: 'pipe'
  });
}

function expectVerifierToReject(rootDir, platform, tag) {
  let rejected = false;
  try {
    runVerifier(rootDir, platform, tag);
  } catch (_) {
    rejected = true;
  }

  if (!rejected) {
    throw new Error(`verify-shell-release 未能拒绝坏壳包: ${platform}`);
  }
}

function tamperMetadataSha512(rootDir, metadataFile) {
  const metadataPath = path.join(rootDir, metadataFile);
  const metadataText = fs.readFileSync(metadataPath, 'utf8');
  const tamperedText = metadataText.replace(/sha512:\s*[^\n]+/, 'sha512: broken-sha512');
  fs.writeFileSync(metadataPath, tamperedText, 'utf8');
}

function verifyScenario(config) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), `shell-release-${config.platform.toLowerCase()}-`));
  writeShellFixture(fixtureRoot, config);
  runVerifier(fixtureRoot, config.platform, config.tag);
  tamperMetadataSha512(fixtureRoot, config.metadataFile);
  expectVerifierToReject(fixtureRoot, config.platform, config.tag);
}

function main() {
  verifyScenario({
    platform: 'Windows',
    tag: 'v0.6.0',
    version: '0.6.0',
    metadataFile: 'latest.yml',
    assetName: 'ielts-practice-0.6.0-windows-x64-setup.exe'
  });

  verifyScenario({
    platform: 'macOS',
    tag: 'v0.6.0',
    version: '0.6.0',
    metadataFile: 'latest-mac.yml',
    assetName: 'ielts-practice-0.6.0-macos-arm64.zip',
    extraAssets: ['ielts-practice-0.6.0-macos-arm64.dmg']
  });

  console.log('Shell release smoke passed.');
}

main();
