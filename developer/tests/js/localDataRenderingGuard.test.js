#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const vocabSource = fs.readFileSync(path.join(repoRoot, 'js/components/vocabSessionView.js'), 'utf8');
assert(
    vocabSource.includes('function toFiniteNumber') &&
    vocabSource.includes('function toNonNegativeInteger') &&
    vocabSource.includes('function formatDecimal'),
    'vocab feedback rendering must normalize numeric fields before HTML interpolation'
);
assert(
    !vocabSource.includes('const intervalDays = word.interval || 1;'),
    'vocab feedback must not interpolate word.interval directly'
);
assert(
    !vocabSource.includes('const repetitions = word.repetitions || 0;'),
    'vocab feedback must not interpolate word.repetitions directly'
);
assert(
    !vocabSource.includes('const easeFactor = finalEF.toFixed(2);'),
    'vocab feedback must not call toFixed on untrusted raw values'
);
assert(
    vocabSource.includes('escapeHtml(toNonNegativeInteger(word.interval, 1)') &&
    vocabSource.includes('escapeHtml(toNonNegativeInteger(word.repetitions, 0)'),
    'vocab feedback display values must be escaped before entering innerHTML'
);
assert(
    vocabSource.includes('const safeNextReview = escapeHtml(nextReview)') &&
    vocabSource.includes('将于 ${safeNextReview} 再次复习') &&
    !vocabSource.includes('<p>将于 ${nextReview} 再次复习</p>'),
    'vocab feedback review time must be escaped before entering innerHTML'
);
assert(
    vocabSource.includes('const safeRecognitionLabel = escapeHtml(recognitionLabel)') &&
    vocabSource.includes('const safeAdjustment = escapeHtml(adjustment)') &&
    vocabSource.includes('${safeRecognitionLabel}') &&
    vocabSource.includes('${safeAdjustment}') &&
    !vocabSource.includes('${recognitionLabel}') &&
    !vocabSource.includes('${adjustment}'),
    'vocab feedback labels and EF adjustment text must be escaped before entering innerHTML'
);
assert(
    vocabSource.includes('MAX_SPELLING_ANSWER_LENGTH = 160') &&
    vocabSource.includes('function limitSpellingAnswer') &&
    vocabSource.includes('function normalizeSpellingAnswer'),
    'vocab spelling answers must have a single bounded normalization path'
);
assert(
    vocabSource.includes('maxlength="${MAX_SPELLING_ANSWER_LENGTH}"') &&
    vocabSource.includes('value="${escapeHtml(limitSpellingAnswer(session.typedAnswer))}"') &&
    vocabSource.includes('const limited = limitSpellingAnswer(event.target.value)') &&
    vocabSource.includes('state.session.typedAnswer = limited'),
    'vocab spelling input must cap and normalize typed answer state before rendering'
);
assert(
    vocabSource.includes('const answer = normalizeSpellingAnswer(input.value)') &&
    vocabSource.includes('typed: normalizeSpellingAnswer(options.answer ?? session.typedAnswer)') &&
    vocabSource.includes('const s = normalizeSpellingAnswer(a).toLowerCase()') &&
    vocabSource.includes('const normalizedAnswer = normalizeSpellingAnswer(input)'),
    'vocab spelling submit, feedback, and comparison paths must use bounded answers'
);
assert(
    vocabSource.includes('function sanitizeDownloadFilename') &&
    vocabSource.includes('anchor.download = sanitizeDownloadFilename(filename)') &&
    vocabSource.includes('WINDOWS_RESERVED_DOWNLOAD_BASENAME_PATTERN') &&
    vocabSource.includes(".replace(/[. ]+$/g, '')") &&
    vocabSource.includes('`_${text}`') &&
    !vocabSource.includes('anchor.download = filename;'),
    'vocab progress exports must sanitize generated filenames and Windows reserved basenames before assigning anchor.download'
);

const achievementsSource = fs.readFileSync(path.join(repoRoot, 'js/services/achievementManager.js'), 'utf8');
assert(
    achievementsSource.includes('function renderAchievementCard') &&
    achievementsSource.includes('normalizeTierClass'),
    'achievement modal must render cards through DOM helpers and normalize tier CSS classes'
);
assert(
    achievementsSource.includes("node.textContent = text == null ? '' : String(text)") &&
    achievementsSource.includes("card.appendChild(createAchievementTextNode('span', 'achievement-icon', achievement.icon))") &&
    achievementsSource.includes("card.appendChild(createAchievementTextNode('div', 'achievement-title', achievement.title))") &&
    achievementsSource.includes("card.appendChild(createAchievementTextNode('div', 'achievement-desc', achievement.description))"),
    'achievement modal must assign achievement content through textContent'
);
assert(
    !achievementsSource.includes('list.innerHTML = all.map') &&
    !achievementsSource.includes('escapeHtml(a.icon)') &&
    !achievementsSource.includes('escapeHtml(a.title)') &&
    !achievementsSource.includes('escapeHtml(a.description)'),
    'achievement modal must not interpolate achievement content through innerHTML templates'
);
assert(
    achievementsSource.includes('MAX_STORED_UNLOCKED_ACHIEVEMENTS = 200') &&
    achievementsSource.includes("UNSAFE_UNLOCKED_STATE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])") &&
    achievementsSource.includes('_normalizeUnlockedState(value)') &&
    achievementsSource.includes('return this._normalizeUnlockedState(value)') &&
    achievementsSource.includes('this.unlocked = this._normalizeUnlockedState(this.unlocked)'),
    'achievement unlocked state must strip unsafe keys and unknown IDs before use or persistence'
);

const practiceHistoryEnhancerSource = fs.readFileSync(path.join(repoRoot, 'js/components/practiceHistoryEnhancer.js'), 'utf8');
assert(
    !practiceHistoryEnhancerSource.includes('onclick="'),
    'practice history export dialog must not use inline onclick handlers'
);
assert(
    practiceHistoryEnhancerSource.includes('data-action="export-dialog-close"') &&
    practiceHistoryEnhancerSource.includes('data-action="export-dialog-submit"') &&
    practiceHistoryEnhancerSource.includes("dialog.addEventListener('click'"),
    'practice history export dialog actions must be delegated through event listeners'
);
assert(
    practiceHistoryEnhancerSource.includes('setTimeout(() => URL.revokeObjectURL(url), 0)'),
    'practice history downloads must delay object URL revocation until after the click dispatch'
);
assert(
    practiceHistoryEnhancerSource.includes('MAX_RECORD_LOOKUP_ID_LENGTH = 200') &&
    practiceHistoryEnhancerSource.includes('normalizeRecordLookupId(value)') &&
    practiceHistoryEnhancerSource.includes('this.escapeHtml(this.normalizeRecordLookupId(record && record.id))') &&
    practiceHistoryEnhancerSource.includes('if (!targetIdStr)') &&
    practiceHistoryEnhancerSource.includes('return null;'),
    'practice history record detail lookups must reject oversized or invalid record ids before DOM rendering and scans'
);
assert(
    practiceHistoryEnhancerSource.includes('MAX_JSON_EXPORT_RECORDS = 5000') &&
    practiceHistoryEnhancerSource.includes('MAX_JSON_EXPORT_NODES = 50000') &&
    practiceHistoryEnhancerSource.includes("JSON_EXPORT_POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor'])") &&
    practiceHistoryEnhancerSource.includes('createSafeJsonExportPayload(records, stats)') &&
    practiceHistoryEnhancerSource.includes('sanitizeJsonExportValue(value, depth = 0') &&
    practiceHistoryEnhancerSource.includes("return '[Circular]'") &&
    practiceHistoryEnhancerSource.includes('const data = this.createSafeJsonExportPayload(practiceRecords, practiceStats);'),
    'practice history fallback JSON exports must cap records, strip pollution keys, and tolerate circular data'
);

const performanceOptimizerSource = fs.readFileSync(path.join(repoRoot, 'js/components/PerformanceOptimizer.js'), 'utf8');
assert(
    performanceOptimizerSource.includes('function resolveTrustedImagePreloadUrl') &&
    performanceOptimizerSource.includes('resolved.origin === currentOrigin') &&
    performanceOptimizerSource.includes('/^data:image\\/(?:png|jpe?g|gif|webp);base64,/i') &&
    performanceOptimizerSource.includes('const safeUrls = (Array.isArray(imageUrls) ? imageUrls : [])') &&
    !performanceOptimizerSource.includes('const promises = imageUrls.map(url =>'),
    'performance image preloading must reject cross-origin and non-image URLs before assigning img.src'
);

const dataManagementPanelSource = fs.readFileSync(path.join(repoRoot, 'js/components/dataManagementPanel.js'), 'utf8');
assert(
    dataManagementPanelSource.includes('const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024') &&
    dataManagementPanelSource.includes('function validateImportFile(file)') &&
    dataManagementPanelSource.includes("accept: '.json,application/json'"),
    'data management imports must limit file size and only accept JSON files'
);
assert(
    dataManagementPanelSource.includes('function sanitizeDownloadFilename') &&
    dataManagementPanelSource.includes('function normalizeDownloadMimeType') &&
    dataManagementPanelSource.includes('const safeFilename = sanitizeDownloadFilename(filename);') &&
    dataManagementPanelSource.includes('const safeMimeType = normalizeDownloadMimeType(mimeType);') &&
    dataManagementPanelSource.includes('WINDOWS_RESERVED_DOWNLOAD_BASENAME_PATTERN') &&
    dataManagementPanelSource.includes(".replace(/[. ]+$/g, '')") &&
    dataManagementPanelSource.includes('`_${value}`'),
    'data management downloads must sanitize filenames, Windows reserved basenames, and MIME types'
);
assert(
    dataManagementPanelSource.includes('setTimeout(() => URL.revokeObjectURL(url), 0)') &&
    !dataManagementPanelSource.includes('a.download = filename;') &&
    !dataManagementPanelSource.includes("accept: '.json,.csv'"),
    'data management downloads must use sanitized names and delayed object URL revocation'
);
assert(
    dataManagementPanelSource.includes('function isUnsafeElementAttributeName') &&
    dataManagementPanelSource.includes('function isUnsafeElementUrlAttribute') &&
    dataManagementPanelSource.includes('function isUnsafeElementObjectKey') &&
    dataManagementPanelSource.includes('isUnsafeElementAttributeName(key) || isUnsafeElementUrlAttribute(key, value, el.tagName)') &&
    dataManagementPanelSource.includes('!isUnsafeElementObjectKey(key)') &&
    !dataManagementPanelSource.includes('el.setAttribute(key, options.attrs[key]);') &&
    !dataManagementPanelSource.includes('el.dataset[key] = options.dataset[key];'),
    'data management element helper must skip unsafe attributes, URLs, and dataset keys'
);
assert(
    dataManagementPanelSource.includes("console.log('[DataManagementPanel] importPracticeData returned:', {") &&
    dataManagementPanelSource.includes('importedCount: Number(result && result.importedCount) || 0') &&
    !dataManagementPanelSource.includes("console.log('[DataManagementPanel] importPracticeData returned:', result)"),
    'data import diagnostics must log whitelisted result counters only'
);

const dataIntegrityManagerSource = fs.readFileSync(path.join(repoRoot, 'js/components/DataIntegrityManager.js'), 'utf8');
assert(
    dataIntegrityManagerSource.includes('setTimeout(() => URL.revokeObjectURL(url), 0)') &&
    !dataIntegrityManagerSource.includes('URL.revokeObjectURL(url);\n            console.log'),
    'data integrity exports must delay object URL revocation until after the click dispatch'
);
assert(
    dataIntegrityManagerSource.includes('DEFAULT_MAX_IMPORT_SOURCE_BYTES = 10 * 1024 * 1024') &&
    dataIntegrityManagerSource.includes('normalizeImportSourceByteLimit(options.maxImportSourceBytes)') &&
    dataIntegrityManagerSource.includes('_assertImportSourceSize(getTextByteLength(source), \'string\')') &&
    dataIntegrityManagerSource.includes("typeof Blob !== 'undefined'") &&
    dataIntegrityManagerSource.includes("_assertImportSourceSize(source.byteLength, 'arrayBuffer')"),
    'data integrity imports must cap string, Blob/File, and ArrayBuffer sources before JSON parsing'
);

const dataBackupManagerSource = fs.readFileSync(path.join(repoRoot, 'js/utils/dataBackupManager.js'), 'utf8');
assert(
    dataBackupManagerSource.includes('allowFetch = false') &&
    dataBackupManagerSource.includes('Boolean(allowFetch)') &&
    dataBackupManagerSource.includes('function resolveTrustedImportFetchUrl') &&
    dataBackupManagerSource.includes('resolved.origin === currentOrigin') &&
    dataBackupManagerSource.includes('fetch(fetchUrl, { credentials: \'same-origin\', cache: \'no-store\' })') &&
    !dataBackupManagerSource.includes('parseImportSource(source, { allowFetch: true })') &&
    !dataBackupManagerSource.includes('fetch(trimmed)'),
    'backup imports must not fetch arbitrary string sources unless explicitly enabled'
);
assert(
    dataBackupManagerSource.includes('function formatCsvCell') &&
    dataBackupManagerSource.includes('/^\\s*[=+\\-@]/') &&
    dataBackupManagerSource.includes('row.map(formatCsvCell).join'),
    'backup CSV exports must neutralize spreadsheet formula prefixes'
);
assert(
    dataBackupManagerSource.includes('MAX_BACKUP_IMPORT_RECORDS = 5000') &&
    dataBackupManagerSource.includes('MAX_BACKUP_IMPORT_NODES = 50000') &&
    dataBackupManagerSource.includes('collectedArrays.has(records)') &&
    dataBackupManagerSource.includes('Import contains too many practice records'),
    'backup imports must cap record count, traversal size, and avoid collecting the same record array twice'
);

const scoreStorageSource = fs.readFileSync(path.join(repoRoot, 'js/core/scoreStorage.js'), 'utf8');
assert(
    scoreStorageSource.includes('function formatScoreCsvCell') &&
    scoreStorageSource.includes('/^\\s*[=+\\-@]/') &&
    scoreStorageSource.includes('row.map(formatScoreCsvCell).join'),
    'score storage CSV exports must neutralize spreadsheet formula prefixes'
);
assert(
    scoreStorageSource.includes('MAX_SCORE_IMPORT_SOURCE_BYTES = 10 * 1024 * 1024') &&
    scoreStorageSource.includes('assertScoreImportStringSize(importData)') &&
    scoreStorageSource.includes('records.length > this.maxRecords') &&
    scoreStorageSource.includes('mergedPreview.size > this.maxRecords'),
    'score storage imports must cap string size, direct record count, and merged record count'
);

const bootFallbacksSource = fs.readFileSync(path.join(repoRoot, 'js/boot-fallbacks.js'), 'utf8');
assert(
    bootFallbacksSource.includes('MAX_FALLBACK_IMPORT_FILE_BYTES') &&
    bootFallbacksSource.includes('function validateFallbackJsonFile') &&
    bootFallbacksSource.includes('validateFallbackJsonFile(inputFile)'),
    'legacy import fallback must validate JSON import files before FileReader reads them'
);

const listeningRecordBridgeSource = fs.readFileSync(path.join(repoRoot, 'js/listeningRecordBridge.js'), 'utf8');
assert(
    listeningRecordBridgeSource.includes('function parseGeneratedResultsHtml') &&
    listeningRecordBridgeSource.includes("new DOMParser().parseFromString(html, 'text/html')") &&
    listeningRecordBridgeSource.includes('var s2 = parseGeneratedResultsHtml(html)'),
    'listening result bridge must parse generated result HTML with DOMParser before reading table data'
);
assert(
    !listeningRecordBridgeSource.includes('tempDiv.innerHTML = html'),
    'listening result bridge must not inject generated result HTML through innerHTML'
);

const practicePageEnhancerSource = fs.readFileSync(path.join(repoRoot, 'js/practice-page-enhancer.js'), 'utf8');
assert(
    practicePageEnhancerSource.includes('const safeCorrect = escapeHtml(scoreInfo.correct ?? 0)') &&
    practicePageEnhancerSource.includes('const safeTotal = escapeHtml(scoreInfo.total ?? 0)') &&
    practicePageEnhancerSource.includes('const safePercentage = escapeHtml(scoreInfo.percentage ?? 0)') &&
    practicePageEnhancerSource.includes('得分 ${safeCorrect} / ${safeTotal} · ${safePercentage}%') &&
    !practicePageEnhancerSource.includes('得分 ${results.scoreInfo?.correct ?? 0}'),
    'practice replay fallback summary scores must be escaped before entering innerHTML'
);

const unifiedReadingPageSource = fs.readFileSync(path.join(repoRoot, 'js/runtime/unifiedReadingPage.js'), 'utf8');
assert(
    unifiedReadingPageSource.includes('function normalizeResultNumber(value, fallback = 0)') &&
    unifiedReadingPageSource.includes('const fallbackNumber = Number(fallback)') &&
    unifiedReadingPageSource.includes('return Number.isFinite(fallbackNumber) ? fallbackNumber : 0') &&
    unifiedReadingPageSource.includes('const safeCorrect = escapeHtml(normalizeResultNumber(scoreInfo.correct, 0))') &&
    unifiedReadingPageSource.includes('const safeTotalQuestions = escapeHtml(normalizeResultNumber(scoreInfo.totalQuestions, scoreInfo.total || 0))') &&
    unifiedReadingPageSource.includes('const safePercentage = escapeHtml(normalizeResultNumber(scoreInfo.percentage, 0))') &&
    unifiedReadingPageSource.includes('得分 ${safeCorrect} / ${safeTotalQuestions} · ${safePercentage}%') &&
    !unifiedReadingPageSource.includes('得分 ${results.scoreInfo.correct} / ${results.scoreInfo.totalQuestions}'),
    'unified reading replay summary scores must normalize and escape scoreInfo before entering innerHTML'
);

const hpPortalSource = fs.readFileSync(path.join(repoRoot, 'js/plugins/hp/hp-portal.js'), 'utf8');
assert(
    hpPortalSource.includes('MAX_HP_IMPORT_FILE_BYTES') &&
    hpPortalSource.includes('MAX_HP_IMPORT_ITEMS = 5000') &&
    hpPortalSource.includes('HP_IMPORT_POLLUTION_KEYS') &&
    hpPortalSource.includes('function validateHpJsonFile') &&
    hpPortalSource.includes('function sanitizeHpImportValue') &&
    hpPortalSource.includes('function sanitizeHpImportList') &&
    hpPortalSource.includes('validateHpJsonFile(file)') &&
    hpPortalSource.includes('examIndex: sanitizeHpImportList(exams)') &&
    hpPortalSource.includes('practiceRecords: sanitizeHpImportList(records)') &&
    hpPortalSource.includes('setTimeout(() => URL.revokeObjectURL(url), 0)'),
    'HP portal backup import/export must validate files, sanitize imported arrays, and delay object URL revocation'
);

const hpCoreBridgeSource = fs.readFileSync(path.join(repoRoot, 'js/plugins/hp/hp-core-bridge.js'), 'utf8');
assert(
    hpCoreBridgeSource.includes("PRACTICE_MESSAGE_POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor'])") &&
    hpCoreBridgeSource.includes('MAX_PRACTICE_MESSAGE_DEPTH = 16') &&
    hpCoreBridgeSource.includes('function sanitizePracticeMessageValue(value, depth, state)') &&
    hpCoreBridgeSource.includes('raw: sanitizePracticeMessageValue(payload) || {}') &&
    hpCoreBridgeSource.includes('realData: normalized.raw || {}') &&
    !hpCoreBridgeSource.includes('realData: normalized.raw || payload || {}'),
    'HP practice record fallback must sanitize postMessage payloads before persisting realData'
);

const themeAdapterBaseSource = fs.readFileSync(path.join(repoRoot, 'js/plugins/themes/theme-adapter-base.js'), 'utf8');
assert(
    themeAdapterBaseSource.includes("PRACTICE_MESSAGE_POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor'])") &&
    themeAdapterBaseSource.includes('MAX_PRACTICE_MESSAGE_DEPTH = 16') &&
    themeAdapterBaseSource.includes('function sanitizePracticeMessageValue(value, depth, state)') &&
    themeAdapterBaseSource.includes('function normalizePracticeRecordForStorage(record, options = {})') &&
    themeAdapterBaseSource.includes('raw: sanitizePracticeMessageValue(payload) || {}') &&
    themeAdapterBaseSource.includes('const normalizedRecord = normalizePracticeRecordForStorage(record, { ensureTimestamp: true });') &&
    themeAdapterBaseSource.includes('.map(record => normalizePracticeRecordForStorage(record))') &&
    themeAdapterBaseSource.includes('this._practiceRecords = deduplicateRecords(normalizedRecords);') &&
    themeAdapterBaseSource.includes('realData: sanitizePracticeMessageValue(rawPayload) || {}') &&
    !themeAdapterBaseSource.includes('realData: rawPayload') &&
    !themeAdapterBaseSource.includes('normalizedRecord.realData = sanitizePracticeMessageValue(normalizedRecord.realData) || {};'),
    'theme adapter practice record fallback must sanitize postMessage payloads and locally loaded records before use'
);

const vocabDataIoSource = fs.readFileSync(path.join(repoRoot, 'js/utils/vocabDataIO.js'), 'utf8');
assert(
    vocabDataIoSource.includes('MAX_VOCAB_IMPORT_FILE_BYTES') &&
    vocabDataIoSource.includes('MAX_VOCAB_IMPORT_ENTRIES = 5000') &&
    vocabDataIoSource.includes('MAX_WORD_TEXT_LENGTH = 160') &&
    vocabDataIoSource.includes('MAX_MEANING_TEXT_LENGTH = 4000') &&
    vocabDataIoSource.includes('function validateVocabImportFile') &&
    vocabDataIoSource.includes('function normalizeTextField') &&
    vocabDataIoSource.includes('function limitImportItems') &&
    vocabDataIoSource.includes('const items = limitImportItems(payload)') &&
    vocabDataIoSource.includes('const words = limitImportItems(payload.words)') &&
    vocabDataIoSource.includes('const rowLimit = Math.min(lines.length, MAX_VOCAB_IMPORT_ENTRIES + 1)') &&
    vocabDataIoSource.includes('validateVocabImportFile(file)'),
    'vocab imports must validate file size, extension, MIME type, entry count, and text field lengths before reading or normalizing large payloads'
);

const vocabStoreSource = fs.readFileSync(path.join(repoRoot, 'js/core/vocabStore.js'), 'utf8');
assert(
    vocabStoreSource.includes('MAX_STORED_VOCAB_WORDS = 5000') &&
    vocabStoreSource.includes('MAX_WORD_TEXT_LENGTH = 160') &&
    vocabStoreSource.includes('MAX_METADATA_JSON_CHARS = 8000') &&
    vocabStoreSource.includes('function normalizeExtraValue') &&
    vocabStoreSource.includes('listWords\\n            .slice(0, MAX_STORED_VOCAB_WORDS)'.replace(/\\n/g, '\n')),
    'vocab store must cap stored list size and normalize long imported word fields'
);

const spellingErrorCollectorSource = fs.readFileSync(path.join(repoRoot, 'js/app/spellingErrorCollector.js'), 'utf8');
assert(
    spellingErrorCollectorSource.includes('MAX_SPELLING_VOCAB_WORDS = 5000') &&
    spellingErrorCollectorSource.includes('SPELLING_IMPORT_POLLUTION_KEYS') &&
    spellingErrorCollectorSource.includes('cloneSafeObject(value)') &&
    spellingErrorCollectorSource.includes('normalizeStoredWordEntry(entry)') &&
    spellingErrorCollectorSource.includes('normalizeStoredWords(words)') &&
    spellingErrorCollectorSource.includes('words: this.normalizeStoredWords(rawList)') &&
    spellingErrorCollectorSource.includes('const safeList = this.cloneSafeObject(rawList)') &&
    spellingErrorCollectorSource.includes('return this.normalizeStoredWordEntry({'),
    'spelling error vocab lists must cap restored word count and strip unsafe imported keys'
);

const practiceRecordModalSource = fs.readFileSync(path.join(repoRoot, 'js/components/practiceRecordModal.js'), 'utf8');
assert(
    practiceRecordModalSource.includes('function sanitizeFilenamePart') &&
    practiceRecordModalSource.includes('practice_record_${sanitizeFilenamePart(recordId)}_') &&
    practiceRecordModalSource.includes('setTimeout(() => URL.revokeObjectURL(url), 0)') &&
    !practiceRecordModalSource.includes('practice_record_${recordId}_'),
    'single-record exports must sanitize record IDs before using them in download filenames'
);
assert(
    practiceRecordModalSource.includes('MAX_MODAL_ANSWER_ROWS = 500') &&
    practiceRecordModalSource.includes('MAX_MODAL_ANSWER_TEXT_LENGTH = 200') &&
    practiceRecordModalSource.includes('MAX_MODAL_ANSWER_DEPTH = 6') &&
    practiceRecordModalSource.includes('.slice(0, MAX_MODAL_ANSWER_ROWS)') &&
    practiceRecordModalSource.includes('if (depth > MAX_MODAL_ANSWER_DEPTH)') &&
    practiceRecordModalSource.includes('safeCloneObject(value)') &&
    practiceRecordModalSource.includes('this.safeCloneObject(record.answerComparison || {})') &&
    practiceRecordModalSource.includes('this.safeCloneObject(answerComparison)') &&
    practiceRecordModalSource.includes('this.truncateAnswer(rawUserAnswer, MAX_MODAL_ANSWER_TEXT_LENGTH)') &&
    practiceRecordModalSource.includes('this.truncateAnswer(rawCorrectAnswer, MAX_MODAL_ANSWER_TEXT_LENGTH)'),
    'practice record modal must cap rendered answer rows/text and safely clone imported comparison data'
);

const markdownExporterSource = fs.readFileSync(path.join(repoRoot, 'js/utils/markdownExporter.js'), 'utf8');
assert(
    markdownExporterSource.includes('setTimeout(() => URL.revokeObjectURL(url), 0)') &&
    markdownExporterSource.includes('escapeMarkdownText(value, maxLength = 200)') &&
    markdownExporterSource.includes(".replace(/</g, '&lt;')") &&
    markdownExporterSource.includes('const displayTitle = this.escapeMarkdownText(this.normalizeTitle(') &&
    markdownExporterSource.includes('return this.escapeMarkdownText(text, 100);'),
    'markdown exports must delay object URL revocation and escape user-controlled markdown/HTML text'
);

const examActionsSource = fs.readFileSync(path.join(repoRoot, 'js/app/examActions.js'), 'utf8');
assert(
    examActionsSource.includes("a.download = 'practice-records.json'") &&
    examActionsSource.includes('setTimeout(() => URL.revokeObjectURL(url), 0)'),
    'exam actions fallback exports must delay object URL revocation until after the click dispatch'
);

assert(
    practicePageEnhancerSource.includes('function summarizeAnswerValueForLog') &&
    practicePageEnhancerSource.includes('function summarizeAnswerMapForLog') &&
    practicePageEnhancerSource.includes('function summarizeAnswerComparisonForLog') &&
    !practicePageEnhancerSource.includes("derived_questionId='${questionId}', value='${value}'") &&
    !practicePageEnhancerSource.includes('value=${value}, questionId=') &&
    !practicePageEnhancerSource.includes('= ${answer}`') &&
    practicePageEnhancerSource.includes("console.log('[PracticeEnhancer] 生成答案比较:', summarizeAnswerComparisonForLog(comparison))") &&
    !practicePageEnhancerSource.includes("console.log('[PracticeEnhancer] 生成答案比较:', comparison)") &&
    !practicePageEnhancerSource.includes("console.log('用户答案:', window.practicePageEnhancer.answers)") &&
    !practicePageEnhancerSource.includes("console.log('正确答案:', window.practicePageEnhancer.correctAnswers)") &&
    !practicePageEnhancerSource.includes("console.log('答案比较:', window.practicePageEnhancer.generateAnswerComparison())"),
    'practice page enhancer console diagnostics must summarize answers instead of logging answer text'
);

const mainSource = fs.readFileSync(path.join(repoRoot, 'js/main.js'), 'utf8');
assert(
    mainSource.includes('recordCount: Array.isArray(detail && detail.records) ? detail.records.length : undefined') &&
    !mainSource.includes("console.log('[System] 收到存储同步事件，正在更新练习记录...', event.detail)"),
    'storage sync diagnostics must not dump raw event details'
);

const practiceRecorderSource = fs.readFileSync(path.join(repoRoot, 'js/core/practiceRecorder.js'), 'utf8');
assert(
    practiceRecorderSource.includes('function summarizeAnswerObjectForLog') &&
    practiceRecorderSource.includes("console.warn('[PracticeRecorder] 无法从对象中提取有效答案值:', summarizeAnswerObjectForLog(value))") &&
    !practiceRecorderSource.includes("console.warn('[PracticeRecorder] 无法从对象中提取有效答案值:', value)"),
    'practice recorder warnings must not log raw answer objects'
);

const storageSource = fs.readFileSync(path.join(repoRoot, 'js/utils/storage.js'), 'utf8');
assert(
    storageSource.includes('sanitizeDownloadFilename(filename, fallback)') &&
    storageSource.includes('const finalFilename = this.sanitizeDownloadFilename(filename || defaultFilename, defaultFilename)') &&
    storageSource.includes('WINDOWS_RESERVED_DOWNLOAD_BASENAME_PATTERN') &&
    storageSource.includes(".replace(/[. ]+$/g, '')") &&
    storageSource.includes('`_${finalFilename}`') &&
    storageSource.includes('setTimeout(() => URL.revokeObjectURL(url), 0)') &&
    !storageSource.includes('link.download = filename;') &&
    !storageSource.includes('URL.revokeObjectURL(url);\n\n            console.log'),
    'storage exports must sanitize download filenames, Windows reserved basenames, and delay object URL revocation'
);

const examSessionMixinSource = fs.readFileSync(path.join(repoRoot, 'js/app/examSessionMixin.js'), 'utf8');
assert(
    !examSessionMixinSource.includes('onclick="'),
    'exam session result and session templates must not use inline onclick handlers'
);
assert(
    examSessionMixinSource.includes('data-exam-modal-action="open-exam"') &&
    examSessionMixinSource.includes('data-exam-modal-action="focus-session"') &&
    examSessionMixinSource.includes("document.addEventListener('click', (event) => {"),
    'exam session modal actions must be handled through delegated event listeners'
);
assert(
    examSessionMixinSource.includes('const safeExamTitle = escapeHtml(exam.title || \'\');') &&
    examSessionMixinSource.includes('const safeSessionTitle = escapeHtml(exam ? exam.title :') &&
    !examSessionMixinSource.includes('<h4>${exam.title}</h4>') &&
    !examSessionMixinSource.includes("${exam ? exam.title : '未知题目'}"),
    'exam session templates must escape exam titles before HTML interpolation'
);

const templateBaseSource = fs.readFileSync(path.join(repoRoot, 'templates/template_base.html'), 'utf8');
assert(
    templateBaseSource.includes('function escapeResultHtml(value)') &&
    templateBaseSource.includes('${escapeResultHtml(userAnswer || \'None\')}') &&
    !templateBaseSource.includes('${userAnswer || \'None\'} ${isCorrect'),
    'base exam template must escape free-text answers before rendering score output with innerHTML'
);
assert(
    templateBaseSource.includes('function copySafeHighlightAttributes(sourceNode, targetNode)') &&
    templateBaseSource.includes('isSafeHighlightAttributeName(attr.name)') &&
    templateBaseSource.includes("normalized === 'srcdoc'") &&
    templateBaseSource.includes("normalized.indexOf('on') === 0") &&
    templateBaseSource.includes('copySafeHighlightAttributes(node, wrapper)') &&
    !templateBaseSource.includes('wrapper.setAttribute(attr.name, attr.value)'),
    'base exam template highlight cloning must whitelist copied attributes instead of preserving arbitrary event or URL attributes'
);

const analysisOfFearFixtureSource = fs.readFileSync(path.join(repoRoot, 'templates/ci-practice-fixtures/analysis-of-fear.html'), 'utf8');
assert(
    analysisOfFearFixtureSource.includes('function escapeResultHtml(value)') &&
    analysisOfFearFixtureSource.includes('${escapeResultHtml(userAnswerDisplay)}') &&
    analysisOfFearFixtureSource.includes('${escapeResultHtml(correctAnswer)}') &&
    !analysisOfFearFixtureSource.includes('<td>${userAnswerDisplay}</td>'),
    'CI practice fixture must escape free-text answers before rendering results tables with innerHTML'
);

const overviewViewSource = fs.readFileSync(path.join(repoRoot, 'js/views/overviewView.js'), 'utf8');
assert(
    overviewViewSource.includes("document.createElementNS('http://www.w3.org/2000/svg', 'svg')") &&
    overviewViewSource.includes("document.createElementNS('http://www.w3.org/2000/svg', 'path')"),
    'overview SVG icons must be constructed with DOM APIs'
);
assert(
    !overviewViewSource.includes('span.innerHTML = `<svg'),
    'overview SVG icons must not interpolate raw SVG strings into innerHTML'
);

const moreViewSource = fs.readFileSync(path.join(repoRoot, 'js/presentation/moreView.js'), 'utf8');
assert(
    moreViewSource.includes('function createClockColon') &&
    moreViewSource.includes("replace(/[^a-z0-9_-]/gi, '')") &&
    moreViewSource.includes('state.container.appendChild(createClockColon(colonClass))'),
    'digital clock rendering must create colon nodes and sanitize optional classes'
);
assert(
    !moreViewSource.includes("state.container.innerHTML = '' + hours + colonMarkup"),
    'digital clock rendering must not interpolate colonClass into innerHTML'
);

const reviewHighlightDictionarySource = fs.readFileSync(path.join(repoRoot, 'js/runtime/reviewHighlightDictionary.js'), 'utf8');
assert(
    reviewHighlightDictionarySource.includes('function appendTextElement') &&
    reviewHighlightDictionarySource.includes('function appendSection') &&
    reviewHighlightDictionarySource.includes('bubble.replaceChildren(renderLookup(activeLookup))'),
    'review highlight dictionary bubble must construct dynamic lookup content with DOM APIs'
);
assert(
    !reviewHighlightDictionarySource.includes('bubble.innerHTML = renderLookup(activeLookup)') &&
    !reviewHighlightDictionarySource.includes('function escapeHtml'),
    'review highlight dictionary bubble must not depend on innerHTML string rendering for lookup data'
);
assert(
    reviewHighlightDictionarySource.includes('MAX_STORED_HIGHLIGHT_WORDS = 5000') &&
    reviewHighlightDictionarySource.includes('MAX_WORD_TEXT_LENGTH = 160') &&
    reviewHighlightDictionarySource.includes('function normalizeContextValue') &&
    reviewHighlightDictionarySource.includes("CONTEXT_POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor'])") &&
    reviewHighlightDictionarySource.includes('tags: normalizeTags(lookup.tags)') &&
    reviewHighlightDictionarySource.includes('context: normalizeContextValue(context) || {}') &&
    reviewHighlightDictionarySource.includes('list.words = list.words.slice(-MAX_STORED_HIGHLIGHT_WORDS)'),
    'review highlight dictionary fallback writes must cap list size, field lengths, tags, context, and pollution keys'
);

const onboardingTourSource = fs.readFileSync(path.join(repoRoot, 'js/components/onboardingTour.js'), 'utf8');
assert(
    onboardingTourSource.includes('_appendTextElement(parent, tagName, className, text)') &&
    onboardingTourSource.includes('_createActionButton(action, text, modifierClass)') &&
    onboardingTourSource.includes('this._tooltip.replaceChildren(progress, title, content, actions)') &&
    onboardingTourSource.includes('this._tooltip.replaceChildren(welcome)'),
    'onboarding tooltip content must be built with DOM APIs'
);
assert(
    !onboardingTourSource.includes('this._tooltip.innerHTML = `') &&
    !onboardingTourSource.includes('function escapeHtml'),
    'onboarding tooltip must not render configurable step text through innerHTML'
);

const goalManagerSource = fs.readFileSync(path.join(repoRoot, 'js/core/goalManager.js'), 'utf8');
assert(
    goalManagerSource.includes('function isAllowedGoalType') &&
    goalManagerSource.includes('function normalizeGoalList') &&
    goalManagerSource.includes('MAX_STORED_GOALS = 100') &&
    goalManagerSource.includes('return value.slice(0, MAX_STORED_GOALS).map(normalizeGoal).filter(Boolean)') &&
    goalManagerSource.includes('function normalizeStreak') &&
    goalManagerSource.includes('this.goals = normalizeGoalList(await window.storage.get(STORAGE_KEY, []))'),
    'goal manager must validate stored goal types, periods, titles, ids, and streak values on load'
);
assert(
    !goalManagerSource.includes('if (!GOAL_TYPES[type]) return null;') &&
    !goalManagerSource.includes('if (!GOAL_PERIODS[period]) return null;'),
    'goal manager must validate enum values, not object keys'
);

const goalSettingsPanelSource = fs.readFileSync(path.join(repoRoot, 'js/components/goalSettingsPanel.js'), 'utf8');
assert(
    goalSettingsPanelSource.includes("escapeHtml(streak.current)") &&
    goalSettingsPanelSource.includes("escapeHtml(streak.best)") &&
    goalSettingsPanelSource.includes('MAX_RENDERED_GOALS = 100') &&
    goalSettingsPanelSource.includes('allProgress = allProgress.slice(0, MAX_RENDERED_GOALS)') &&
    goalSettingsPanelSource.includes('var safeTitle = escapeHtml(goal.title || periodLabel + typeLabel)'),
    'goal settings panel must escape stored goal and streak values before HTML rendering'
);
assert(
    goalSettingsPanelSource.includes('placeholder="自定义标题" maxlength="30"') &&
    goalSettingsPanelSource.includes('<label for="goal-target">目标值</label>') &&
    !goalSettingsPanelSource.includes('placeholder="鑷') &&
    !goalSettingsPanelSource.includes('鍊?/label'),
    'goal settings panel create form must keep valid input attributes and labels'
);

console.log(JSON.stringify({
    status: 'pass',
    detail: 'local data rendering guard tests passed'
}, null, 2));
