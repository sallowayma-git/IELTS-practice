#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const vocabReaderPath = path.join(root, 'js/components/readingVocabReader.js');
const vocabReaderSource = fs.readFileSync(vocabReaderPath, 'utf8');

// 1. 验证 ReadingVocabStore.add 支持 highlight 存储，且能够保存选区实例位置信息
assert.match(
    vocabReaderSource,
    /add\(rawWord,\s*examId,\s*examTitle,\s*context\s*=\s*'',\s*highlight\s*=\s*null\)/,
    'ReadingVocabStore.add must accept highlight metadata parameter'
);

assert.match(
    vocabReaderSource,
    /highlights:\s*highlight\s*\?\s*\[highlight\]\s*:\s*\[\]/,
    'New vocab items must initialize highlights array with highlight parameter'
);

assert.match(
    vocabReaderSource,
    /item\.highlights\.push\(highlight\)/,
    'Existing vocab items must append new highlight instances'
);

// 2. 验证 handleSelectionCapture 仅高亮当前选中的具体单词实例，不执行全篇盲匹配
assert.match(
    vocabReaderSource,
    /const locInfo = this\.calculateRangeLocation\(scopeElement,\s*trimmedRange,\s*text\);/,
    'Must calculate exact range location within scopeElement'
);

assert.match(
    vocabReaderSource,
    /const wrappedMark = this\.wrapRangeWithHighlight\(trimmedRange,\s*cleanWord\);/,
    'Must wrap ONLY the trimmedRange with highlight'
);

// 确保在划词捕获时绝不调用全局 applyVocabHighlights (这曾是全篇所有相同单词都被高亮的根本原因)
const captureBlock = vocabReaderSource.match(/const handleSelectionCapture = \(\) => \{([\s\S]*?)\n                \};/)?.[1] || '';
assert.ok(captureBlock.length > 0, 'handleSelectionCapture must exist');
assert.doesNotMatch(
    captureBlock,
    /this\.applyVocabHighlights\(/,
    'handleSelectionCapture must NOT trigger global applyVocabHighlights across the whole text'
);

// 3. 验证 applyVocabHighlights 是基于保存的实例元数据精确恢复单处高亮，而非全篇盲目正则
assert.match(
    vocabReaderSource,
    /this\.restoreVocabHighlight\(overlay,\s*hl,\s*item\.word\)/,
    'applyVocabHighlights must restore each highlight record individually'
);

assert.doesNotMatch(
    vocabReaderSource,
    /new RegExp\(`\(\$\{patternParts\.join\('\|'\)\}\)`,\s*'gi'\)/,
    'Global regex multi-match replacement over entire document must be removed'
);

// 4. 验证删除单词时针对性清理该单词的高亮 mark
assert.match(
    vocabReaderSource,
    /this\.removeVocabHighlightForWord\(word\)/,
    'Deleting a word must specifically remove only that word marks'
);

// 5. 模拟验证实例定位算法：当文本中出现多个相同单词时，精准命中目标实例
function simulateResolveInstance(fullText, targetWord, targetOccurrence) {
    const lowerFull = fullText.toLowerCase();
    const lowerWord = targetWord.toLowerCase();
    let currentOccurrence = 0;
    let pos = 0;
    let matchPos = -1;
    while ((matchPos = lowerFull.indexOf(lowerWord, pos)) !== -1) {
        if (currentOccurrence === targetOccurrence) {
            return { start: matchPos, end: matchPos + targetWord.length };
        }
        currentOccurrence += 1;
        pos = matchPos + 1;
    }
    return null;
}

const sampleArticle = "Clean water is essential for life, but contaminated water causes severe diseases. Stored water must be protected.";
// 文中有 3 个 "water":
// 0: offset 6..11 ("Clean water")
// 1: offset 52..57 ("contaminated water")
// 2: offset 87..92 ("Stored water")
const hit0 = simulateResolveInstance(sampleArticle, "water", 0);
const hit1 = simulateResolveInstance(sampleArticle, "water", 1);
const hit2 = simulateResolveInstance(sampleArticle, "water", 2);

assert.strictEqual(hit0.start, 6);
assert.strictEqual(hit0.end, 11);
assert.strictEqual(hit1.start, 52);
assert.strictEqual(hit1.end, 57);
assert.strictEqual(hit2.start, 89);
assert.strictEqual(hit2.end, 94);

// 验证命中第 1 个（第二个出现）时，只定位第 1 个，而不影响第 0 和第 2 个
assert.notStrictEqual(hit1.start, hit0.start);
assert.notStrictEqual(hit1.start, hit2.start);

// 6. 验证 header 右侧的生词本按钮已被移除，保留右下角悬浮 FAB 按钮
assert.doesNotMatch(
    vocabReaderSource,
    /id="vocab-open-modal-btn"/,
    'Right header vocab-open-modal-btn must be removed'
);

assert.match(
    vocabReaderSource,
    /id="vocab-fab"/,
    'Floating vocab FAB must be preserved'
);

// 7. 验证段落切换 Tab 生成文案为 "Para ${b.letter}"，并完全陈列展开
assert.match(
    vocabReaderSource,
    /Para \$\{b\.letter\}/,
    'Tab button text must use English abbreviation Para ${b.letter}'
);

const vocabCssPath = path.join(root, 'css/vocab-reader.css');
const vocabCssSource = fs.readFileSync(vocabCssPath, 'utf8');

// 8. 验证 CSS 中 tabs 样式已移除滑动限制并支持 flex-wrap 陈列
assert.match(
    vocabCssSource,
    /\.vocab-reader-tabs\s*\{[\s\S]*?flex-wrap:\s*wrap;/m,
    'Tabs must use flex-wrap: wrap for complete expansion without horizontal scrolling'
);

assert.doesNotMatch(
    vocabCssSource,
    /\.vocab-reader-tabs\s*\{[\s\S]*?overflow-x:\s*auto;/m,
    'Tabs must NOT use overflow-x: auto'
);

console.log(JSON.stringify({
    status: 'pass',
    detail: 'Reading vocab highlight and layout customization verified'
}));
