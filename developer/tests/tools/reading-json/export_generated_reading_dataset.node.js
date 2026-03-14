#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const GENERATED_ROOT = path.join(REPO_ROOT, 'assets', 'generated', 'reading-exams');
const MANIFEST_PATH = path.join(GENERATED_ROOT, 'manifest.js');

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function parseArgs(argv) {
  const args = { examId: '', list: false };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--list') {
      args.list = true;
      continue;
    }
    if (token === '--exam-id') {
      args.examId = (argv[i + 1] || '').trim();
      i += 1;
      continue;
    }
  }
  return args;
}

function createRegistry() {
  const store = new Map();
  return {
    register(id, payload) {
      store.set(id, payload);
    },
    get(id) {
      return store.get(id) || null;
    },
    has(id) {
      return store.has(id);
    }
  };
}

function createContext() {
  const registry = createRegistry();
  const context = {
    console,
    setTimeout,
    clearTimeout
  };
  context.globalThis = context;
  context.window = context;
  context.self = context;
  context.__READING_EXAM_DATA__ = registry;
  vm.createContext(context);
  return { context, registry };
}

function loadManifest(context) {
  vm.runInContext(readText(MANIFEST_PATH), context, { filename: MANIFEST_PATH });
  const manifest = context.__READING_EXAM_MANIFEST__;
  if (!manifest || typeof manifest !== 'object') {
    fail('reading_manifest_missing_or_invalid');
  }
  return manifest;
}

function loadDataset(context, registry, manifestEntry) {
  if (!manifestEntry || !manifestEntry.script || !manifestEntry.dataKey) {
    fail('manifest_entry_invalid');
  }
  const scriptPath = path.join(GENERATED_ROOT, String(manifestEntry.script).replace(/^\.\//, ''));
  if (!fs.existsSync(scriptPath)) {
    fail(`reading_dataset_script_missing:${manifestEntry.script}`);
  }
  if (!registry.has(manifestEntry.dataKey)) {
    vm.runInContext(readText(scriptPath), context, { filename: scriptPath });
  }
  const dataset = registry.get(manifestEntry.dataKey);
  if (!dataset || typeof dataset !== 'object') {
    fail(`reading_dataset_missing:${manifestEntry.dataKey}`);
  }
  return dataset;
}

function buildEntryList(manifest) {
  return Object.values(manifest)
    .map((entry) => ({
      examId: entry.examId,
      dataKey: entry.dataKey,
      script: entry.script,
      title: entry.title || '',
      category: entry.category || ''
    }))
    .filter((entry) => entry.examId && entry.script && entry.dataKey)
    .sort((left, right) => String(left.examId).localeCompare(String(right.examId), 'en'));
}

function pickManifestEntry(manifest, examId) {
  if (!examId) return null;
  if (manifest[examId]) {
    return manifest[examId];
  }
  for (const entry of Object.values(manifest)) {
    if (entry && (entry.examId === examId || entry.dataKey === examId)) {
      return entry;
    }
  }
  return null;
}

function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    fail('reading_manifest_not_found');
  }

  const args = parseArgs(process.argv);
  const { context, registry } = createContext();
  const manifest = loadManifest(context);

  if (args.list) {
    process.stdout.write(`${JSON.stringify({ entries: buildEntryList(manifest) })}\n`);
    return;
  }

  if (!args.examId) {
    fail('missing_required_arg:--exam-id');
  }

  const entry = pickManifestEntry(manifest, args.examId);
  if (!entry) {
    fail(`reading_manifest_entry_not_found:${args.examId}`);
  }

  const dataset = loadDataset(context, registry, entry);
  const payload = {
    examId: dataset.examId || entry.examId || args.examId,
    questionOrder: Array.isArray(dataset.questionOrder) ? dataset.questionOrder : [],
    answerKey: dataset.answerKey && typeof dataset.answerKey === 'object' ? dataset.answerKey : {},
    questionGroups: Array.isArray(dataset.questionGroups) ? dataset.questionGroups : [],
    questionDisplayMap: dataset.questionDisplayMap && typeof dataset.questionDisplayMap === 'object'
      ? dataset.questionDisplayMap
      : {},
    meta: dataset.meta && typeof dataset.meta === 'object' ? dataset.meta : {},
    metaQuestionIntroHtml: dataset.meta && typeof dataset.meta.questionIntroHtml === 'string'
      ? dataset.meta.questionIntroHtml
      : '',
    script: entry.script
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

main();

