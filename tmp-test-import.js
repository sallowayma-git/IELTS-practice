const fs = require('fs');
const vm = require('vm');

global.window = global;

const storageData = new Map();

function clone(value) {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

global.storage = {
  prefix: 'exam_system_',
  async get(key, defaultValue = null) {
    if (!storageData.has(key)) {
      return clone(defaultValue);
    }
    return clone(storageData.get(key));
  },
  async set(key, value) {
    storageData.set(key, clone(value));
    return true;
  },
  async remove(key) {
    storageData.delete(key);
    return true;
  }
};

global.fetch = async () => { throw new Error('fetch not implemented in test'); };

global.CustomEvent = function(name, detail) { return { name, detail }; };

global.window.dispatchEvent = function() {};

global.window.practiceRecorder = null;

global.console = console;

const code = fs.readFileSync('js/utils/dataBackupManager.js', 'utf-8');
vm.runInThisContext(code);

const manager = new global.DataBackupManager();

async function run() {
  await new Promise(resolve => setTimeout(resolve, 10));
  const json = fs.readFileSync('ielts_data_export_2025-09-22.json', 'utf-8');
  try {
    const result = await manager.importPracticeData(json, { mergeMode: 'replace', createBackup: false });
    console.log('Import result:', result);
    const records = await storage.get('practice_records', []);
    console.log('practice_records length:', Array.isArray(records) ? records.length : 'not array');
    console.log('First record keys:', Object.keys(records[0] || {}));
  } catch (err) {
    console.error('Import failed', err);
  }
}

run();
