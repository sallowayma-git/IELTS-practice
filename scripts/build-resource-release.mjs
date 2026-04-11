import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';
import semver from 'semver';

const RESOURCE_INCLUDE = Object.freeze({
  exact: ['index.html'],
  prefixes: ['css/', 'js/', 'templates/', 'assets/', 'ListeningPractice/']
});

const RESOURCE_EXCLUDE = Object.freeze({
  basenames: ['.ds_store', 'thumbs.db'],
  extensions: ['.bak', '.tmp', '.temp', '.old', '.orig', '.rej', '.swp', '.swo'],
  contains: ['__MACOSX/'],
  suffixes: ['~']
});

const SHELL_TRIGGER_RULES = Object.freeze({
  exact: [
    'package.json',
    'package-lock.json',
    'js/app/main-entry.js',
    'js/integration/updateManager.js'
  ],
  prefixes: [
    'electron/'
  ]
});

const MANIFEST_ASSET_NAME = 'resources-manifest.json';
const DELTA_ASSET_NAME = 'resources-delta.zip';
const FULL_ASSET_NAME = 'resources-full.zip';

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

function runGit(args, options = {}) {
  return execFileSync('git', args, {
    encoding: options.encoding || 'utf8',
    maxBuffer: options.maxBuffer || 128 * 1024 * 1024
  }).trim();
}

function normalizeTag(tag) {
  if (!tag) {
    return null;
  }
  const cleaned = semver.clean(String(tag));
  return cleaned ? `v${cleaned}` : null;
}

function normalizeRepoPath(filePath) {
  if (!filePath) {
    return '';
  }

  const normalized = String(filePath)
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .trim();

  if (!normalized || normalized === '.') {
    return '';
  }
  if (normalized.includes('\0')) {
    return '';
  }
  if (normalized.startsWith('../') || normalized.includes('/../')) {
    return '';
  }

  return normalized;
}

function listStableTags() {
  const tags = runGit(['tag', '--list', 'v*'])
    .split('\n')
    .map((tag) => normalizeTag(tag))
    .filter(Boolean);

  return tags
    .filter((tag) => {
      const cleaned = semver.clean(tag);
      return cleaned && !semver.prerelease(cleaned);
    })
    .sort((left, right) => semver.rcompare(semver.clean(left), semver.clean(right)));
}

function resolvePreviousTag(currentTag, explicitPreviousTag) {
  if (explicitPreviousTag) {
    const normalized = normalizeTag(explicitPreviousTag);
    if (!normalized) {
      throw new Error(`--previous-tag 不是合法版本: ${explicitPreviousTag}`);
    }
    return normalized;
  }

  const stableTags = listStableTags().filter((tag) => tag !== currentTag);
  return stableTags[0] || null;
}

function isIncludedResourcePath(filePath) {
  const normalized = normalizeRepoPath(filePath);
  if (!normalized) {
    return false;
  }

  if (RESOURCE_INCLUDE.exact.includes(normalized)) {
    return true;
  }

  return RESOURCE_INCLUDE.prefixes.some((prefix) => normalized.startsWith(prefix));
}

function hasHiddenPathSegment(filePath) {
  return normalizeRepoPath(filePath)
    .split('/')
    .some((segment) => segment.startsWith('.') && segment.length > 1);
}

function isExcludedResourcePath(filePath) {
  const normalized = normalizeRepoPath(filePath);
  if (!normalized) {
    return true;
  }

  if (hasHiddenPathSegment(normalized)) {
    return true;
  }

  if (RESOURCE_EXCLUDE.contains.some((part) => normalized.includes(part))) {
    return true;
  }

  const basename = path.posix.basename(normalized).toLowerCase();
  if (!basename) {
    return true;
  }
  if (RESOURCE_EXCLUDE.basenames.includes(basename)) {
    return true;
  }
  if (RESOURCE_EXCLUDE.suffixes.some((suffix) => basename.endsWith(suffix))) {
    return true;
  }

  const extension = path.posix.extname(basename);
  if (extension && RESOURCE_EXCLUDE.extensions.includes(extension)) {
    return true;
  }

  return false;
}

function isTrackedResourcePath(filePath) {
  return isIncludedResourcePath(filePath) && !isExcludedResourcePath(filePath);
}

export function triggersShellUpdate(filePath) {
  const normalized = normalizeRepoPath(filePath);
  if (!normalized) {
    return false;
  }
  if (SHELL_TRIGGER_RULES.exact.includes(normalized)) {
    return true;
  }
  return SHELL_TRIGGER_RULES.prefixes.some((allowedPrefix) => normalized.startsWith(allowedPrefix));
}

function listAllFilesAtTag(tag) {
  const raw = runGit(['ls-tree', '-r', '--name-only', tag]);
  if (!raw) {
    return [];
  }

  return raw
    .split('\n')
    .map((line) => normalizeRepoPath(line))
    .filter(Boolean);
}

function listTrackedResourceFilesAtTag(tag) {
  return listAllFilesAtTag(tag)
    .filter((filePath) => isTrackedResourcePath(filePath))
    .sort((left, right) => left.localeCompare(right));
}

function parseDiffLineToOperations(line) {
  const parts = line.split('\t');
  const statusToken = (parts[0] || '').trim();
  const status = statusToken[0];

  if (status === 'R') {
    return [
      { path: normalizeRepoPath(parts[1]), action: 'delete' },
      { path: normalizeRepoPath(parts[2]), action: 'upsert' }
    ];
  }

  if (status === 'D') {
    return [{ path: normalizeRepoPath(parts[1]), action: 'delete' }];
  }

  return [{ path: normalizeRepoPath(parts[parts.length - 1]), action: 'upsert' }];
}

function mergeOperations(entries) {
  const merged = new Map();

  for (const entry of entries) {
    if (!entry.path) {
      continue;
    }

    const previous = merged.get(entry.path);
    if (!previous || entry.action === 'upsert') {
      merged.set(entry.path, entry.action);
    }
  }

  return Array.from(merged.entries())
    .map(([filePath, action]) => ({ path: filePath, action }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function listChangedOperations(previousTag, currentTag) {
  if (!previousTag) {
    return listAllFilesAtTag(currentTag).map((filePath) => ({
      path: filePath,
      action: 'upsert'
    }));
  }

  const rawDiff = runGit([
    'diff',
    '--name-status',
    '--find-renames',
    '--find-copies',
    `${previousTag}..${currentTag}`
  ]);

  if (!rawDiff) {
    return [];
  }

  const operations = rawDiff
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => parseDiffLineToOperations(line));

  return mergeOperations(operations);
}

async function ensureCleanDirectory(targetPath) {
  await fs.rm(targetPath, { recursive: true, force: true });
  await fs.mkdir(targetPath, { recursive: true });
}

function sha256OfBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function readTaggedFile(tag, filePath) {
  return execFileSync('git', ['show', `${tag}:${filePath}`], {
    encoding: 'buffer',
    maxBuffer: 128 * 1024 * 1024
  });
}

async function writeTaggedFile(tag, filePath, stagingRoot) {
  const fileBuffer = readTaggedFile(tag, filePath);
  const destinationPath = path.join(stagingRoot, filePath);
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.writeFile(destinationPath, fileBuffer);

  return {
    path: filePath,
    action: 'upsert',
    sha256: sha256OfBuffer(fileBuffer),
    size: fileBuffer.length
  };
}

async function buildFilesFromOperations(operations, currentTag, stagingRoot) {
  const files = [];
  await ensureCleanDirectory(stagingRoot);

  for (const operation of operations) {
    if (!isTrackedResourcePath(operation.path)) {
      continue;
    }

    if (operation.action === 'delete') {
      files.push({
        path: operation.path,
        action: 'delete',
        sha256: null,
        size: 0
      });
      continue;
    }

    files.push(await writeTaggedFile(currentTag, operation.path, stagingRoot));
  }

  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
}

async function buildFullFiles(currentTag, stagingRoot) {
  const operations = listTrackedResourceFilesAtTag(currentTag).map((filePath) => ({
    path: filePath,
    action: 'upsert'
  }));
  return buildFilesFromOperations(operations, currentTag, stagingRoot);
}

function createCompatibleShellRange(currentTag, previousTag, requiresShellUpdate) {
  const currentVersion = semver.clean(currentTag);
  const previousVersion = semver.clean(previousTag || currentTag);
  if (!currentVersion) {
    return null;
  }
  if (requiresShellUpdate || !previousVersion) {
    return `>=${currentVersion}`;
  }
  return `>=${previousVersion}`;
}

async function buildArchive(sourceRoot, archivePath) {
  const zip = new AdmZip();
  zip.addLocalFolder(sourceRoot);
  await fs.mkdir(path.dirname(archivePath), { recursive: true });
  zip.writeZip(archivePath);
}

async function describeAsset(archivePath) {
  const fileBuffer = await fs.readFile(archivePath);
  return {
    assetName: path.basename(archivePath),
    size: fileBuffer.length,
    sha256: sha256OfBuffer(fileBuffer)
  };
}

function summarizeFiles(files) {
  return files.reduce((summary, fileEntry) => {
    if (fileEntry.action === 'delete') {
      return {
        ...summary,
        deleteCount: summary.deleteCount + 1
      };
    }
    return {
      ...summary,
      upsertCount: summary.upsertCount + 1
    };
  }, { upsertCount: 0, deleteCount: 0 });
}

function buildPackageDescriptor(options) {
  const descriptor = {
    assetName: options.asset.assetName,
    mode: options.mode,
    baseResourceVersion: options.baseResourceVersion,
    managedPrefixes: options.managedPrefixes,
    integrity: {
      sha256: options.asset.sha256,
      size: options.asset.size
    },
    fileCount: options.files.length,
    ...summarizeFiles(options.files)
  };

  if (options.includeFiles !== false) {
    descriptor.files = options.files;
  }
  return descriptor;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const currentTag = normalizeTag(args.tag || process.env.GITHUB_REF_NAME);
  if (!currentTag) {
    throw new Error('必须通过 --tag 提供合法的 v* 版本标签');
  }

  const previousTag = resolvePreviousTag(currentTag, args['previous-tag']);
  const outputRoot = path.resolve(args.output || 'dist/resources');
  const deltaStagingRoot = path.join(outputRoot, '.delta-staging');
  const fullStagingRoot = path.join(outputRoot, '.full-staging');
  const deltaArchivePath = path.join(outputRoot, DELTA_ASSET_NAME);
  const fullArchivePath = path.join(outputRoot, FULL_ASSET_NAME);

  const changedOperations = listChangedOperations(previousTag, currentTag);
  const requiresShellUpdate = changedOperations.some((entry) => triggersShellUpdate(entry.path));

  await ensureCleanDirectory(outputRoot);
  const deltaFiles = await buildFilesFromOperations(changedOperations, currentTag, deltaStagingRoot);
  const fullFiles = await buildFullFiles(currentTag, fullStagingRoot);

  await buildArchive(deltaStagingRoot, deltaArchivePath);
  await buildArchive(fullStagingRoot, fullArchivePath);

  const deltaAsset = await describeAsset(deltaArchivePath);
  const fullAsset = await describeAsset(fullArchivePath);

  const manifest = {
    schemaVersion: 2,
    tag: currentTag,
    publishedAt: new Date().toISOString(),
    resourceVersion: currentTag,
    baseResourceVersion: previousTag,
    compatibleShellRange: createCompatibleShellRange(currentTag, previousTag, requiresShellUpdate),
    requiresShellUpdate,
    releaseNotes: process.env.GITHUB_RELEASE_NOTES || '',
    managedPrefixes: [...RESOURCE_INCLUDE.exact, ...RESOURCE_INCLUDE.prefixes],
    files: deltaFiles,
    packages: {
      delta: buildPackageDescriptor({
        asset: deltaAsset,
        mode: 'delta',
        baseResourceVersion: previousTag,
        files: deltaFiles,
        managedPrefixes: [...RESOURCE_INCLUDE.exact, ...RESOURCE_INCLUDE.prefixes]
      }),
      full: buildPackageDescriptor({
        asset: fullAsset,
        mode: 'full',
        baseResourceVersion: null,
        files: fullFiles,
        managedPrefixes: [...RESOURCE_INCLUDE.exact, ...RESOURCE_INCLUDE.prefixes]
      })
    }
  };

  await fs.writeFile(
    path.join(outputRoot, MANIFEST_ASSET_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );

  await fs.rm(deltaStagingRoot, { recursive: true, force: true });
  await fs.rm(fullStagingRoot, { recursive: true, force: true });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(`[build-resource-release] ${error.message}`);
    process.exitCode = 1;
  });
}
