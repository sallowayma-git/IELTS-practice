#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import vm from 'vm';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const GENERATED_ROOT = path.join(REPO_ROOT, 'assets', 'generated', 'reading-exams');
const MANIFEST_PATH = path.join(GENERATED_ROOT, 'manifest.js');
const EXPLANATION_MANIFEST_PATH = path.join(GENERATED_ROOT, '../reading-explanations/manifest.js');

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function parseArgs(argv) {
  const args = { examId: '', list: false, outputDir: '' };
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
    if (token === '--output-dir') {
      args.outputDir = (argv[i + 1] || '').trim();
      i += 1;
      continue;
    }
  }
  return args;
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// Inline local diagrams in the immutable payload so both WebView reading
// surfaces can render them offline without a host-relative media URL.
function embedLocalMedia(value) {
  if (Array.isArray(value)) return value.map(embedLocalMedia);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, embedLocalMedia(item)]));
  }
  if (typeof value !== 'string') return value;
  return value.replace(/(<img\b[^>]*\bsrc\s*=\s*)(["'])(?:\.\/)?(media\/[^"']+)\2/gi,
    (_match, prefix, quote, relative) => {
      const mediaRoot = path.join(GENERATED_ROOT, 'media');
      const filename = path.resolve(GENERATED_ROOT, relative);
      if (!filename.startsWith(`${mediaRoot}${path.sep}`)) throw new Error(`invalid_reading_media:${relative}`);
      const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.svg': 'image/svg+xml' }[path.extname(filename).toLowerCase()];
      if (!mime) throw new Error(`unsupported_reading_media:${relative}`);
      return `${prefix}${quote}data:${mime};base64,${fs.readFileSync(filename).toString('base64')}${quote}`;
    });
}

function exportResourcePack(context, registry, manifest, outputDir) {
  const explanations = loadManifest(context, EXPLANATION_MANIFEST_PATH, '__READING_EXPLANATION_MANIFEST__');
  const resolvedOutput = path.resolve(REPO_ROOT, outputDir);
  const payloadDir = path.join(resolvedOutput, 'payloads');
  fs.mkdirSync(payloadDir, { recursive: true });

  // Keep the original payloads for retired IDs: existing draft/history answers
  // and SQLite content_ref paths still use these IDs after an upgrade.
  const retired = Object.keys(context.__READING_EXAM_ALIASES__ || {}).map((examId) => ({ examId, retired: true }));
  const entries = [...buildEntryList(manifest), ...retired].sort((a, b) => a.examId.localeCompare(b.examId, 'en')).map((entry) => {
    const dataset = entry.retired
      ? JSON.parse(readText(path.join(GENERATED_ROOT, 'retired', `${entry.examId}.json`)))
      : loadDataset(context, registry, manifest[entry.examId] || entry);
    const payload = { ...dataset, examId: dataset.examId || entry.examId };
    const explanationEntry = pickManifestEntry(explanations, entry.examId);
    if (explanationEntry) {
      payload.reviewExplanations = loadDataset(context, context.__READING_EXPLANATION_DATA__, explanationEntry);
    }
    const text = stableJson(embedLocalMedia(payload));
    const file = `payloads/${entry.examId}.json`;
    fs.writeFileSync(path.join(resolvedOutput, file), text, 'utf8');
    return {
      examId: entry.examId,
      file,
      title: entry.title || payload.meta?.title || entry.examId,
      category: entry.category || payload.meta?.category || null,
      difficulty: payload.meta?.difficulty || null,
      frequency: payload.meta?.frequency || null,
      sha256: sha256(text)
    };
  });

  const packManifest = {
    schemaVersion: 1,
    packId: 'ielts-reading-builtin-v1',
    assetCount: entries.length,
    entries
  };
  fs.writeFileSync(path.join(resolvedOutput, 'manifest.json'), stableJson(packManifest), 'utf8');
  process.stdout.write(`${JSON.stringify({ outputDir: resolvedOutput, assetCount: entries.length })}\n`);
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
  context.__READING_EXPLANATION_DATA__ = createRegistry();
  vm.createContext(context);
  return { context, registry };
}

function loadManifest(context, manifestPath = MANIFEST_PATH, manifestKey = '__READING_EXAM_MANIFEST__') {
  vm.runInContext(readText(manifestPath), context, { filename: manifestPath });
  const manifest = context[manifestKey];
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

  if (args.outputDir) {
    exportResourcePack(context, registry, manifest, args.outputDir);
    return;
  }

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

