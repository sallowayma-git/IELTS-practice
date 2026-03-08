#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const SHUI_ROOT = path.join(REPO_ROOT, '睡着过项目组', '2. 所有文章(11.20)[192篇]');
const IELTS_ROOT = path.join(REPO_ROOT, 'IELTS');
const INDEX_SCRIPT = path.join(REPO_ROOT, 'assets', 'scripts', 'complete-exam-data.js');
const SOURCE_DIR = path.join(REPO_ROOT, 'developer', 'reading-exams');
const GENERATED_DIR = path.join(REPO_ROOT, 'assets', 'generated', 'reading-exams');
const CROSSWALK_FILE = path.join(REPO_ROOT, 'developer', 'tests', 'fixtures', 'reading-crosswalk.json');
const PILOT_FILE = path.join(REPO_ROOT, 'developer', 'tests', 'fixtures', 'reading-pilot-selection.json');
const MIGRATION_REPORT_FILE = path.join(REPO_ROOT, 'developer', 'tests', 'fixtures', 'reading-migration-report.json');
const CROSSWALK_REVIEW_FILE = path.join(REPO_ROOT, 'developer', 'tests', 'fixtures', 'reading-crosswalk-review.json');

const ALLOWED_GROUP_KINDS = new Set([
    'single_choice',
    'multi_choice',
    'true_false_not_given',
    'yes_no_not_given',
    'matching',
    'classification',
    'summary_completion',
    'table_completion',
    'diagram_completion',
    'short_answer',
    'sentence_completion'
]);

const ANSWER_PATTERNS = [
    /(?:const|let|var)\s+correctAnswers\s*=\s*\{/g,
    /(?:const|let|var)\s+answerKey\s*=\s*\{/g,
    /(?:const|let|var)\s+answers\s*=\s*\{/g
];

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function readFile(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function writeJson(filePath, value) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(filePath, value) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, value, 'utf8');
}

function resetGeneratedDir(dirPath, preserveFileNames = new Set()) {
    ensureDir(dirPath);
    for (const fileName of fs.readdirSync(dirPath)) {
        if (preserveFileNames.has(fileName)) {
            continue;
        }
        fs.rmSync(path.join(dirPath, fileName), { recursive: true, force: true });
    }
}

function loadReadingIndex() {
    const context = { window: {} };
    vm.createContext(context);
    vm.runInContext(readFile(INDEX_SCRIPT), context, { filename: INDEX_SCRIPT });
    const items = context.window.completeExamIndex;
    if (!Array.isArray(items)) {
        throw new Error('无法从 complete-exam-data.js 读取阅读索引');
    }
    return items;
}

function walkHtmlFiles(rootDir) {
    const files = [];
    const stack = [rootDir];
    while (stack.length) {
        const current = stack.pop();
        const entries = fs.readdirSync(current, { withFileTypes: true });
        entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
        for (const entry of entries) {
            const nextPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(nextPath);
                continue;
            }
            if (!entry.isFile()) continue;
            if (!entry.name.toLowerCase().endsWith('.html')) continue;
            if (entry.name === 'Index.html') continue;
            files.push(nextPath);
        }
    }
    files.sort((a, b) => a.localeCompare(b, 'en'));
    return files;
}

function normalizeTitle(rawValue) {
    let value = path.basename(rawValue, path.extname(rawValue))
        .normalize('NFKC')
        .replace(/—/g, '-')
        .replace(/–/g, '-')
        .replace(/’/g, "'")
        .replace(/‘/g, "'")
        .replace(/“/g, '"')
        .replace(/”/g, '"')
        .replace(/^\d+\.\s*/, '')
        .replace(/^\[Pretest\]\s*/i, '')
        .replace(/^\d{4}纸笔\s*/, '')
        .replace(/^P[123]\s*-\s*/i, '')
        .replace(/^\(?无题目\)?\s*/i, '')
        .replace(/\s*[【\[].*?[】\]]/g, '')
        .replace(/\s+[\u4e00-\u9fff].*$/, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    return value;
}

function buildSignature(html) {
    const checks = {
        radio: /type=["']radio["']/i.test(html),
        checkbox: /type=["']checkbox["']/i.test(html),
        text: /type=["']text["']/i.test(html),
        textarea: /<textarea\b/i.test(html),
        select: /<select\b/i.test(html),
        dragdrop: /draggable|dropzone|drag-item|match-dropzone/i.test(html),
        table: /<table\b/i.test(html)
    };
    return Object.keys(checks).filter((key) => checks[key]);
}

function buildCrosswalk(readingIndex) {
    const ieltsByTitle = new Map();
    for (const filePath of walkHtmlFiles(IELTS_ROOT)) {
        const relPath = path.relative(REPO_ROOT, filePath).replace(/\\/g, '/');
        const key = normalizeTitle(path.basename(filePath));
        if (!ieltsByTitle.has(key)) {
            ieltsByTitle.set(key, []);
        }
        ieltsByTitle.get(key).push(relPath);
    }

    const shuiByTitle = new Map();
    for (const filePath of walkHtmlFiles(SHUI_ROOT)) {
        const relPath = path.relative(REPO_ROOT, filePath).replace(/\\/g, '/');
        const key = normalizeTitle(path.basename(filePath));
        if (!shuiByTitle.has(key)) {
            shuiByTitle.set(key, []);
        }
        shuiByTitle.get(key).push(relPath);
    }

    const rows = [];
    const readingIndexByPath = new Map();
    for (const item of readingIndex) {
        if (!item || !item.path || !item.filename) continue;
        const fullPath = path.join(item.path, item.filename).replace(/\\/g, '/');
        readingIndexByPath.set(fullPath, item);
    }

    const allTitles = new Set([...shuiByTitle.keys(), ...ieltsByTitle.keys()]);
    const sortedTitles = Array.from(allTitles).sort((a, b) => a.localeCompare(b, 'en'));

    for (const titleKey of sortedTitles) {
        const shuiPaths = shuiByTitle.get(titleKey) || [];
        const ieltsPaths = ieltsByTitle.get(titleKey) || [];
        const hasConflict = shuiPaths.length > 1 || ieltsPaths.length > 1;
        const status = hasConflict
            ? 'manual_review'
            : (shuiPaths.length && ieltsPaths.length
                ? 'matched'
                : (shuiPaths.length ? 'shui_only' : 'ielts_only'));
        const primaryShuiPath = shuiPaths[0] || null;
        const shuiHtml = primaryShuiPath ? readFile(path.join(REPO_ROOT, primaryShuiPath)) : '';
        const matchedIndex = primaryShuiPath ? readingIndexByPath.get(primaryShuiPath) || null : null;
        rows.push({
            normalizedTitle: titleKey,
            matchStatus: status,
            matchConfidence: status === 'matched' ? 1 : (status === 'manual_review' ? 0.5 : 0),
            shuiPath: primaryShuiPath,
            ieltsPath: ieltsPaths[0] || null,
            shuiPaths,
            ieltsPaths,
            signature: primaryShuiPath ? buildSignature(shuiHtml) : [],
            examId: matchedIndex ? matchedIndex.id : null
        });
    }

    return rows;
}

function selectPilotRows(crosswalk) {
    const seen = new Set();
    const pilots = [];
    const sorted = crosswalk
        .filter((row) => row.shuiPath && row.examId)
        .slice()
        .sort((a, b) => a.shuiPath.localeCompare(b.shuiPath, 'en'));

    for (const row of sorted) {
        const signatureKey = JSON.stringify(row.signature || []);
        if (seen.has(signatureKey)) continue;
        seen.add(signatureKey);
        pilots.push({
            examId: row.examId,
            shuiPath: row.shuiPath,
            ieltsPath: row.ieltsPath,
            signature: row.signature
        });
        if (pilots.length >= 12) break;
    }

    return pilots;
}

function selectBatchRows(crosswalk) {
    return crosswalk
        .filter((row) => row.shuiPath && row.examId)
        .slice()
        .sort((left, right) => {
            const leftPath = left.shuiPath || '';
            const rightPath = right.shuiPath || '';
            return leftPath.localeCompare(rightPath, 'en');
        });
}

function findMarkerIndex(source, marker) {
    if (typeof marker === 'string') {
        return source.indexOf(marker);
    }
    const match = marker.exec(source);
    return match ? match.index : -1;
}

function sliceSection(source, startMarker, endMarkers) {
    const startIndex = source.indexOf(startMarker);
    if (startIndex < 0) {
        throw new Error(`无法找到区块起点: ${startMarker}`);
    }
    const bodyStart = startIndex + startMarker.length;
    let endIndex = -1;
    for (const marker of endMarkers) {
        const markerIndex = findMarkerIndex(source.slice(bodyStart), typeof marker === 'string' ? marker : new RegExp(marker.source, marker.flags));
        if (markerIndex < 0) continue;
        const actualIndex = bodyStart + markerIndex;
        if (endIndex < 0 || actualIndex < endIndex) {
            endIndex = actualIndex;
        }
    }
    if (endIndex < 0) {
        throw new Error(`无法找到区块终点: ${startMarker}`);
    }
    return source.slice(bodyStart, endIndex).trim();
}

function sliceSectionByMarkers(source, startMarkers, endMarkers) {
    const markers = Array.isArray(startMarkers) ? startMarkers : [startMarkers];
    let lastError = null;
    for (const marker of markers) {
        try {
            return sliceSection(source, marker, endMarkers);
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error(`无法找到任何可用区块起点: ${markers.join(' | ')}`);
}

function extractPracticeLayout(source) {
    const leftHtml = sliceSectionByMarkers(source, [
        '<section class="pane" id="left">',
        '<div class="passage-pane" id="passage-pane">'
    ], [
        '<section class="pane" id="right">',
        '<div class="questions-pane" id="questions-pane">'
    ]);

    const rightHtml = sliceSectionByMarkers(source, [
        '<section class="pane" id="right">',
        '<div class="questions-pane" id="questions-pane">'
    ], [
        '<div id="results"',
        '<div class="practice-nav"',
        '<div class="bottom-bar"'
    ]);

    return { leftHtml, rightHtml };
}

function findBalancedBlock(source, startIndex, openToken = '<div', closeToken = '</div>') {
    let depth = 0;
    const tokenPattern = /<div\b|<\/div>/gi;
    tokenPattern.lastIndex = startIndex;
    let match;
    while ((match = tokenPattern.exec(source))) {
        if (match[0].startsWith('</')) {
            depth -= 1;
            if (depth === 0) {
                return match.index + match[0].length;
            }
            continue;
        }
        depth += 1;
    }
    return -1;
}

function extractGroupBlocks(rightHtml) {
    const groups = [];
    const groupStartPattern = /<div\s+class=["']group(?:\s+[^"']*)?["']/gi;
    const firstGroupMatch = groupStartPattern.exec(rightHtml);
    const firstGroupIndex = firstGroupMatch ? firstGroupMatch.index : -1;
    const introHtml = firstGroupIndex >= 0 ? rightHtml.slice(0, firstGroupIndex).trim() : rightHtml.trim();
    if (firstGroupIndex < 0) {
        return { introHtml, groups };
    }

    let cursor = firstGroupIndex;
    while (cursor >= 0 && cursor < rightHtml.length) {
        const searchPattern = /<div\s+class=["']group(?:\s+[^"']*)?["']/gi;
        searchPattern.lastIndex = cursor;
        const startMatch = searchPattern.exec(rightHtml);
        const startIndex = startMatch ? startMatch.index : -1;
        if (startIndex < 0) {
            break;
        }
        const endIndex = findBalancedBlock(rightHtml, startIndex);
        if (endIndex < 0) {
            throw new Error('无法提取题组 HTML，div 嵌套不平衡');
        }
        groups.push(rightHtml.slice(startIndex, endIndex).trim());
        cursor = endIndex;
    }

    return { introHtml, groups };
}

function extractObjectLiteral(source, patternList) {
    for (const pattern of patternList) {
        pattern.lastIndex = 0;
        const match = pattern.exec(source);
        if (!match) continue;
        const openBraceIndex = source.indexOf('{', match.index);
        if (openBraceIndex < 0) continue;
        let depth = 0;
        let inString = false;
        let stringQuote = '';
        let escaped = false;
        for (let index = openBraceIndex; index < source.length; index += 1) {
            const char = source[index];
            if (escaped) {
                escaped = false;
                continue;
            }
            if (inString) {
                if (char === '\\') {
                    escaped = true;
                } else if (char === stringQuote) {
                    inString = false;
                    stringQuote = '';
                }
                continue;
            }
            if (char === '"' || char === "'" || char === '`') {
                inString = true;
                stringQuote = char;
                continue;
            }
            if (char === '{') {
                depth += 1;
            } else if (char === '}') {
                depth -= 1;
                if (depth === 0) {
                    return source.slice(openBraceIndex, index + 1);
                }
            }
        }
    }
    return null;
}

function safeEvalObjectLiteral(literal) {
    if (!literal) return null;
    try {
        return vm.runInNewContext(`(${literal})`, {});
    } catch (error) {
        throw new Error(`无法解析答案对象: ${error.message}`);
    }
}

function normalizeQuestionId(rawValue) {
    if (rawValue == null) return null;
    const value = String(rawValue).trim().toLowerCase();
    if (!value) return null;
    const match = value.match(/q?(\d+)/);
    if (match) {
        return `q${match[1]}`;
    }
    return null;
}

function expandQuestionIds(rawValue) {
    if (rawValue == null) return [];
    const value = String(rawValue).trim().toLowerCase();
    if (!value) return [];
    const numbers = (value.match(/\d+/g) || []).map((entry) => Number(entry));
    if ((value.includes('-') || value.includes('–')) && numbers.length > 2) {
        return numbers.map((entry) => `q${entry}`);
    }
    if ((value.includes('-') || value.includes('–')) && numbers.length === 2 && numbers[1] >= numbers[0]) {
        const ids = [];
        for (let current = numbers[0]; current <= numbers[1]; current += 1) {
            ids.push(`q${current}`);
        }
        return ids;
    }
    if (value.includes('_') && numbers.length >= 2) {
        return numbers.map((entry) => `q${entry}`);
    }
    const single = normalizeQuestionId(value);
    return single ? [single] : [];
}

function extractOriginalQuestionNumber(rawValue) {
    if (rawValue == null) return null;
    const value = String(rawValue).trim().toLowerCase();
    const match = value.match(/q?(\d+)/);
    return match ? Number(match[1]) : null;
}

function normalizeAnswerValue(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => normalizeAnswerValue(entry)).filter((entry) => entry != null);
    }
    if (value == null) return '';
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    if (typeof value === 'number') {
        return String(value);
    }
    if (typeof value === 'object') {
        if (value.answer != null) return normalizeAnswerValue(value.answer);
        if (value.value != null) return normalizeAnswerValue(value.value);
        return JSON.stringify(value);
    }
    return String(value).trim();
}

function splitGroupedAnswerValues(rawValue, expectedCount) {
    if (!Number.isInteger(expectedCount) || expectedCount <= 1) {
        return null;
    }
    const normalizedValue = normalizeAnswerValue(rawValue);
    if (Array.isArray(normalizedValue)) {
        return normalizedValue.length === expectedCount ? normalizedValue : null;
    }
    const text = String(normalizedValue || '').trim();
    if (!text) {
        return new Array(expectedCount).fill('');
    }
    const separated = text
        .split(/\s*[,/|;]+\s*|\s+/)
        .map((entry) => entry.trim())
        .filter(Boolean);
    if (separated.length === expectedCount) {
        return separated;
    }
    const compact = text.replace(/\s+/g, '');
    if (/^[a-z]+$/i.test(compact) && compact.length === expectedCount) {
        return compact.split('');
    }
    return null;
}

function extractAnswerKey(source) {
    const literal = extractObjectLiteral(source, ANSWER_PATTERNS);
    const raw = safeEvalObjectLiteral(literal);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('未找到可用的答案键对象');
    }
    const answerKey = {};
    for (const [rawKey, rawValue] of Object.entries(raw)) {
        const expandedIds = expandQuestionIds(rawKey);
        if (!expandedIds.length) continue;
        if (expandedIds.length > 1) {
            const groupedValues = splitGroupedAnswerValues(rawValue, expandedIds.length);
            if (groupedValues) {
                expandedIds.forEach((questionId, index) => {
                    answerKey[questionId] = normalizeAnswerValue(groupedValues[index]);
                });
                continue;
            }
        }
        answerKey[expandedIds[0]] = normalizeAnswerValue(rawValue);
    }
    return answerKey;
}

function sortQuestionIds(questionIds) {
    return Array.from(new Set(questionIds.filter(Boolean))).sort((left, right) => {
        const normalize = (value) => {
            const match = String(value).match(/q(\d+)/i);
            return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
        };
        const diff = normalize(left) - normalize(right);
        return diff || String(left).localeCompare(String(right), 'en');
    });
}

function detectGroupKind(groupHtml) {
    const html = groupHtml || '';
    if (/paragraph-dropzone|match-dropzone|drag-item|headings-pool|options-pool/i.test(html)) {
        return /classification/i.test(html) ? 'classification' : 'matching';
    }
    if (/type=["']checkbox["']/i.test(html)) {
        return 'multi_choice';
    }
    if (/TRUE[\s\S]*FALSE[\s\S]*NOT GIVEN/i.test(html)) {
        return 'true_false_not_given';
    }
    if (/YES[\s\S]*NO[\s\S]*NOT GIVEN/i.test(html)) {
        return 'yes_no_not_given';
    }
    if (/<table\b/i.test(html)) {
        return 'table_completion';
    }
    if (/diagram|flow-chart|flow chart/i.test(html)) {
        return 'diagram_completion';
    }
    if (/summary/i.test(html)) {
        return 'summary_completion';
    }
    if (/type=["']radio["']/i.test(html)) {
        return 'single_choice';
    }
    if (/type=["']text["']/i.test(html)) {
        return 'sentence_completion';
    }
    return 'short_answer';
}

function extractQuestionIdsFromHtml(html) {
    const ids = [];
    const patterns = [
        /name=["'](q[\d_-]+)["']/gi,
        /data-question=["'](q[\d_-]+)["']/gi,
        /data-question-id=["'](q[\d_-]+)["']/gi,
        /id=["'](q\d+(?:[-_]\d+)*)(?:[-_](?:dropzone|anchor|input|nav))?["']/gi,
        /Question\s+(\d+)/gi,
        /Questions\s+(\d+)\s*[–-]\s*(\d+)/gi,
        /Questions\s+(\d+)\s+and\s+(\d+)/gi
    ];

    for (const pattern of patterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(html))) {
            if (match[2]) {
                const start = Number(match[1]);
                const end = Number(match[2]);
                for (let current = start; current <= end; current += 1) {
                    ids.push(`q${current}`);
                }
                continue;
            }
            const value = match[1];
            ids.push(...expandQuestionIds(value));
        }
    }

    return sortQuestionIds(ids);
}

function rewriteQuestionReferences(html, renumberMap) {
    let output = html;
    output = output.replace(/q\d+(?:\s*[_-]\s*\d+)+/gi, (fullMatch) => {
        const originalIds = expandQuestionIds(fullMatch);
        if (originalIds.length < 2) {
            return fullMatch;
        }
        const mappedIds = originalIds.map((questionId) => renumberMap.get(questionId)).filter(Boolean);
        if (mappedIds.length !== originalIds.length) {
            return fullMatch;
        }
        const separator = fullMatch.includes('_') ? '_' : '-';
        return mappedIds.reduce((result, questionId, index) => {
            if (index === 0) return questionId;
            return `${result}${separator}${questionId.replace(/^q/i, '')}`;
        }, '');
    });
    const pairs = Array.from(renumberMap.entries())
        .sort((left, right) => String(right[0]).length - String(left[0]).length);
    for (const [fromId, toId] of pairs) {
        const escaped = fromId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        output = output
            .replace(new RegExp(`name=["']${escaped}["']`, 'g'), (match) => match.replace(fromId, toId))
            .replace(new RegExp(`data-question=["']${escaped}["']`, 'g'), (match) => match.replace(fromId, toId))
            .replace(new RegExp(`data-question-id=["']${escaped}["']`, 'g'), (match) => match.replace(fromId, toId))
            .replace(new RegExp(`id=["']${escaped}-`, 'g'), (match) => match.replace(fromId, toId))
            .replace(new RegExp(`["']${escaped}["']`, 'g'), (match) => match.replace(fromId, toId));
    }
    return output;
}

function inferQuestionIdsFromHeading(groupHtml, originalToInternalMap) {
    const headingPatterns = [
        /Questions?\s+(\d+)\s*[–-]\s*(\d+)/gi,
        /Questions?\s+(\d+)\s+and\s+(\d+)/gi
    ];
    const ids = [];
    for (const pattern of headingPatterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(groupHtml))) {
            const start = Number(match[1]);
            const end = Number(match[2]);
            for (let current = start; current <= end; current += 1) {
                const mapped = originalToInternalMap.get(current);
                if (mapped) {
                    ids.push(mapped);
                }
            }
        }
    }
    return sortQuestionIds(ids);
}

function buildQuestionGroups(groupBlocks, introHtml, answerKey, originalToInternalMap, renumberMap) {
    const groups = [];
    let introAttached = false;
    for (let index = 0; index < groupBlocks.length; index += 1) {
        const bodyHtml = rewriteQuestionReferences(groupBlocks[index], renumberMap);
        const htmlQuestionIds = extractQuestionIdsFromHtml(bodyHtml);
        const headingQuestionIds = inferQuestionIdsFromHeading(groupBlocks[index], originalToInternalMap);
        const finalQuestionIds = sortQuestionIds([...htmlQuestionIds, ...headingQuestionIds])
            .filter((questionId) => Object.prototype.hasOwnProperty.call(answerKey, questionId));
        const group = {
            groupId: `group-${index + 1}`,
            kind: detectGroupKind(bodyHtml),
            questionIds: finalQuestionIds,
            bodyHtml
        };
        if (!ALLOWED_GROUP_KINDS.has(group.kind)) {
            throw new Error(`检测到不允许的题组类型: ${group.kind}`);
        }
        if (!introAttached && introHtml) {
            group.leadHtml = introHtml;
            introAttached = true;
        }
        groups.push(group);
    }
    if (!groups.length && introHtml) {
        groups.push({
            groupId: 'group-1',
            kind: 'short_answer',
            questionIds: sortQuestionIds(Object.keys(answerKey)),
            leadHtml: introHtml,
            bodyHtml: ''
        });
    }
    return groups;
}

function renumberAnswerKey(answerKey) {
    const originalIds = sortQuestionIds(Object.keys(answerKey));
    const normalizedAnswerKey = {};
    const renumberMap = new Map();
    const originalToInternalMap = new Map();
    const questionDisplayMap = {};

    originalIds.forEach((originalId, index) => {
        const nextId = `q${index + 1}`;
        renumberMap.set(originalId, nextId);
        const originalNumber = extractOriginalQuestionNumber(originalId);
        if (originalNumber != null) {
            originalToInternalMap.set(originalNumber, nextId);
            questionDisplayMap[nextId] = String(originalNumber);
        }
        normalizedAnswerKey[nextId] = normalizeAnswerValue(answerKey[originalId]);
    });

    return {
        answerKey: normalizedAnswerKey,
        renumberMap,
        originalToInternalMap,
        questionDisplayMap,
        questionOrder: sortQuestionIds(Object.keys(normalizedAnswerKey))
    };
}

function buildQuestionGroupsLegacy(groupBlocks, introHtml, answerKey) {
    const groups = [];
    let introAttached = false;
    for (let index = 0; index < groupBlocks.length; index += 1) {
        const bodyHtml = groupBlocks[index];
        const questionIds = extractQuestionIdsFromHtml(bodyHtml);
        const filteredQuestionIds = questionIds.length
            ? questionIds.filter((questionId) => Object.prototype.hasOwnProperty.call(answerKey, questionId) || /-/.test(questionId))
            : [];
        const group = {
            groupId: `group-${index + 1}`,
            kind: detectGroupKind(bodyHtml),
            questionIds: filteredQuestionIds,
            bodyHtml
        };
        if (!ALLOWED_GROUP_KINDS.has(group.kind)) {
            throw new Error(`检测到不允许的题组类型: ${group.kind}`);
        }
        if (!introAttached && introHtml) {
            group.leadHtml = introHtml;
            introAttached = true;
        }
        groups.push(group);
    }
    if (!groups.length && introHtml) {
        groups.push({
            groupId: 'group-1',
            kind: 'short_answer',
            questionIds: sortQuestionIds(Object.keys(answerKey)),
            leadHtml: introHtml,
            bodyHtml: ''
        });
    }
    return groups;
}

function buildSourceRecord(examEntry, pilotRow) {
    const shuiSource = readFile(path.join(REPO_ROOT, pilotRow.shuiPath));
    const { leftHtml, rightHtml } = extractPracticeLayout(shuiSource);
    const { introHtml, groups: groupBlocks } = extractGroupBlocks(rightHtml);
    const rawAnswerKey = extractAnswerKey(shuiSource);
    const {
        answerKey,
        renumberMap,
        originalToInternalMap,
        questionDisplayMap,
        questionOrder
    } = renumberAnswerKey(rawAnswerKey);
    const questionGroups = buildQuestionGroups(
        groupBlocks,
        introHtml,
        answerKey,
        originalToInternalMap,
        renumberMap
    );
    const normalizedLeftHtml = rewriteQuestionReferences(leftHtml, renumberMap);

    return {
        schemaVersion: 'ReadingExamSourceV1',
        examId: examEntry.id,
        meta: {
            title: examEntry.title,
            category: examEntry.category,
            frequency: examEntry.frequency,
            pdfFilename: examEntry.pdfFilename || '',
            legacyPath: examEntry.path,
            legacyFilename: examEntry.filename,
            questionIntroHtml: introHtml || ''
        },
        passage: {
            blocks: [
                {
                    blockId: 'passage-main',
                    kind: 'html',
                    html: normalizedLeftHtml
                }
            ]
        },
        questionGroups,
        answerKey,
        sourceRefs: {
            shuiHtml: pilotRow.shuiPath,
            shuiPdf: `${examEntry.path}${examEntry.pdfFilename || ''}`,
            ieltsHtml: pilotRow.ieltsPath || null
        },
        audit: {
            matchStatus: pilotRow.ieltsPath ? 'matched' : 'shui_only',
            matchConfidence: pilotRow.ieltsPath ? 1 : 0,
            verifiedAt: new Date().toISOString(),
            notes: `signature:${pilotRow.signature.join(',')}`
        },
        questionOrder,
        questionDisplayMap
    };
}

function buildManifest(sourceRecords) {
    const manifest = {};
    for (const record of sourceRecords) {
        manifest[record.examId] = {
            examId: record.examId,
            dataKey: record.examId,
            script: `../assets/generated/reading-exams/${record.examId}.js`,
            title: record.meta.title,
            category: record.meta.category
        };
    }
    return manifest;
}

function buildWrapper(record) {
    return [
        '(function registerReadingExamData(global) {',
        "  'use strict';",
        '  if (!global.__READING_EXAM_DATA__ || typeof global.__READING_EXAM_DATA__.register !== "function") {',
        '    throw new Error("reading_exam_registry_missing");',
        '  }',
        `  global.__READING_EXAM_DATA__.register(${JSON.stringify(record.examId)}, ${JSON.stringify(record, null, 2)});`,
        '})(typeof window !== "undefined" ? window : globalThis);',
        ''
    ].join('\n');
}

function writeSchemaFile() {
    const schema = {
        schemaVersion: 'ReadingExamSourceV1',
        requiredFields: [
            'schemaVersion',
            'examId',
            'meta',
            'passage',
            'questionGroups',
            'answerKey',
            'sourceRefs',
            'audit'
        ],
        allowedQuestionGroupKinds: Array.from(ALLOWED_GROUP_KINDS)
    };
    writeJson(path.join(SOURCE_DIR, 'reading-exam-source.schema.json'), schema);
}

function buildCrosswalkReviewReport(readingIndex, crosswalk, sourceRecords, failures) {
    const migratedExamIds = new Set(sourceRecords.map((record) => record.examId));
    const unmigratedReadingExams = readingIndex
        .filter((entry) => !migratedExamIds.has(entry.id))
        .map((entry) => ({
            examId: entry.id,
            title: entry.title,
            category: entry.category,
            frequency: entry.frequency,
            path: entry.path,
            filename: entry.filename,
            pdfFilename: entry.pdfFilename || '',
            reason: 'missing_shui_source_or_not_extracted'
        }));

    const lowConfidenceMatches = crosswalk
        .filter((row) => Number(row.matchConfidence || 0) < 1)
        .map((row) => ({
            normalizedTitle: row.normalizedTitle,
            matchStatus: row.matchStatus,
            matchConfidence: row.matchConfidence,
            examId: row.examId || null,
            shuiPath: row.shuiPath || null,
            ieltsPath: row.ieltsPath || null,
            shuiPaths: row.shuiPaths || [],
            ieltsPaths: row.ieltsPaths || []
        }));

    const conflictRows = crosswalk
        .filter((row) => row.matchStatus === 'manual_review' || (row.shuiPaths || []).length > 1 || (row.ieltsPaths || []).length > 1)
        .map((row) => ({
            normalizedTitle: row.normalizedTitle,
            examId: row.examId || null,
            matchStatus: row.matchStatus,
            shuiPaths: row.shuiPaths || [],
            ieltsPaths: row.ieltsPaths || [],
            reason: 'duplicate_match_candidates'
        }));

    const manualReviewQueue = [
        ...unmigratedReadingExams.map((entry) => ({
            reviewType: 'unmigrated_exam',
            examId: entry.examId,
            title: entry.title,
            category: entry.category,
            frequency: entry.frequency,
            path: `${entry.path}${entry.filename}`,
            reason: entry.reason
        })),
        ...lowConfidenceMatches.map((row) => ({
            reviewType: 'low_confidence_crosswalk',
            examId: row.examId,
            title: row.normalizedTitle,
            path: row.shuiPath || row.ieltsPath || '',
            reason: `${row.matchStatus}:${row.matchConfidence}`
        })),
        ...failures.map((failure) => ({
            reviewType: 'migration_failure',
            examId: failure.examId || null,
            title: failure.title || failure.shuiPath || failure.ieltsPath || 'unknown',
            path: failure.shuiPath || failure.ieltsPath || '',
            reason: failure.reason
        }))
    ];

    return {
        generatedAt: new Date().toISOString(),
        totalReadingExams: readingIndex.length,
        migratedCount: sourceRecords.length,
        unmigratedCount: unmigratedReadingExams.length,
        lowConfidenceCount: lowConfidenceMatches.length,
        conflictCount: conflictRows.length,
        manualReviewCount: manualReviewQueue.length,
        unmigratedReadingExams,
        lowConfidenceMatches,
        conflictRows,
        manualReviewQueue
    };
}

function main() {
    resetGeneratedDir(SOURCE_DIR);
    resetGeneratedDir(GENERATED_DIR);

    const readingIndex = loadReadingIndex();
    const crosswalk = buildCrosswalk(readingIndex);
    writeJson(CROSSWALK_FILE, crosswalk);

    const pilots = selectPilotRows(crosswalk);
    writeJson(PILOT_FILE, pilots);
    const batchRows = selectBatchRows(crosswalk);

    const indexById = new Map(readingIndex.map((entry) => [entry.id, entry]));
    const sourceRecords = [];
    const failures = [];
    for (const batchRow of batchRows) {
        const examEntry = indexById.get(batchRow.examId);
        if (!examEntry) {
            failures.push({
                examId: batchRow.examId || null,
                shuiPath: batchRow.shuiPath || null,
                ieltsPath: batchRow.ieltsPath || null,
                reason: 'missing_exam_index_entry'
            });
            continue;
        }

        try {
            const record = buildSourceRecord(examEntry, batchRow);
            writeJson(path.join(SOURCE_DIR, `${record.examId}.json`), record);
            writeText(path.join(GENERATED_DIR, `${record.examId}.js`), buildWrapper(record));
            sourceRecords.push(record);
        } catch (error) {
            failures.push({
                examId: examEntry.id,
                title: examEntry.title,
                shuiPath: batchRow.shuiPath || null,
                ieltsPath: batchRow.ieltsPath || null,
                reason: error && error.message ? error.message : String(error)
            });
        }
    }

    writeSchemaFile();

    const manifest = buildManifest(sourceRecords);
    writeText(
        path.join(GENERATED_DIR, 'manifest.js'),
        [
            '(function registerReadingExamManifest(global) {',
            "  'use strict';",
            `  global.__READING_EXAM_MANIFEST__ = ${JSON.stringify(manifest, null, 2)};`,
            '})(typeof window !== "undefined" ? window : globalThis);',
            ''
        ].join('\n')
    );

    const migrationReport = {
        generatedAt: new Date().toISOString(),
        totalReadingExams: readingIndex.length,
        totalShuiCandidates: batchRows.length,
        migratedCount: sourceRecords.length,
        failedCount: failures.length,
        migratedExamIds: sourceRecords.map((record) => record.examId).sort((a, b) => a.localeCompare(b, 'en')),
        failures
    };
    writeJson(MIGRATION_REPORT_FILE, migrationReport);
    writeJson(CROSSWALK_REVIEW_FILE, buildCrosswalkReviewReport(readingIndex, crosswalk, sourceRecords, failures));

    process.stdout.write(`Generated ${sourceRecords.length} reading exam assets. Failed: ${failures.length}.\n`);
}

main();
