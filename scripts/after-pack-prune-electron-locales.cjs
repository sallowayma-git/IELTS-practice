/* eslint-disable no-console */
const fs = require('node:fs/promises');
const path = require('node:path');

const KEEP_LOCALE_DIRS = new Set([
  'en.lproj',
  'en_GB.lproj',
  'zh_CN.lproj',
  'zh_TW.lproj'
]);

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = async function afterPackPruneElectronLocales(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appName = packager.appInfo.productFilename;
  const resourcesDir = path.join(
    appOutDir,
    `${appName}.app`,
    'Contents',
    'Frameworks',
    'Electron Framework.framework',
    'Versions',
    'A',
    'Resources'
  );

  if (!(await exists(resourcesDir))) {
    console.warn(`[afterPack] 未找到 Electron Framework 资源目录，跳过裁剪: ${resourcesDir}`);
    return;
  }

  const entries = await fs.readdir(resourcesDir, { withFileTypes: true });
  const removable = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.lproj') && !KEEP_LOCALE_DIRS.has(entry.name))
    .map((entry) => entry.name);

  if (!removable.length) {
    console.log('[afterPack] 未发现可裁剪的 lproj 目录。');
    return;
  }

  await Promise.all(
    removable.map((name) => fs.rm(path.join(resourcesDir, name), { recursive: true, force: true }))
  );

  console.log(`[afterPack] Electron 语言资源裁剪完成，移除 ${removable.length} 个目录。`);
};
