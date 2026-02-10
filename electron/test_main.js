console.log('process.versions:', process.versions);
console.log('process.type:', process.type);

// Try to require electron
let electron;
try {
  electron = require('electron');
  console.log('electron module:', typeof electron);
  console.log('electron keys:', Object.keys(electron).slice(0, 10));
} catch (e) {
  console.log('Error requiring electron:', e.message);
}

// Check if we're in Electron main process
if (process.versions.electron) {
  console.log('Running in Electron!');
  console.log('Electron version:', process.versions.electron);
}

// Try destructuring
try {
  const { app, BrowserWindow } = require('electron');
  console.log('app:', typeof app);
  console.log('BrowserWindow:', typeof BrowserWindow);
} catch (e) {
  console.log('Error destructuring:', e.message);
}
