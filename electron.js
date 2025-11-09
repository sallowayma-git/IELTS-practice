const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const express = require('express');
const Store = require('electron-store');

const store = new Store();

function createWindow(serverUrl) {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  });

  win.loadURL(serverUrl);
}

function setupServer(callback) {
  const server = express();
  const port = 3000; // Or a random free port

  // Serve the application files (HTML, CSS, JS)
  server.use(express.static(__dirname));

  // Check for the saved data path
  let dataPath = store.get('dataPath');

  const configureDataPath = (newPath) => {
    if (newPath) {
      console.log(`Serving data assets from: ${newPath}`);
      server.use(express.static(newPath));
      store.set('dataPath', newPath);
      if (callback) {
        callback(`http://localhost:${port}`);
      }
    } else {
      promptForDataPath();
    }
  };

  const promptForDataPath = () => {
    dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '请选择包含您题目资源的文件夹',
      message: '请选择包含您所有练习题目的根文件夹（例如，包含“睡着过项目组”和“ListeningPractice”的文件夹）。'
    }).then(result => {
      if (!result.canceled && result.filePaths.length > 0) {
        configureDataPath(result.filePaths[0]);
      } else {
        // Handle case where user cancels dialog
        dialog.showErrorBox('需要数据文件夹', '您必须选择一个数据文件夹才能使用该应用程序。请重新启动应用程序再试一次。');
        app.quit();
      }
    }).catch(err => {
      console.log(err);
      app.quit();
    });
  };

  if (dataPath) {
    configureDataPath(dataPath);
  } else {
    promptForDataPath();
  }

  server.listen(port, () => {
    console.log(`Electron server listening on http://localhost:${port}`);
  });
}

app.whenReady().then(() => {
  setupServer((serverUrl) => {
    createWindow(serverUrl);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      setupServer((serverUrl) => {
        createWindow(serverUrl);
      });
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
