import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';

const RESOURCE_EXCLUDE = Object.freeze({
  basenames: ['.ds_store', 'thumbs.db'],
  extensions: ['.bak', '.tmp', '.temp', '.old', '.orig', '.rej', '.swp', '.swo'],
  contains: ['__MACOSX/'],
  suffixes: ['~']
});

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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256OfBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function normalizeResourcePath(filePath) {
  if (!filePath) {
    return '';
  }

  const normalized = String(filePath)
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .trim();

  if (!normalized || normalized === '.' || normalized.includes('\0')) {
    return '';
  }

  const resolved = path.posix.normalize(normalized);
  if (!resolved || resolved === '.' || resolved === '..' || resolved.startsWith('../') || resolved.includes('/../')) {
    return '';
  }

  return resolved;
}

function normalizeManagedEntry(entry) {
  if (!entry) {
    return '';
  }

  const rawValue = String(entry).replace(/\\/g, '/').trim();
  const isPrefix = rawValue.endsWith('/');
  const normalized = normalizeResourcePath(isPrefix ? rawValue.slice(0, -1) : rawValue);
  if (!normalized) {
    return '';
  }
  return isPrefix ? `${normalized}/` : normalized;
}

function normalizeManagedPrefixes(prefixes) {
  const normalized = Array.isArray(prefixes)
    ? prefixes.map((entry) => normalizeManagedEntry(entry)).filter(Boolean)
    : [];
  return Array.from(new Set(normalized)).sort((left, right) => left.localeCompare(right));
}

function matchesManagedEntry(resourcePath, managedEntry) {
  if (!managedEntry) {
    return false;
  }
  return managedEntry.endsWith('/')
    ? resourcePath.startsWith(managedEntry)
    : resourcePath === managedEntry;
}

function isManagedResourcePath(resourcePath, managedPrefixes) {
  return managedPrefixes.some((entry) => matchesManagedEntry(resourcePath, entry));
}

function hasHiddenPathSegment(filePath) {
  return normalizeResourcePath(filePath)
    .split('/')
    .some((segment) => segment.startsWith('.') && segment.length > 1);
}

function isExcludedResourcePath(filePath) {
  const normalized = normalizeResourcePath(filePath);
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
  return !!(extension && RESOURCE_EXCLUDE.extensions.includes(extension));
}

function ensureValidManagedPrefixes(prefixes, label) {
  const normalized = normalizeManagedPrefixes(prefixes);
  assert(normalized.length > 0, `${label} managedPrefixes 为空或非法`);
  return normalized;
}

function ensureManifestEntry(entry, managedPrefixes, label) {
  assert(entry && typeof entry === 'object', `${label} 存在非法文件条目`);

  const normalizedPath = normalizeResourcePath(entry.path);
  assert(normalizedPath, `${label} 存在非法路径: ${entry.path}`);
  assert(isManagedResourcePath(normalizedPath, managedPrefixes), `${label} 路径不在白名单中: ${normalizedPath}`);
  assert(!isExcludedResourcePath(normalizedPath), `${label} 包含应被排除的路径: ${normalizedPath}`);
  assert(entry.action === 'upsert' || entry.action === 'delete', `${label} 存在非法 action: ${entry.action}`);

  if (entry.action === 'delete') {
    assert(entry.sha256 == null, `${label} delete 条目不应包含 sha256: ${normalizedPath}`);
    assert(Number(entry.size) === 0, `${label} delete 条目 size 必须为 0: ${normalizedPath}`);
  } else {
    assert(typeof entry.sha256 === 'string' && entry.sha256.length > 0, `${label} upsert 条目缺少 sha256: ${normalizedPath}`);
    assert(Number.isFinite(Number(entry.size)) && Number(entry.size) >= 0, `${label} upsert 条目 size 非法: ${normalizedPath}`);
  }

  return {
    ...entry,
    path: normalizedPath,
    size: Number(entry.size)
  };
}

function verifyArchive(packageInfo, fileBuffer, expectedName) {
  assert(packageInfo, `缺少 ${expectedName} 的 package 描述`);
  assert(packageInfo.assetName === expectedName, `${expectedName} 资产名错误`);
  assert(packageInfo.integrity?.sha256 === sha256OfBuffer(fileBuffer), `${expectedName} hash 不匹配`);
  assert(packageInfo.integrity?.size === fileBuffer.length, `${expectedName} size 不匹配`);
}

function verifyFileCounts(packageInfo, files, label) {
  assert(Number.isFinite(packageInfo.fileCount), `${label} fileCount 缺失`);
  assert(packageInfo.fileCount === files.length, `${label} fileCount 与文件列表不一致`);

  const summary = files.reduce((result, fileEntry) => {
    if (fileEntry.action === 'delete') {
      return {
        ...result,
        deleteCount: result.deleteCount + 1
      };
    }
    return {
      ...result,
      upsertCount: result.upsertCount + 1
    };
  }, { upsertCount: 0, deleteCount: 0 });

  assert(packageInfo.upsertCount === summary.upsertCount, `${label} upsertCount 不匹配`);
  assert(packageInfo.deleteCount === summary.deleteCount, `${label} deleteCount 不匹配`);
}

function extractArchiveFiles(archivePath) {
  const archive = new AdmZip(archivePath);
  const fileEntries = archive.getEntries().filter((entry) => !entry.isDirectory);

  return fileEntries.map((entry) => {
    const normalizedPath = normalizeResourcePath(entry.entryName);
    assert(normalizedPath, `归档中存在非法路径: ${entry.entryName}`);
    return {
      path: normalizedPath,
      data: entry.getData()
    };
  });
}

function assertUniquePaths(paths, label) {
  const uniqueSize = new Set(paths).size;
  assert(uniqueSize === paths.length, `${label} 存在重复路径`);
}

function verifyPackageEntries(packageInfo, label) {
  const managedPrefixes = ensureValidManagedPrefixes(packageInfo.managedPrefixes, `${label}.managedPrefixes`);
  const files = packageInfo.files.map((entry) => ensureManifestEntry(entry, managedPrefixes, `${label}.files`));
  const paths = files.map((entry) => entry.path);
  assertUniquePaths(paths, `${label}.files`);

  const upsertFiles = files.filter((entry) => entry.action === 'upsert');
  const deleteFiles = files.filter((entry) => entry.action === 'delete');
  const upsertPaths = upsertFiles.map((entry) => entry.path).sort((left, right) => left.localeCompare(right));
  const deletePaths = deleteFiles.map((entry) => entry.path).sort((left, right) => left.localeCompare(right));
  const deletePathSet = new Set(deletePaths);
  assert(upsertPaths.every((entry) => !deletePathSet.has(entry)), `${label} 同一路径不能同时 upsert 和 delete`);

  return {
    managedPrefixes,
    files,
    upsertFiles,
    upsertPaths,
    deletePaths
  };
}

function verifyArchiveContents(packageInfo, archivePath, label) {
  const packageShape = verifyPackageEntries(packageInfo, label);
  const archiveFiles = extractArchiveFiles(archivePath);
  const archivePaths = archiveFiles.map((entry) => entry.path).sort((left, right) => left.localeCompare(right));
  assertUniquePaths(archivePaths, `${label} 归档路径`);

  for (const archiveFile of archiveFiles) {
    assert(isManagedResourcePath(archiveFile.path, packageShape.managedPrefixes), `${label} 归档包含白名单外路径: ${archiveFile.path}`);
    assert(!isExcludedResourcePath(archiveFile.path), `${label} 归档包含应排除路径: ${archiveFile.path}`);
  }

  assert(JSON.stringify(archivePaths) === JSON.stringify(packageShape.upsertPaths), `${label} 归档文件集合与 manifest upsert 集合不一致`);

  for (const fileEntry of packageShape.upsertFiles) {
    const archiveFile = archiveFiles.find((entry) => entry.path === fileEntry.path);
    assert(archiveFile, `${label} 缺少归档文件: ${fileEntry.path}`);
    assert(archiveFile.data.length === fileEntry.size, `${label} 文件大小不匹配: ${fileEntry.path}`);
    assert(sha256OfBuffer(archiveFile.data) === fileEntry.sha256, `${label} 文件哈希不匹配: ${fileEntry.path}`);
  }

  if (packageInfo.mode === 'full') {
    assert(packageShape.deletePaths.length === 0, `${label} full 包不应包含 delete 条目`);
    assert(packageShape.upsertPaths.includes('index.html'), `${label} full 归档缺少 index.html`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputRoot = path.resolve(args.dir || 'dist/resources');
  const manifestPath = path.join(outputRoot, 'resources-manifest.json');
  const deltaArchivePath = path.join(outputRoot, 'resources-delta.zip');
  const fullArchivePath = path.join(outputRoot, 'resources-full.zip');

  const manifest = readJson(manifestPath);
  const deltaArchive = fs.readFileSync(deltaArchivePath);
  const fullArchive = fs.readFileSync(fullArchivePath);

  const manifestPrefixes = ensureValidManagedPrefixes(manifest.managedPrefixes, 'manifest.managedPrefixes');
  assert(Array.isArray(manifest.files), 'manifest.files 缺失');
  assert(Array.isArray(manifest.packages?.delta?.files), 'packages.delta.files 缺失');
  assert(Array.isArray(manifest.packages?.full?.files), 'packages.full.files 缺失');
  assert(manifest.packages?.delta?.mode === 'delta', 'packages.delta.mode 必须为 delta');
  assert(manifest.packages?.full?.mode === 'full', 'packages.full.mode 必须为 full');
  assert((manifest.packages?.delta?.baseResourceVersion || null) === (manifest.baseResourceVersion || null), 'delta 基线版本与顶层 baseResourceVersion 不一致');

  const deltaPrefixes = ensureValidManagedPrefixes(manifest.packages.delta.managedPrefixes, 'packages.delta.managedPrefixes');
  const fullPrefixes = ensureValidManagedPrefixes(manifest.packages.full.managedPrefixes, 'packages.full.managedPrefixes');
  assert(JSON.stringify(deltaPrefixes) === JSON.stringify(manifestPrefixes), 'packages.delta.managedPrefixes 与顶层 manifest.managedPrefixes 不一致');
  assert(JSON.stringify(fullPrefixes) === JSON.stringify(manifestPrefixes), 'packages.full.managedPrefixes 与顶层 manifest.managedPrefixes 不一致');

  verifyArchive(manifest.packages?.delta, deltaArchive, 'resources-delta.zip');
  verifyArchive(manifest.packages?.full, fullArchive, 'resources-full.zip');
  verifyFileCounts(manifest.packages.delta, manifest.files, 'delta');
  assert(JSON.stringify(manifest.packages.delta.files) === JSON.stringify(manifest.files), '顶层 manifest.files 与 packages.delta.files 不一致');
  verifyFileCounts(manifest.packages.full, manifest.packages.full.files, 'full');
  verifyArchiveContents(manifest.packages.delta, deltaArchivePath, 'delta');
  verifyArchiveContents(manifest.packages.full, fullArchivePath, 'full');

  console.log(`Verified resource release contract in ${outputRoot}`);
}

main();
