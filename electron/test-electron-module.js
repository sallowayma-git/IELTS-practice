// 测试 Electron 模块导出
console.log('=== Electron Module Test ===');
console.log('process.versions.electron:', process.versions.electron);
console.log('process.versions.node:', process.versions.node);

try {
    const electron = require('electron');
    console.log('\nrequire("electron") result:');
    console.log('  typeof:', typeof electron);
    console.log('  value:', electron);

    if (typeof electron === 'object') {
        console.log('  keys:', Object.keys(electron).slice(0, 20));
        console.log('  electron.app:', electron.app);
        console.log('  electron.BrowserWindow:', electron.BrowserWindow);
    }
} catch (e) {
    console.error('Error requiring electron:', e.message);
}

// 等待一下让输出完成
setTimeout(() => process.exit(0), 500);
