import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const ECDICT_SOURCE = path.join(root, 'developer', 'tmp', 'ecdict.csv');
const READING_EXAMS_DIR = path.join(root, 'assets', 'generated', 'reading-exams');
const IELTS_CORE_JSON = path.join(root, 'assets', 'wordlists', 'ielts_core.json');
const OUTPUT_PATH = path.join(root, 'assets', 'wordlists', 'ecdict_reading.bundle.js');

const COMMON_STOPWORDS = new Set([
    'the', 'and', 'for', 'that', 'with', 'from', 'this', 'have', 'has', 'had',
    'are', 'was', 'were', 'been', 'being', 'will', 'would', 'could', 'should',
    'not', 'but', 'you', 'your', 'their', 'they', 'them', 'then', 'than', 'into',
    'onto', 'over', 'under', 'about', 'because', 'which', 'when', 'where', 'what',
    'who', 'whose', 'how', 'can', 'may', 'might', 'must', 'shall', 'also', 'such',
    'more', 'most', 'some', 'any', 'each', 'many', 'much', 'one', 'two', 'three',
    'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'all', 'both',
    'reading', 'passage', 'question', 'questions', 'answer', 'answers', 'following',
    'statement', 'statements', 'write', 'boxes', 'minutes', 'true', 'false', 'given',
    'yes', 'no', 'list', 'below', 'above', 'paragraph', 'paragraphs'
]);

function decodeHtmlEntities(text) {
    return String(text || '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/gi, "'")
        .replace(/&#(\d+);/g, (_, code) => {
            const value = Number(code);
            return Number.isFinite(value) ? String.fromCharCode(value) : ' ';
        });
}

function stripHtml(html) {
    return decodeHtmlEntities(html)
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ');
}

function collectReadingWords() {
    const words = new Set();
    const files = fs.readdirSync(READING_EXAMS_DIR)
        .filter((file) => file.endsWith('.js') && file !== 'manifest.js')
        .sort();

    files.forEach((file) => {
        const source = fs.readFileSync(path.join(READING_EXAMS_DIR, file), 'utf8');
        const htmlMatches = source.matchAll(/"html"\s*:\s*"((?:\\.|[^"\\])*)"/g);
        for (const match of htmlMatches) {
            let html = match[1];
            try {
                html = JSON.parse(`"${match[1]}"`);
            } catch (_) {
                // Keep the raw escaped string. The token pass still works for ASCII words.
            }
            const plain = stripHtml(html).toLowerCase();
            const tokens = plain.match(/[a-z][a-z'-]{2,}/g) || [];
            tokens.forEach((token) => {
                const word = token.replace(/^'+|'+$/g, '').replace(/'s$/g, '');
                if (word.length >= 3 && !COMMON_STOPWORDS.has(word)) {
                    words.add(word);
                }
            });
        }
    });
    return words;
}

function collectIeltsWords() {
    try {
        const payload = JSON.parse(fs.readFileSync(IELTS_CORE_JSON, 'utf8'));
        if (!Array.isArray(payload)) {
            return new Set();
        }
        return new Set(payload
            .map((entry) => String(entry && entry.word || '').trim().toLowerCase())
            .filter(Boolean));
    } catch (error) {
        console.warn('[build-ecdict] IELTS core list unavailable:', error.message);
        return new Set();
    }
}

function parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === '"') {
            if (inQuotes && line[index + 1] === '"') {
                current += '"';
                index += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }
        if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
            continue;
        }
        current += char;
    }
    result.push(current);
    return result;
}

function normalizeTranslation(value) {
    return String(value || '')
        .replace(/\\n/g, '\n')
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 4)
        .join('；');
}

function normalizeDefinition(value) {
    return String(value || '')
        .replace(/\\n/g, '\n')
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 3)
        .join('; ');
}

function normalizeTags(value) {
    return String(value || '')
        .split(/\s+/)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 8);
}

function shouldInclude(word, tags, targetWords, ieltsWords) {
    if (targetWords.has(word) || ieltsWords.has(word)) {
        return true;
    }
    return tags.some((tag) => tag === 'ielts' || tag === 'toefl' || tag === 'cet6' || tag === 'ky');
}

function buildDictionary() {
    if (!fs.existsSync(ECDICT_SOURCE)) {
        throw new Error(`Missing ECDICT CSV: ${ECDICT_SOURCE}. Download https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv first.`);
    }

    const targetWords = collectReadingWords();
    const ieltsWords = collectIeltsWords();
    const source = fs.readFileSync(ECDICT_SOURCE, 'utf8');
    const lines = source.split(/\r?\n/);
    const header = parseCsvLine(lines.shift() || '');
    const index = new Map(header.map((name, i) => [name, i]));
    const entries = [];

    lines.forEach((line) => {
        if (!line || !line.trim()) {
            return;
        }
        const fields = parseCsvLine(line);
        const word = String(fields[index.get('word')] || '').trim().toLowerCase();
        if (!/^[a-z][a-z0-9 .'-]{1,64}$/.test(word)) {
            return;
        }
        const tags = normalizeTags(fields[index.get('tag')]);
        if (!shouldInclude(word, tags, targetWords, ieltsWords)) {
            return;
        }
        const translation = normalizeTranslation(fields[index.get('translation')]);
        const definition = normalizeDefinition(fields[index.get('definition')]);
        if (!translation && !definition) {
            return;
        }
        const entry = {
            w: word,
            t: translation,
            d: definition
        };
        const phonetic = String(fields[index.get('phonetic')] || '').trim();
        const pos = String(fields[index.get('pos')] || '').trim();
        const collins = Number(fields[index.get('collins')]);
        const bnc = Number(fields[index.get('bnc')]);
        const frq = Number(fields[index.get('frq')]);
        const exchange = String(fields[index.get('exchange')] || '').trim();
        if (phonetic) entry.p = phonetic;
        if (pos) entry.pos = pos;
        if (tags.length) entry.tags = tags;
        if (Number.isFinite(collins) && collins > 0) entry.c = collins;
        if (Number.isFinite(bnc) && bnc > 0) entry.b = bnc;
        if (Number.isFinite(frq) && frq > 0) entry.f = frq;
        if (exchange) entry.x = exchange;
        entries.push(entry);
    });

    entries.sort((a, b) => a.w.localeCompare(b.w));
    return {
        source: {
            name: 'ECDICT',
            url: 'https://github.com/skywind3000/ECDICT',
            license: 'MIT',
            derivedAt: new Date().toISOString(),
            selection: 'Current reading-exam vocabulary + existing IELTS core list + ECDICT IELTS/TOEFL/CET6/KY tagged entries'
        },
        entries
    };
}

function writeBundle(payload) {
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    const json = JSON.stringify(payload.entries);
    const source = [
        '(function registerECDICTReadingDictionary(global) {',
        "    'use strict';",
        '    var root = global || globalThis;',
        '    var dictionaries = root.__LOCAL_DICTIONARIES__ || {};',
        `    dictionaries.ecdict = { source: ${JSON.stringify(payload.source)}, entries: ${json} };`,
        '    root.__LOCAL_DICTIONARIES__ = dictionaries;',
        "})(typeof window !== 'undefined' ? window : globalThis);",
        ''
    ].join('\n');
    fs.writeFileSync(OUTPUT_PATH, source, 'utf8');
}

const payload = buildDictionary();
writeBundle(payload);
console.log(`ECDICT reading dictionary entries: ${payload.entries.length}`);
console.log(`Wrote ${path.relative(root, OUTPUT_PATH)}`);
