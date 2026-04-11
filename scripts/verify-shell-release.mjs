import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import semver from 'semver';

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

function resolvePlatformConfig(platform) {
  const normalized = String(platform || '').toLowerCase();
  if (normalized === 'windows' || normalized === 'win32') {
    return {
      label: 'Windows',
      metadataFile: 'latest.yml'
    };
  }
  if (normalized === 'macos' || normalized === 'darwin' || normalized === 'mac') {
    return {
      label: 'macOS',
      metadataFile: 'latest-mac.yml'
    };
  }
  throw new Error(`不支持的壳层发布平台: ${platform}`);
}

function stripYamlScalar(rawValue) {
  return String(rawValue || '')
    .trim()
    .replace(/^['"]/, '')
    .replace(/['"]$/, '');
}

function parseYamlMetadata(metadataText) {
  const result = {
    version: '',
    path: '',
    sha512: '',
    files: []
  };
  let inFiles = false;
  let currentFile = null;

  for (const rawLine of metadataText.split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, '    ');
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const topLevelMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (topLevelMatch) {
      const [, key, rawValue] = topLevelMatch;
      if (key === 'files') {
        inFiles = true;
        currentFile = null;
        continue;
      }

      inFiles = false;
      currentFile = null;
      result[key] = stripYamlScalar(rawValue);
      continue;
    }

    if (!inFiles) {
      continue;
    }

    const listItemMatch = line.match(/^\s*-\s*([A-Za-z0-9_-]+):\s*(.*)$/);
    if (listItemMatch) {
      const [, key, rawValue] = listItemMatch;
      currentFile = {
        [key]: stripYamlScalar(rawValue)
      };
      result.files.push(currentFile);
      continue;
    }

    const nestedMatch = line.match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
    if (nestedMatch && currentFile) {
      const [, key, rawValue] = nestedMatch;
      currentFile[key] = stripYamlScalar(rawValue);
    }
  }

  return result;
}

function normalizeAssetName(rawValue) {
  const cleaned = stripYamlScalar(rawValue);
  if (!cleaned) {
    return null;
  }
  return path.basename(cleaned);
}

function normalizeVersion(rawValue) {
  const cleaned = semver.clean(String(rawValue || ''));
  return cleaned || null;
}

function sha512OfBuffer(buffer) {
  return crypto.createHash('sha512').update(buffer).digest('base64');
}

function parseMetadataFileEntry(entry, label) {
  const assetName = normalizeAssetName(entry.path || entry.url);
  assert(assetName, `${label} 存在缺少 path/url 的 files 条目`);

  const normalized = {
    assetName,
    sha512: stripYamlScalar(entry.sha512),
    size: entry.size === '' || entry.size == null ? null : Number(entry.size)
  };

  assert(normalized.sha512, `${label} 缺少 sha512: ${assetName}`);
  if (normalized.size != null) {
    assert(Number.isFinite(normalized.size) && normalized.size >= 0, `${label} size 非法: ${assetName}`);
  }

  return normalized;
}

function verifyFileAgainstMetadata(outputRoot, metadataFile, label) {
  const assetPath = path.join(outputRoot, metadataFile.assetName);
  assert(fs.existsSync(assetPath), `${label} 缺少 metadata 指向的壳层资产: ${metadataFile.assetName}`);

  const assetBuffer = fs.readFileSync(assetPath);
  const actualSha512 = sha512OfBuffer(assetBuffer);
  assert(actualSha512 === metadataFile.sha512, `${label} sha512 不匹配: ${metadataFile.assetName}`);

  if (metadataFile.size != null) {
    assert(assetBuffer.length === metadataFile.size, `${label} size 不匹配: ${metadataFile.assetName}`);
  }

  return assetPath;
}

function extractPrimaryAsset(metadata, label) {
  const listedFiles = Array.isArray(metadata.files)
    ? metadata.files.map((entry) => parseMetadataFileEntry(entry, label))
    : [];

  const primaryFromFiles = listedFiles.find((entry) => !entry.assetName.endsWith('.blockmap')) || null;
  if (primaryFromFiles) {
    return {
      listedFiles,
      primaryAsset: primaryFromFiles
    };
  }

  const topLevelAssetName = normalizeAssetName(metadata.path || metadata.url);
  const topLevelSha512 = stripYamlScalar(metadata.sha512);
  if (!topLevelAssetName) {
    throw new Error(`${label} 缺少主安装包路径`);
  }
  assert(topLevelSha512, `${label} 缺少顶层 sha512`);

  return {
    listedFiles,
    primaryAsset: {
      assetName: topLevelAssetName,
      sha512: topLevelSha512,
      size: null
    }
  };
}

function verifyTopLevelPrimaryMetadata(metadata, primaryAsset, label) {
  const topLevelAssetName = normalizeAssetName(metadata.path || metadata.url);
  const topLevelSha512 = stripYamlScalar(metadata.sha512);

  if (!topLevelAssetName && !topLevelSha512) {
    return;
  }

  assert(topLevelAssetName, `${label} 顶层 path/url 缺失`);
  assert(topLevelSha512, `${label} 顶层 sha512 缺失`);
  assert(topLevelAssetName === primaryAsset.assetName, `${label} 顶层 path/url 与主安装包不一致`);
  assert(topLevelSha512 === primaryAsset.sha512, `${label} 顶层 sha512 与主安装包不一致`);
}

function verifyMetadataVersion(metadata, expectedTag, label) {
  const normalizedVersion = normalizeVersion(metadata.version);
  assert(normalizedVersion, `${label} 缺少合法 version`);

  if (!expectedTag) {
    return normalizedVersion;
  }

  const expectedVersion = normalizeVersion(expectedTag);
  assert(expectedVersion, `非法 tag: ${expectedTag}`);
  assert(normalizedVersion === expectedVersion, `${label} version 与 tag 不一致: ${metadata.version} != ${expectedTag}`);
  return normalizedVersion;
}

function verifyPrimaryBlockmap(outputRoot, primaryAssetName, label) {
  const blockmapPath = path.join(outputRoot, `${primaryAssetName}.blockmap`);
  assert(fs.existsSync(blockmapPath), `${label} 缺少差分 blockmap: ${primaryAssetName}.blockmap`);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function verifyAssetNaming(outputRoot, platformConfig, version, primaryAssetName, label) {
  const escapedVersion = escapeRegExp(version);

  if (platformConfig.label === 'Windows') {
    const windowsPattern = new RegExp(`^ielts-practice-${escapedVersion}-windows-(x64|ia32|arm64)-setup\\.exe$`);
    assert(windowsPattern.test(primaryAssetName), `${label} 命名不符合约定: ${primaryAssetName}`);
    return;
  }

  const macZipPattern = new RegExp(`^ielts-practice-${escapedVersion}-macos-(x64|arm64|universal)\\.zip$`);
  assert(macZipPattern.test(primaryAssetName), `${label} 命名不符合约定: ${primaryAssetName}`);

  const dmgAssetName = primaryAssetName.replace(/\.zip$/i, '.dmg');
  const dmgPath = path.join(outputRoot, dmgAssetName);
  assert(fs.existsSync(dmgPath), `${label} 缺少给新用户使用的 dmg 安装包: ${dmgAssetName}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputRoot = path.resolve(args.dir || 'dist/electron');
  const platformConfig = resolvePlatformConfig(args.platform || process.platform);
  const metadataPath = path.join(outputRoot, platformConfig.metadataFile);
  assert(metadataPath, `${platformConfig.label} 缺少 update metadata 文件`);
  assert(fs.existsSync(metadataPath), `${platformConfig.label} 缺少 update metadata 文件: ${platformConfig.metadataFile}`);

  const metadataText = fs.readFileSync(metadataPath, 'utf8');
  const metadata = parseYamlMetadata(metadataText);
  const metadataLabel = `${platformConfig.label} ${path.basename(metadataPath)}`;
  const version = verifyMetadataVersion(metadata, args.tag || '', metadataLabel);
  const { listedFiles, primaryAsset } = extractPrimaryAsset(metadata, metadataLabel);

  assert(primaryAsset && primaryAsset.assetName, `${metadataLabel} 缺少主安装包路径`);
  verifyTopLevelPrimaryMetadata(metadata, primaryAsset, metadataLabel);
  verifyFileAgainstMetadata(outputRoot, primaryAsset, metadataLabel);

  for (const listedFile of listedFiles) {
    verifyFileAgainstMetadata(outputRoot, listedFile, metadataLabel);
  }

  verifyPrimaryBlockmap(outputRoot, primaryAsset.assetName, metadataLabel);
  verifyAssetNaming(outputRoot, platformConfig, version, primaryAsset.assetName, metadataLabel);

  console.log(`Verified ${platformConfig.label} shell artifacts in ${outputRoot} (version ${version})`);
}

main();
