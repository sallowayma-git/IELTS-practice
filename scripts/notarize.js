/* eslint-disable no-console */
const path = require('node:path');

module.exports = async function notarizeAfterSign(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName !== 'darwin') {
    return;
  }

  const requireNotarize = process.env.REQUIRE_MAC_NOTARIZE === '1';

  if (process.env.SKIP_MAC_NOTARIZE === '1') {
    if (requireNotarize) {
      throw new Error('[notarize] REQUIRE_MAC_NOTARIZE=1 时不允许 SKIP_MAC_NOTARIZE=1。');
    }
    console.log('[notarize] SKIP_MAC_NOTARIZE=1，跳过 macOS 公证。');
    return;
  }

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;
  if (!appleId || !appleIdPassword || !teamId) {
    if (requireNotarize) {
      throw new Error('[notarize] APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID 缺失，无法执行强制公证。');
    }
    console.warn('[notarize] APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID 缺失，跳过公证。');
    return;
  }

  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  let notarizeFn;
  try {
    ({ notarize: notarizeFn } = require('@electron/notarize'));
  } catch (error) {
    if (requireNotarize) {
      throw new Error('[notarize] REQUIRE_MAC_NOTARIZE=1 但缺少 @electron/notarize 依赖。');
    }
    console.warn('[notarize] 未找到 @electron/notarize，跳过公证。');
    return;
  }

  console.log(`[notarize] 开始提交公证: ${appPath}`);
  await notarizeFn({
    appPath,
    appleId,
    appleIdPassword,
    teamId,
    tool: 'notarytool'
  });
  console.log('[notarize] 公证完成。');
};
