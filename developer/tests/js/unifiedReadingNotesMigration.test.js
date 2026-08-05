#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const page = fs.readFileSync(path.join(root, 'js/runtime/unifiedReadingPage.js'), 'utf8');
const highlights = fs.readFileSync(path.join(root, 'js/runtime/readingHighlightShared.js'), 'utf8');

assert.match(highlights, /noteId:\s*node\.dataset/);
assert.match(highlights, /offsetSpan\.dataset\.noteId\s*=\s*String\(record\.noteId\)/);
assert.match(highlights, /span\.dataset\.noteId\s*=\s*String\(record\.noteId\)/);

for (const [field, collector] of [['notes', 'collectNotes'], ['noteOutlines', 'collectNoteOutlines'], ['markedQuestions', 'getCurrentMarkedQuestions']]) {
    assert.match(page, new RegExp(`${field}: ${collector}`, 'm'), `${field} must be collected into drafts/submissions`);
    assert.match(page, new RegExp(`${field}: normalize`, 'm'), `${field} must be normalized at payload boundaries`);
}

assert.match(page, /if \(state\.reviewMode\) \{[\s\S]*postMessage\('READING_ANNOTATION_SYNC'/);
assert.match(page, /postMessage\('READING_DRAFT_SYNC'/);
assert.match(page, /function canSyncReadingDraft\(\)/);
assert.match(page, /attachReadingDraftLifecycleHooks/);
assert.match(page, /recordId:\s*state\.reviewRecordId/);
assert.match(page, /annotations:\s*\{[\s\S]*highlights:[\s\S]*noteText:[\s\S]*notes:[\s\S]*noteOutlines:[\s\S]*markedQuestions:[\s\S]*scrollY:/);
assert.match(page, /state\.reviewRecordId\s*=\s*String\(data\.recordId \|\| entry\.id/);
assert.match(page, /function canEditReadingNotes\(\)[\s\S]*!state\.readOnly[\s\S]*!state\.timerLocked[\s\S]*!state\.memorizeMode[\s\S]*!state\.submitted/);
assert.match(page, /const canEditNotes = canEditReadingNotes\(\)/);
assert.match(page, /control\.closest\('#reading-note-editor, #reading-note-drawer'\)/);
assert.match(page, /syncReadingAnnotation\('highlight'\)/);
assert.match(page, /function clearStructuredNotesForReset\(\)[\s\S]*\.hl\[data-note-id\], \.hl\[data-hl-type="note"\]/);
assert.match(page, /#reading-note-drawer\{[^}]*z-index:3600/);
assert.match(page, /#reading-note-editor\{[^}]*z-index:3700/);
assert.match(page, /data-result-question-id/);
assert.match(page, /displayUserAnswer:\s*selectedTokens\.length/);

assert.doesNotMatch(page, /saveLocalReadingRecord|ExamSystemDB|exam_system_practice_records|indexedDB/i);

console.log(JSON.stringify({
    status: 'pass',
    detail: 'structured notes, note anchors, review sync, display controls and safe storage boundaries covered'
}));
