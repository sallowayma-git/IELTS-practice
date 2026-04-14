import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const files = [
  'electron/appConfig.js',
  'electron/main.js',
  'electron/preload.js',
  'electron/protocol.js',
  'electron/update/releaseClient.js',
  'electron/update/resourceOverlayManager.js',
  'electron/update/updateService.js',
  'developer/tests/update/renderer-ready-smoke.cjs',
  'developer/tests/update/release-client-smoke.cjs',
  'developer/tests/update/resource-release-smoke.mjs',
  'developer/tests/update/shell-release-smoke.mjs',
  'developer/tests/update/shell-support-smoke.cjs',
  'js/app/main-entry.js',
  'js/integration/updateManager.js',
  'scripts/build-resource-release.mjs',
  'scripts/check-update-syntax.mjs',
  'scripts/verify-resource-release.mjs',
  'scripts/verify-shell-release.mjs'
];

for (const filePath of files) {
  execFileSync(process.execPath, ['--check', filePath], {
    stdio: 'inherit'
  });
}

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const requiredScripts = [
  'release:build',
  'build:resource-release',
  'check:update-syntax',
  'verify:release-client-smoke',
  'verify:update-runtime',
  'verify:resource-release',
  'verify:resource-release-smoke',
  'verify:shell-release',
  'verify:shell-release-smoke',
  'verify:shell-support-smoke',
  'release:publish'
];

for (const scriptName of requiredScripts) {
  if (!packageJson.scripts?.[scriptName]) {
    throw new Error(`package.json 缺少脚本: ${scriptName}`);
  }
}

const publishTarget = Array.isArray(packageJson.build?.publish)
  ? packageJson.build.publish[0]
  : null;
if (!publishTarget || publishTarget.provider !== 'github') {
  throw new Error('electron-builder publish 必须固定为 GitHub provider');
}
if (packageJson.build?.electronDownload?.mirror !== 'https://npmmirror.com/mirrors/electron/') {
  throw new Error('electron-builder 必须固定 Electron 下载镜像，避免本地/CI 构建受官方源波动影响');
}
if (packageJson.build?.win?.artifactName !== 'ielts-practice-${version}-windows-${arch}-setup.${ext}') {
  throw new Error('Windows 壳层安装包命名必须稳定为 ielts-practice-${version}-windows-${arch}-setup.${ext}');
}
if (packageJson.build?.mac?.artifactName !== 'ielts-practice-${version}-macos-${arch}.${ext}') {
  throw new Error('macOS 壳层产物命名必须稳定为 ielts-practice-${version}-macos-${arch}.${ext}');
}
if (packageJson.build?.nsis?.oneClick !== false || packageJson.build?.nsis?.allowToChangeInstallationDirectory !== true) {
  throw new Error('Windows 安装器必须使用辅助安装模式，并允许用户选择安装路径');
}
if (packageJson.build?.nsis?.perMachine !== false || packageJson.build?.nsis?.selectPerMachineByDefault !== false) {
  throw new Error('Windows 安装器必须默认按用户安装，避免强推系统级安装');
}
if (packageJson.build?.dmg?.artifactName !== 'ielts-practice-${version}-macos-${arch}.${ext}') {
  throw new Error('DMG 命名必须与 macOS 产物命名保持一致');
}
if (packageJson.build?.dmg?.internetEnabled !== false) {
  throw new Error('DMG 必须禁用 internetEnabled，避免分发行为漂移');
}
const dmgContents = Array.isArray(packageJson.build?.dmg?.contents) ? packageJson.build.dmg.contents : [];
if (dmgContents.length < 2
  || dmgContents[0]?.type !== 'file'
  || dmgContents[1]?.type !== 'link'
  || dmgContents[1]?.path !== '/Applications') {
  throw new Error('DMG 前两项必须固定为应用拖入 /Applications 的双栏布局');
}

const hasFirstLaunchScript = dmgContents.some((item) =>
  item?.type === 'file' && item?.path === 'assets/release/macos/mac-first-launch.command'
);
const hasFirstLaunchGuide = dmgContents.some((item) =>
  item?.type === 'file' && item?.path === 'assets/release/macos/mac-first-launch-guide.txt'
);
if (!hasFirstLaunchScript || !hasFirstLaunchGuide) {
  throw new Error('DMG 必须包含 mac-first-launch.command 与 mac-first-launch-guide.txt');
}
if (packageJson.build?.mac?.hardenedRuntime !== true || packageJson.build?.mac?.strictVerify !== true) {
  throw new Error('macOS 构建必须开启 hardenedRuntime 与 strictVerify，避免签名分发变形');
}

const preloadText = fs.readFileSync('electron/preload.js', 'utf8');
const rendererText = fs.readFileSync('js/integration/updateManager.js', 'utf8');
const bootRendererText = fs.readFileSync('js/app/main-entry.js', 'utf8');
const mainText = fs.readFileSync('electron/main.js', 'utf8');
const serviceText = fs.readFileSync('electron/update/updateService.js', 'utf8');
const settingsText = fs.existsSync('js/components/settingsPanel.js')
  ? fs.readFileSync('js/components/settingsPanel.js', 'utf8')
  : '';
const keyboardShortcutsText = fs.existsSync('js/utils/keyboardShortcuts.js')
  ? fs.readFileSync('js/utils/keyboardShortcuts.js', 'utf8')
  : '';
const progressTrackerText = fs.existsSync('js/components/progressTracker.js')
  ? fs.readFileSync('js/components/progressTracker.js', 'utf8')
  : '';

const apiMethods = [
  { preload: 'getState()', renderer: 'global.updateAPI.getState()', channel: 'update:get-state' },
  { preload: 'check(payload = {})', renderer: 'global.updateAPI.check({', channel: 'update:check' },
  { preload: 'downloadResourceUpdate()', renderer: 'global.updateAPI.downloadResourceUpdate()', channel: 'update:download-resource' },
  { preload: 'applyResourceUpdate()', renderer: 'global.updateAPI.applyResourceUpdate()', channel: 'update:apply-resource' },
  { preload: 'downloadShellUpdate()', renderer: 'global.updateAPI.downloadShellUpdate()', channel: 'update:download-shell' },
  { preload: 'quitAndInstall()', renderer: 'global.updateAPI.quitAndInstall()', channel: 'update:quit-and-install' }
];

for (const apiMethod of apiMethods) {
  if (!preloadText.includes(apiMethod.preload)) {
    throw new Error(`preload 缺少 updateAPI 方法: ${apiMethod.preload}`);
  }
  if (!rendererText.includes(apiMethod.renderer)) {
    throw new Error(`renderer 未消费 updateAPI 方法: ${apiMethod.renderer}`);
  }
  if (!mainText.includes(`ipcMain.handle('${apiMethod.channel}'`)) {
    throw new Error(`main 缺少 IPC channel: ${apiMethod.channel}`);
  }
}

if (!preloadText.includes('onStateChange') || !rendererText.includes('global.updateAPI.onStateChange(')) {
  throw new Error('update:state-changed 订阅契约不完整');
}
if (!mainText.includes("windowInstance.webContents.send('update:state-changed'")) {
  throw new Error('main 缺少 update:state-changed 事件派发');
}
if (!preloadText.includes("ipcRenderer.send('update:renderer-ready')")) {
  throw new Error('preload 缺少 renderer-ready 上报');
}
if (!mainText.includes("ipcMain.on('update:renderer-ready'")) {
  throw new Error('main 缺少 renderer-ready IPC 接收');
}
if (!bootRendererText.includes("'app-runtime-ready'")) {
  throw new Error('renderer 缺少 app-runtime-ready 启动完成事件');
}
if (!mainText.includes("did-start-loading")) {
  throw new Error('main 缺少启动恢复状态重置');
}
if (!mainText.includes("if (!shouldRollbackOnLoadFailure(errorCode, isMainFrame))")) {
  throw new Error('main 缺少主框架失败过滤逻辑');
}
if (!rendererText.includes('app-update-modal__close')) {
  throw new Error('更新弹窗必须使用专属关闭按钮类，不能复用全局 .modal-close');
}
if (rendererText.includes('<button class="modal-close"')) {
  throw new Error('更新弹窗关闭按钮仍在复用全局 .modal-close，容易污染其他弹窗');
}
if (settingsText && !settingsText.includes("delegate('click', '.settings-modal__close'")) {
  throw new Error('设置面板必须使用专属关闭委托，不能监听全局 .modal-close');
}
if (settingsText.includes("delegate('click', '.modal-close'")) {
  throw new Error('设置面板仍在监听全局 .modal-close，这会误伤其他弹窗');
}
if (keyboardShortcutsText && !keyboardShortcutsText.includes('.app-update-modal__close')) {
  throw new Error('快捷键关闭顶层弹窗时必须识别更新弹窗专属关闭按钮');
}
if (progressTrackerText.includes("document.querySelector('.modal-overlay.show')")) {
  throw new Error('ProgressTracker 不应再关闭第一个 modal-overlay.show，这会误伤顶层更新弹窗');
}

const requiredStatuses = [
  'idle',
  'checking',
  'up-to-date',
  'available',
  'downloading',
  'ready-to-reload',
  'ready-to-restart',
  'error'
];

for (const status of requiredStatuses) {
  if (!rendererText.includes(`'${status}'`)) {
    throw new Error(`renderer 缺少状态枚举: ${status}`);
  }
  if (!serviceText.includes(`'${status}'`)) {
    throw new Error(`updateService 缺少状态枚举: ${status}`);
  }
}

const workflowPath = '.github/workflows/release.yml';
const workflowText = fs.readFileSync(workflowPath, 'utf8');
const requiredWorkflowTokens = [
  'resources-manifest.json',
  'resources-delta.zip',
  'resources-full.zip',
  'release:build',
  'build:resource-release',
  'check:update-syntax',
  'verify:release-client-smoke',
  'verify:update-runtime',
  'verify:resource-release',
  'verify:resource-release-smoke',
  'verify:shell-release',
  'verify:shell-release-smoke',
  'verify:shell-support-smoke',
  'ielts-practice-*-windows-*-setup.exe',
  'ielts-practice-*-macos-*.dmg',
  'ielts-practice-*-macos-*.zip',
  'latest-mac.yml',
  'actions/upload-artifact@v4',
  'actions/download-artifact@v4',
  'gh release create',
  '--draft',
  'gh release edit',
  '--tag',
  '--clobber'
];

for (const token of requiredWorkflowTokens) {
  if (!workflowText.includes(token)) {
    throw new Error(`Release workflow 缺少关键资源发布约束: ${token}`);
  }
}

console.log('Resource release syntax checks passed.');
