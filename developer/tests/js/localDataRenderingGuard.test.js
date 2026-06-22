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

const answerComparisonUtilsSource = fs.readFileSync(path.join(repoRoot, 'js/utils/answerComparisonUtils.js'), 'utf8');
assert(
    answerComparisonUtilsSource.includes("ANSWER_METADATA_POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor'])") &&
    answerComparisonUtilsSource.includes('MAX_SAFE_CLONE_DEPTH = 8') &&
    answerComparisonUtilsSource.includes('MAX_SAFE_CLONE_KEYS = 1000') &&
    answerComparisonUtilsSource.includes('MAX_SAFE_CLONE_ARRAY_ITEMS = 1000') &&
    answerComparisonUtilsSource.includes('function cloneSafeValue(value, depth = 0, seen = new WeakSet())') &&
    answerComparisonUtilsSource.includes('if (seen.has(value))') &&
    answerComparisonUtilsSource.includes('Object.keys(value).slice(0, MAX_SAFE_CLONE_KEYS)') &&
    answerComparisonUtilsSource.includes('if (isUnsafeMetadataKey(key))') &&
    answerComparisonUtilsSource.includes('const cloned = cloneSafeValue(value[key], depth + 1, seen)'),
    'answer comparison metadata enrichment must deep-clone records while stripping nested prototype-pollution keys'
);

const practiceHistoryEnhancerSource = fs.readFileSync(path.join(repoRoot, 'js/components/practiceHistoryEnhancer.js'), 'utf8');
assert(
    !practiceHistoryEnhancerSource.includes('onclick="'),
    'practice history export dialog must not use inline onclick handlers'
);
assert(
    practiceHistoryEnhancerSource.includes('const createNode = (tagName, className, text) =>') &&
    practiceHistoryEnhancerSource.includes('node.textContent = String(text)') &&
    practiceHistoryEnhancerSource.includes('const createActionButton = (className, action, text, iconClass) =>') &&
    practiceHistoryEnhancerSource.includes('button.dataset.action = action') &&
    practiceHistoryEnhancerSource.includes('document.body.appendChild(dialog)') &&
    practiceHistoryEnhancerSource.includes("dialog.addEventListener('click'"),
    'practice history export dialog actions must be delegated through event listeners'
);
assert(
    !practiceHistoryEnhancerSource.includes('document.body.insertAdjacentHTML') &&
    !practiceHistoryEnhancerSource.includes('const dialogHtml = `'),
    'practice history export dialog must construct DOM nodes instead of injecting an HTML template'
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
    performanceOptimizerSource.includes('MAX_PRELOAD_DATA_IMAGE_URL_LENGTH') &&
    performanceOptimizerSource.includes('TRUSTED_PRELOAD_IMAGE_DATA_URL_PATTERN') &&
    performanceOptimizerSource.includes('function isTrustedImageDataUrl') &&
    performanceOptimizerSource.includes('resolved.origin === currentOrigin') &&
    performanceOptimizerSource.includes('isTrustedImageDataUrl(resolved.href)') &&
    performanceOptimizerSource.includes('const safeUrls = (Array.isArray(imageUrls) ? imageUrls : [])') &&
    !performanceOptimizerSource.includes('const promises = imageUrls.map(url =>'),
    'performance image preloading must reject cross-origin, malformed data, oversized data, and non-image URLs before assigning img.src'
);

const dataManagementPanelSource = fs.readFileSync(path.join(repoRoot, 'js/components/dataManagementPanel.js'), 'utf8');
const remotePracticeDataSourceSource = fs.readFileSync(path.join(repoRoot, 'js/data/dataSources/remotePracticeDataSource.js'), 'utf8');
assert(
    dataManagementPanelSource.includes('const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024') &&
    dataManagementPanelSource.includes('function validateImportFile(file)') &&
    dataManagementPanelSource.includes('function assertImportContentSize(content)') &&
    dataManagementPanelSource.includes('function parseSelectedImportContent(content)') &&
    dataManagementPanelSource.includes('function parseImportFileContent(content)') &&
    dataManagementPanelSource.includes('getImportTextByteLength(content) > MAX_IMPORT_FILE_BYTES') &&
    dataManagementPanelSource.includes('this.selectedFileContent = parseSelectedImportContent(content)') &&
    dataManagementPanelSource.includes('fileContent = parseImportFileContent(rawContent)') &&
    !dataManagementPanelSource.includes('this.selectedFileContent = JSON.parse(content)') &&
    !dataManagementPanelSource.includes('fileContent = JSON.parse(rawContent)') &&
    dataManagementPanelSource.includes("accept: '.json,application/json'"),
    'data management imports must limit declared and actual file size and only accept JSON files'
);
assert(
    remotePracticeDataSourceSource.includes('MAX_REMOTE_PRACTICE_CLONE_DEPTH = 12') &&
    remotePracticeDataSourceSource.includes("REMOTE_PRACTICE_UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])") &&
    remotePracticeDataSourceSource.includes('function cloneRemotePracticeValue(value, depth = 0') &&
    remotePracticeDataSourceSource.includes("return '[Circular]'") &&
    remotePracticeDataSourceSource.includes('return cloneRemotePracticeValue(value);') &&
    !remotePracticeDataSourceSource.includes('return JSON.parse(JSON.stringify(value));') &&
    !remotePracticeDataSourceSource.includes('return value;\n        }\n    }\n\n    function isUnauthorized'),
    'remote practice data source fallback cloning must sanitize local mirrors instead of returning raw remote objects'
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
    dataManagementPanelSource.includes("dataManagementDebugLog('[DataManagementPanel] importPracticeData returned:', {") &&
    dataManagementPanelSource.includes('importedCount: Number(result && result.importedCount) || 0') &&
    !dataManagementPanelSource.includes("console.log('[DataManagementPanel] importPracticeData returned:', result)") &&
    !dataManagementPanelSource.includes("dataManagementDebugLog('[DataManagementPanel] importPracticeData returned:', result)"),
    'data import diagnostics must log whitelisted result counters only'
);

const dataIntegrityManagerSource = fs.readFileSync(path.join(repoRoot, 'js/components/DataIntegrityManager.js'), 'utf8');
assert(
    dataIntegrityManagerSource.includes('setTimeout(() => URL.revokeObjectURL(url), 0)') &&
    !dataIntegrityManagerSource.includes('URL.revokeObjectURL(url);\n            console.log'),
    'data integrity exports must delay object URL revocation until after the click dispatch'
);
assert(
    dataIntegrityManagerSource.includes('MAX_DATA_INTEGRITY_EXPORT_DEPTH = 16') &&
    dataIntegrityManagerSource.includes('MAX_DATA_INTEGRITY_EXPORT_ARRAY_ITEMS = 5000') &&
    dataIntegrityManagerSource.includes('_prepareExportData(providedData || await this.getCriticalData())') &&
    dataIntegrityManagerSource.includes('this._stringifyExportPayload(data).length') &&
    dataIntegrityManagerSource.includes('_sanitizeExportValue(value, depth = 0') &&
    dataIntegrityManagerSource.includes("IMPORT_POLLUTION_KEYS.has(rawKey)") &&
    dataIntegrityManagerSource.includes("return '[Circular]'") &&
    dataIntegrityManagerSource.includes('[Truncated ${value.length - MAX_DATA_INTEGRITY_EXPORT_ARRAY_ITEMS} items]') &&
    !dataIntegrityManagerSource.includes('size: JSON.stringify(data).length') &&
    !dataIntegrityManagerSource.includes('new Blob([JSON.stringify(exportObj, null, 2)]'),
    'data integrity backup/export paths must sanitize data before sizing or JSON export'
);
assert(
    dataIntegrityManagerSource.includes('DEFAULT_MAX_IMPORT_SOURCE_BYTES = 10 * 1024 * 1024') &&
    dataIntegrityManagerSource.includes('normalizeImportSourceByteLimit(options.maxImportSourceBytes)') &&
    dataIntegrityManagerSource.includes('_assertImportSourceSize(getTextByteLength(source), \'string\')') &&
    dataIntegrityManagerSource.includes("typeof Blob !== 'undefined'") &&
    dataIntegrityManagerSource.includes("_assertImportSourceSize(source.byteLength, 'arrayBuffer')"),
    'data integrity imports must cap string, Blob/File, and ArrayBuffer sources before JSON parsing'
);
assert(
    dataIntegrityManagerSource.includes('function getSafeDataIntegrityImportError(error, phase)') &&
    dataIntegrityManagerSource.includes("throw new Error(getSafeDataIntegrityImportError(error, 'read'))") &&
    dataIntegrityManagerSource.includes("throw new Error(getSafeDataIntegrityImportError(error, 'save'))") &&
    !dataIntegrityManagerSource.includes("throw new Error(error?.message || '导入文件格式无效')") &&
    !dataIntegrityManagerSource.includes("throw new Error(error?.message || '导入数据失败')"),
    'data integrity import failures must not rethrow raw exception messages to the UI'
);

const dataBackupManagerSource = fs.readFileSync(path.join(repoRoot, 'js/utils/dataBackupManager.js'), 'utf8');
assert(
    dataBackupManagerSource.includes('allowFetch = false') &&
    dataBackupManagerSource.includes('Boolean(allowFetch)') &&
    dataBackupManagerSource.includes('function resolveTrustedImportFetchUrl') &&
    dataBackupManagerSource.includes('resolved.origin === currentOrigin') &&
    dataBackupManagerSource.includes('fetch(fetchUrl, { credentials: \'same-origin\', cache: \'no-store\' })') &&
    dataBackupManagerSource.includes("typeof response.text !== 'function'") &&
    dataBackupManagerSource.includes('const body = await response.text()') &&
    dataBackupManagerSource.includes('getBackupTextByteLength(body) > DEFAULT_MAX_BACKUP_IMPORT_SOURCE_BYTES') &&
    !dataBackupManagerSource.includes('parseImportSource(source, { allowFetch: true })') &&
    !dataBackupManagerSource.includes('fetch(trimmed)') &&
    !dataBackupManagerSource.includes('response.json()'),
    'backup imports must not fetch arbitrary string sources or parse fetched bodies without a size check'
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
assert(
    dataBackupManagerSource.includes('function getSafeDataBackupImportHistoryError(error)') &&
    dataBackupManagerSource.includes('error: getSafeDataBackupImportHistoryError(error)') &&
    !dataBackupManagerSource.includes('error: error.message'),
    'data backup import history must not persist raw exception messages'
);
assert(
    dataBackupManagerSource.includes('practiceRecords = this.normalizeExportRecords(practiceRecords)') &&
    dataBackupManagerSource.includes('normalizeExportStats(stats)') &&
    dataBackupManagerSource.includes('normalizeExportBackups(backups)') &&
    dataBackupManagerSource.includes('normalizeExportOptions(options)') &&
    dataBackupManagerSource.includes('const scanState = new WeakSet()') &&
    dataBackupManagerSource.includes('scanState.add(value)') &&
    dataBackupManagerSource.includes('this.cloneSafeValue(item, options, 0, scanState)'),
    'data backup exports and plain object clones must sanitize records/stats/backups and share cycle detection state'
);

const suitePracticeMixinSource = fs.readFileSync(path.join(repoRoot, 'js/app/suitePracticeMixin.js'), 'utf8');
assert(
    suitePracticeMixinSource.includes('MAX_SUITE_CLONE_DEPTH = 12') &&
    suitePracticeMixinSource.includes('MAX_SUITE_SESSION_STORAGE_CHARS = 2 * 1024 * 1024') &&
    suitePracticeMixinSource.includes('SUITE_CLONE_POLLUTION_KEYS') &&
    suitePracticeMixinSource.includes('function cloneSuiteSafeValue') &&
    suitePracticeMixinSource.includes('function parseSuiteSessionSnapshot') &&
    suitePracticeMixinSource.includes('const snapshot = parseSuiteSessionSnapshot(raw)') &&
    suitePracticeMixinSource.includes('scanState.add(value)') &&
    suitePracticeMixinSource.includes('const cloned = cloneSuiteSafeValue(value)') &&
    suitePracticeMixinSource.includes('delete cloned.highlights') &&
    suitePracticeMixinSource.includes('delete cloned.scrollY') &&
    !suitePracticeMixinSource.includes('return JSON.parse(JSON.stringify(value))') &&
    !suitePracticeMixinSource.includes('Array.isArray(value) ? value.slice() : { ...value }'),
    'suite rawData snapshots must use bounded safe cloning instead of JSON stringify or shallow fallback'
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
    bootFallbacksSource.includes('validateFallbackJsonFile(inputFile)') &&
    bootFallbacksSource.includes('function getFallbackImportTextByteLength') &&
    bootFallbacksSource.includes('function assertFallbackImportTextSize') &&
    bootFallbacksSource.includes('assertFallbackImportTextSize(reader.result)'),
    'legacy import fallback must validate JSON import files before FileReader reads them and before parsing read text'
);

const listeningRecordBridgeSource = fs.readFileSync(path.join(repoRoot, 'js/listeningRecordBridge.js'), 'utf8');
assert(
    listeningRecordBridgeSource.includes('function parseGeneratedResultsHtml') &&
    listeningRecordBridgeSource.includes('MAX_LISTENING_RESULT_HTML_LENGTH = 2 * 1024 * 1024') &&
    listeningRecordBridgeSource.includes('MAX_LISTENING_INLINE_OBJECT_LENGTH = 256 * 1024') &&
    listeningRecordBridgeSource.includes('MAX_LISTENING_INLINE_KEY_LENGTH = 160') &&
    listeningRecordBridgeSource.includes('MAX_LISTENING_INLINE_VALUE_DEPTH = 8') &&
    listeningRecordBridgeSource.includes('MAX_LISTENING_INLINE_VALUE_NODES = 5000') &&
    listeningRecordBridgeSource.includes('LISTENING_INLINE_UNSAFE_KEYS') &&
    listeningRecordBridgeSource.includes('MAX_LISTENING_EXAM_ID_LENGTH = 120') &&
    listeningRecordBridgeSource.includes('MAX_LISTENING_SESSION_ID_LENGTH = 160') &&
    listeningRecordBridgeSource.includes('MAX_LISTENING_URL_SOURCE_LENGTH = 2048') &&
    listeningRecordBridgeSource.includes('LISTENING_SAFE_ID_PATTERN') &&
    listeningRecordBridgeSource.includes('function normalizeListeningExamId') &&
    listeningRecordBridgeSource.includes('function normalizeListeningSessionId') &&
    listeningRecordBridgeSource.includes('html.length > MAX_LISTENING_RESULT_HTML_LENGTH') &&
    listeningRecordBridgeSource.includes('source.length > MAX_LISTENING_INLINE_OBJECT_LENGTH') &&
    listeningRecordBridgeSource.includes('json.length > MAX_LISTENING_INLINE_OBJECT_LENGTH') &&
    listeningRecordBridgeSource.includes('function sanitizeListeningInlineValue') &&
    listeningRecordBridgeSource.includes('sanitizeListeningInlineValue(JSON.parse(json), 0, { nodes: 0 })') &&
    listeningRecordBridgeSource.includes('new URL(window.location.href)') &&
    listeningRecordBridgeSource.includes("currentUrl.searchParams.get('examId')") &&
    listeningRecordBridgeSource.includes("currentUrl.searchParams.get('src')") &&
    listeningRecordBridgeSource.includes('rawSrc.length <= MAX_LISTENING_URL_SOURCE_LENGTH') &&
    listeningRecordBridgeSource.includes('state.examId = normalizeListeningExamId(payload.examId') &&
    listeningRecordBridgeSource.includes('state.sessionId = normalizeListeningSessionId(payload.sessionId') &&
    listeningRecordBridgeSource.includes("new DOMParser().parseFromString(html, 'text/html')") &&
    listeningRecordBridgeSource.includes('var s2 = parseGeneratedResultsHtml(html)'),
    'listening result bridge must bound URL/session identifiers and parse generated result HTML with DOMParser before reading table data'
);
assert(
    !listeningRecordBridgeSource.includes('tempDiv.innerHTML = html'),
    'listening result bridge must not inject generated result HTML through innerHTML'
);
assert(
    listeningRecordBridgeSource.includes('function createSafeListeningRecordMap()') &&
    listeningRecordBridgeSource.includes('return Object.create(null);') &&
    listeningRecordBridgeSource.includes('function toSafeListeningRecordKey(rawQuestion, fallbackIndex)') &&
    listeningRecordBridgeSource.includes('MAX_LISTENING_RECORD_KEY_LENGTH') &&
    listeningRecordBridgeSource.includes('isUnsafeListeningRecordKey(key)') &&
    listeningRecordBridgeSource.includes('var answers = createSafeListeningRecordMap();') &&
    listeningRecordBridgeSource.includes('var correctAnswers = createSafeListeningRecordMap();') &&
    listeningRecordBridgeSource.includes('var answerComparison = createSafeListeningRecordMap();') &&
    listeningRecordBridgeSource.includes('var answerDetails = createSafeListeningRecordMap();') &&
    listeningRecordBridgeSource.includes('var qId = toSafeListeningRecordKey(d.question, i);'),
    'listening result bridge must write extracted answers into null-prototype maps with bounded safe question keys'
);
assert(
    !listeningRecordBridgeSource.includes('var answers = {};') &&
    !listeningRecordBridgeSource.includes('var correctAnswers = {};') &&
    !listeningRecordBridgeSource.includes('var answerComparison = {};') &&
    !listeningRecordBridgeSource.includes('var answerDetails = {};'),
    'listening result bridge answer maps must not be plain objects'
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
assert(
    practicePageEnhancerSource.includes('MAX_ENHANCER_ANSWER_LITERAL_CHARS = 64 * 1024') &&
    practicePageEnhancerSource.includes('MAX_ENHANCER_FALLBACK_STORAGE_JSON_CHARS = 2 * 1024 * 1024') &&
    practicePageEnhancerSource.includes('function parseBoundedEnhancerJson(source, maxLength = MAX_ENHANCER_ANSWER_LITERAL_CHARS)') &&
    practicePageEnhancerSource.includes('literal.length > MAX_ENHANCER_ANSWER_LITERAL_CHARS') &&
    practicePageEnhancerSource.includes('return parseBoundedEnhancerJson(cleanStr)') &&
    practicePageEnhancerSource.includes('const answers = parseBoundedEnhancerJson(jsonMatch[1])') &&
    practicePageEnhancerSource.includes('parseBoundedEnhancerJson(raw, MAX_ENHANCER_FALLBACK_STORAGE_JSON_CHARS)') &&
    !practicePageEnhancerSource.includes('return JSON.parse(cleanStr)') &&
    !practicePageEnhancerSource.includes('JSON.parse(jsonMatch[1])') &&
    !practicePageEnhancerSource.includes('const parsed = JSON.parse(raw)'),
    'practice page enhancer must bound answer JSON snippets and fallback storage before parsing'
);

const unifiedReadingPageSource = fs.readFileSync(path.join(repoRoot, 'js/runtime/unifiedReadingPage.js'), 'utf8');
const readingExamRegistrySource = fs.readFileSync(path.join(repoRoot, 'js/runtime/readingExamRegistry.js'), 'utf8');
const readingExplanationRegistrySource = fs.readFileSync(path.join(repoRoot, 'js/runtime/readingExplanationRegistry.js'), 'utf8');
for (const [registryLabel, registrySource] of [
    ['reading exam registry', readingExamRegistrySource],
    ['reading explanation registry', readingExplanationRegistrySource]
]) {
    assert(
        registrySource.includes('MAX_READING_REGISTRY_CLONE_DEPTH = 16') &&
        registrySource.includes('MAX_READING_REGISTRY_ARRAY_ITEMS = 5000') &&
        registrySource.includes("READING_REGISTRY_UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])") &&
        registrySource.includes('function cloneRegistryValue(value, depth = 0') &&
        registrySource.includes("return '[Circular]'") &&
        registrySource.includes('return cloneRegistryValue(value);') &&
        !registrySource.includes('JSON.parse(JSON.stringify(value))'),
        `${registryLabel} must use bounded safe cloning instead of JSON stringify cloning`
    );
}
assert(
    unifiedReadingPageSource.includes('function normalizeResultNumber(value, fallback = 0)') &&
    unifiedReadingPageSource.includes('MAX_SIMULATION_DRAFT_STORAGE_CHARS = 1024 * 1024') &&
    unifiedReadingPageSource.includes('function parseSimulationDraftStorage') &&
    unifiedReadingPageSource.includes('const parsed = parseSimulationDraftStorage(raw)') &&
    !unifiedReadingPageSource.includes('const parsed = JSON.parse(raw)') &&
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
    hpPortalSource.includes('MAX_HP_IMPORT_OBJECT_KEYS = 500') &&
    hpPortalSource.includes('MAX_HP_IMPORT_STRING_LENGTH = 20000') &&
    hpPortalSource.includes('MAX_HP_IMPORT_NODES = 50000') &&
    hpPortalSource.includes('HP_IMPORT_POLLUTION_KEYS') &&
    hpPortalSource.includes('function validateHpJsonFile') &&
    hpPortalSource.includes('function createHpImportSanitizeState') &&
    hpPortalSource.includes('function sanitizeHpImportValue') &&
    hpPortalSource.includes('function sanitizeHpImportList') &&
    hpPortalSource.includes('function assertHpImportTextSize') &&
    hpPortalSource.includes("return '[Circular]'") &&
    hpPortalSource.includes("return '[Truncated]'") &&
    hpPortalSource.includes('validateHpJsonFile(file)') &&
    hpPortalSource.includes('assertHpImportTextSize(rawContent)') &&
    hpPortalSource.includes('exams: sanitizeHpImportList(exams)') &&
    hpPortalSource.includes('records: sanitizeHpImportList(records)') &&
    hpPortalSource.includes('exams: sanitizeHpImportList(hpCore.getExamIndex() || [])') &&
    hpPortalSource.includes('records: sanitizeHpImportList(hpCore.getRecords() || [])') &&
    hpPortalSource.includes('state: normalizePortalState(this.state)') &&
    hpPortalSource.includes('examIndex: sanitizeHpImportList(exams)') &&
    hpPortalSource.includes('practiceRecords: sanitizeHpImportList(records)') &&
    hpPortalSource.includes('setTimeout(() => URL.revokeObjectURL(url), 0)') &&
    !hpPortalSource.includes('JSON.parse(JSON.stringify(exams))') &&
    !hpPortalSource.includes('JSON.parse(JSON.stringify(records))'),
    'HP portal backup import/export must validate files, sanitize imported/current arrays, tolerate circular data, and delay object URL revocation'
);

const hpCoreBridgeSource = fs.readFileSync(path.join(repoRoot, 'js/plugins/hp/hp-core-bridge.js'), 'utf8');
assert(
    hpCoreBridgeSource.includes("PRACTICE_MESSAGE_POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor'])") &&
    hpCoreBridgeSource.includes('MAX_PRACTICE_MESSAGE_DEPTH = 16') &&
    hpCoreBridgeSource.includes('MAX_HP_CORE_JSON_STRING_LENGTH = 64 * 1024') &&
    hpCoreBridgeSource.includes('function parseHpCoreJsonString(value)') &&
    hpCoreBridgeSource.includes('value.length > MAX_HP_CORE_JSON_STRING_LENGTH') &&
    hpCoreBridgeSource.includes('const parsed = parseHpCoreJsonString(value)') &&
    !hpCoreBridgeSource.includes('const parsed = JSON.parse(value)') &&
    hpCoreBridgeSource.includes('function sanitizePracticeMessageValue(value, depth, state)') &&
    hpCoreBridgeSource.includes('raw: sanitizePracticeMessageValue(payload) || {}') &&
    hpCoreBridgeSource.includes('const safePayload = normalizedPayload.raw || {}') &&
    hpCoreBridgeSource.includes('window.savePracticeRecordFallback(derivedExamId, safePayload)') &&
    hpCoreBridgeSource.includes('ingestLocalPracticeRecord(derivedExamId, safePayload, recordContext)') &&
    hpCoreBridgeSource.includes('realData: normalized.raw || {}') &&
    !hpCoreBridgeSource.includes('window.savePracticeRecordFallback(derivedExamId, payload)') &&
    !hpCoreBridgeSource.includes('ingestLocalPracticeRecord(derivedExamId, payload, recordContext)') &&
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
    themeAdapterBaseSource.includes('window.savePracticeRecordFallback(examId, normalized.raw || {})') &&
    !themeAdapterBaseSource.includes('window.savePracticeRecordFallback(examId, payload)') &&
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
    vocabDataIoSource.includes('MAX_CATEGORY_SCAN_DEPTH = 8') &&
    vocabDataIoSource.includes('MAX_CATEGORY_SCAN_NODES = 200') &&
    vocabDataIoSource.includes('function validateVocabImportFile') &&
    vocabDataIoSource.includes('function assertVocabImportTextSize(text)') &&
    vocabDataIoSource.includes('function normalizeTextField') &&
    vocabDataIoSource.includes('function limitImportItems') &&
    vocabDataIoSource.includes('function getOwnImportValue') &&
    vocabDataIoSource.includes('while (stack.length && scanned < MAX_CATEGORY_SCAN_NODES)') &&
    vocabDataIoSource.includes('const items = limitImportItems(payload)') &&
    vocabDataIoSource.includes('const words = limitImportItems(payload.words)') &&
    vocabDataIoSource.includes('const rowLimit = Math.min(lines.length, MAX_VOCAB_IMPORT_ENTRIES + 1)') &&
    vocabDataIoSource.includes('validateVocabImportFile(file)') &&
    vocabDataIoSource.includes('assertVocabImportTextSize(text)'),
    'vocab imports must validate file size, read text size, extension, MIME type, entry count, and text field lengths before normalizing large payloads'
);

const vocabStoreSource = fs.readFileSync(path.join(repoRoot, 'js/core/vocabStore.js'), 'utf8');
assert(
    vocabStoreSource.includes('MAX_STORED_VOCAB_WORDS = 5000') &&
    vocabStoreSource.includes('MAX_WORD_TEXT_LENGTH = 160') &&
    vocabStoreSource.includes('MAX_METADATA_JSON_CHARS = 8000') &&
    vocabStoreSource.includes('MAX_VOCAB_LEXICON_JSON_BYTES = 2 * 1024 * 1024') &&
    vocabStoreSource.includes('function parseBoundedVocabLexiconJson(text)') &&
    vocabStoreSource.includes('contentLength > MAX_VOCAB_LEXICON_JSON_BYTES') &&
    vocabStoreSource.includes('parseBoundedVocabLexiconJson(await primary.text())') &&
    vocabStoreSource.includes('parseBoundedVocabLexiconJson(xhr.responseText)') &&
    !vocabStoreSource.includes('return primary.json()') &&
    !vocabStoreSource.includes('JSON.parse(xhr.responseText)') &&
    vocabStoreSource.includes('function normalizeExtraValue') &&
    vocabStoreSource.includes('function cloneWordRecord') &&
    vocabStoreSource.includes('function cloneWordList') &&
    vocabStoreSource.includes('function cloneListData') &&
    vocabStoreSource.includes('return cloneWordList(state.words)') &&
    vocabStoreSource.includes('return cloneListData(cached.data)') &&
    vocabStoreSource.includes('return cloneVocabLists()') &&
    vocabStoreSource.includes('listWords\\n            .slice(0, MAX_STORED_VOCAB_WORDS)'.replace(/\\n/g, '\n')),
    'vocab store must cap stored list size, normalize long imported word fields, and return defensive clones'
);

const spellingErrorCollectorSource = fs.readFileSync(path.join(repoRoot, 'js/app/spellingErrorCollector.js'), 'utf8');
assert(
    spellingErrorCollectorSource.includes('MAX_SPELLING_VOCAB_WORDS = 5000') &&
    spellingErrorCollectorSource.includes('MAX_SPELLING_LEXICON_JSON_BYTES = 2 * 1024 * 1024') &&
    spellingErrorCollectorSource.includes('function parseSpellingLexiconJson(text)') &&
    spellingErrorCollectorSource.includes('contentLength > MAX_SPELLING_LEXICON_JSON_BYTES') &&
    spellingErrorCollectorSource.includes('parseSpellingLexiconJson(await response.text())') &&
    spellingErrorCollectorSource.includes('parseSpellingLexiconJson(xhr.responseText)') &&
    !spellingErrorCollectorSource.includes('return response.json()') &&
    !spellingErrorCollectorSource.includes('JSON.parse(xhr.responseText)') &&
    spellingErrorCollectorSource.includes('SPELLING_IMPORT_POLLUTION_KEYS') &&
    spellingErrorCollectorSource.includes('cloneSafeObject(value)') &&
    spellingErrorCollectorSource.includes('normalizeStoredWordEntry(entry)') &&
    spellingErrorCollectorSource.includes('normalizeStoredWords(words)') &&
    spellingErrorCollectorSource.includes('words: this.normalizeStoredWords(rawList)') &&
    spellingErrorCollectorSource.includes('const safeList = this.cloneSafeObject(rawList)') &&
    spellingErrorCollectorSource.includes('return this.normalizeStoredWordEntry({'),
    'spelling error vocab lists must cap restored word count and strip unsafe imported keys'
);

const miniGamesSource = fs.readFileSync(path.join(repoRoot, 'js/presentation/miniGames.js'), 'utf8');
assert(
    miniGamesSource.includes('MAX_VOCAB_SPARK_LEXICON_JSON_BYTES = 2 * 1024 * 1024') &&
    miniGamesSource.includes('MAX_VOCAB_SPARK_LEXICON_ENTRIES = 5000') &&
    miniGamesSource.includes('MAX_VOCAB_SPARK_WORD_TEXT_LENGTH = 120') &&
    miniGamesSource.includes('MAX_VOCAB_SPARK_MEANING_TEXT_LENGTH = 500') &&
    miniGamesSource.includes('function parseVocabSparkLexiconJson(text)') &&
    miniGamesSource.includes('function truncateMiniGameText(value, maxLength)') &&
    miniGamesSource.includes('contentLength > MAX_VOCAB_SPARK_LEXICON_JSON_BYTES') &&
    miniGamesSource.includes("typeof response.text !== 'function'") &&
    miniGamesSource.includes('parseVocabSparkLexiconJson(await response.text())') &&
    miniGamesSource.includes('payload.slice(0, MAX_VOCAB_SPARK_LEXICON_ENTRIES).map(normalizeVocabEntry).filter(Boolean)') &&
    miniGamesSource.includes('lexicon.slice(0, MAX_VOCAB_SPARK_LEXICON_ENTRIES)') &&
    !miniGamesSource.includes('await response.json()'),
    'vocab mini game lexicon fetches must size-check fetched JSON before parsing and bound normalized entries'
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
    practiceRecordModalSource.includes('MAX_MODAL_MAP_KEYS = 1000') &&
    practiceRecordModalSource.includes('MAX_MODAL_MAP_KEY_LENGTH = 120') &&
    practiceRecordModalSource.includes('MODAL_UNSAFE_MAP_KEYS') &&
    practiceRecordModalSource.includes('.slice(0, MAX_MODAL_ANSWER_ROWS)') &&
    practiceRecordModalSource.includes('if (depth > MAX_MODAL_ANSWER_DEPTH)') &&
    practiceRecordModalSource.includes('normalizeAnswerMap(source)') &&
    practiceRecordModalSource.includes('normalizeComparisonMap(source)') &&
    practiceRecordModalSource.includes('correctAnswerMapFromDetails(details)') &&
    practiceRecordModalSource.includes('const comparison = this.normalizeComparisonMap(record.answerComparison || {})') &&
    practiceRecordModalSource.includes('this.truncateAnswer(rawUserAnswer, MAX_MODAL_ANSWER_TEXT_LENGTH)') &&
    practiceRecordModalSource.includes('this.truncateAnswer(rawCorrectAnswer, MAX_MODAL_ANSWER_TEXT_LENGTH)'),
    'practice record modal must cap rendered answer rows/text and safely clone imported comparison data'
);
assert(
    practiceRecordModalSource.includes('createModalElement(record)') &&
    practiceRecordModalSource.includes('template.innerHTML = this.createModalHtml(record).trim()') &&
    practiceRecordModalSource.includes('this.sanitizeModalElement(modalElement)') &&
    practiceRecordModalSource.includes('document.body.appendChild(modalElement)') &&
    practiceRecordModalSource.includes("const blockedTags = new Set(['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base'])") &&
    practiceRecordModalSource.includes("name.startsWith('on')") &&
    practiceRecordModalSource.includes("name === 'srcdoc'") &&
    practiceRecordModalSource.includes('isUnsafeModalUrlAttribute(name, value)') &&
    !practiceRecordModalSource.includes("document.body.insertAdjacentHTML('beforeend', modalHtml)"),
    'practice record modal must sanitize parsed modal markup before appending it to the document'
);

const markdownExporterSource = fs.readFileSync(path.join(repoRoot, 'js/utils/markdownExporter.js'), 'utf8');
assert(
    markdownExporterSource.includes('setTimeout(() => URL.revokeObjectURL(url), 0)') &&
    markdownExporterSource.includes('escapeMarkdownText(value, maxLength = 200)') &&
    markdownExporterSource.includes(".replace(/</g, '&lt;')") &&
    markdownExporterSource.includes('const displayTitle = this.escapeMarkdownText(this.normalizeTitle(') &&
    markdownExporterSource.includes('return this.escapeMarkdownText(text, 100);') &&
    markdownExporterSource.includes("style.id = 'export-progress-style'") &&
    markdownExporterSource.includes("progressText.textContent = '正在准备导出...'") &&
    markdownExporterSource.includes('document.body.append(overlay, style)') &&
    !markdownExporterSource.includes('document.body.insertAdjacentHTML'),
    'markdown exports must delay object URL revocation and escape user-controlled markdown/HTML text'
);

const examActionsSource = fs.readFileSync(path.join(repoRoot, 'js/app/examActions.js'), 'utf8');
assert(
    examActionsSource.includes("a.download = 'practice-records.json'") &&
    examActionsSource.includes('setTimeout(() => URL.revokeObjectURL(url), 0)'),
    'exam actions fallback exports must delay object URL revocation until after the click dispatch'
);
assert(
    examActionsSource.includes('MAX_FALLBACK_EXPORT_RECORDS = 5000') &&
    examActionsSource.includes("FALLBACK_EXPORT_POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor'])") &&
    examActionsSource.includes('function sanitizeFallbackExportValue(value, depth = 0') &&
    examActionsSource.includes('function createSafeFallbackExportRecords(records)') &&
    examActionsSource.includes('var safeRecords = createSafeFallbackExportRecords(records)') &&
    examActionsSource.includes('JSON.stringify(safeRecords, null, 2)') &&
    !examActionsSource.includes('JSON.stringify(records, null, 2)'),
    'exam actions fallback exports must safely clone, cap, and strip unsafe record data before JSON.stringify'
);
assert(
    examActionsSource.includes('function createCustomSuiteElement(tagName, className, textContent)') &&
    examActionsSource.includes('function appendCustomSuiteRow(parent, row, includeDelete)') &&
    examActionsSource.includes('node.textContent = String(textContent)') &&
    examActionsSource.includes("deleteButton.dataset.action = 'suite-custom-delete'") &&
    examActionsSource.includes("footer.appendChild(createCustomSuiteFooterButton('确认开始'") &&
    !examActionsSource.includes('portal.innerHTML = [') &&
    !examActionsSource.includes('const rowMarkup = (row, includeDelete) =>'),
    'custom suite selection portal must render dynamic rows with DOM APIs instead of innerHTML templates'
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
assert(
    storageSource.includes('function getSafeStorageImportErrorMessage(error)') &&
    storageSource.includes('message: getSafeStorageImportErrorMessage(error)') &&
    storageSource.includes('Backup contains a circular reference at ${path}') &&
    storageSource.includes('Import data contains a circular reference') &&
    storageSource.includes('scanState.seen.delete(value)') &&
    !storageSource.includes('message: error.message'),
    'storage import failures must return sanitized user-facing messages'
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
    examSessionMixinSource.includes('function getSafeExamSessionStoredError(error)') &&
    examSessionMixinSource.includes('error: getSafeExamSessionStoredError(error)') &&
    !examSessionMixinSource.includes('error: error.message'),
    'exam session injection error logs must not persist raw exception messages'
);
assert(
    examSessionMixinSource.includes('const safeExamTitle = escapeHtml(exam.title || \'\');') &&
    examSessionMixinSource.includes('const safeSessionTitle = escapeHtml(exam ? exam.title :') &&
    !examSessionMixinSource.includes('<h4>${exam.title}</h4>') &&
    !examSessionMixinSource.includes("${exam ? exam.title : '未知题目'}"),
    'exam session templates must escape exam titles before HTML interpolation'
);

assert(
    examSessionMixinSource.includes('MAX_REVIEW_REPLAY_CLONE_DEPTH = 12') &&
    examSessionMixinSource.includes('MAX_REVIEW_REPLAY_CLONE_NODES = 50000') &&
    examSessionMixinSource.includes("REVIEW_REPLAY_UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])") &&
    examSessionMixinSource.includes('function cloneReviewReplayValue(value, depth = 0') &&
    examSessionMixinSource.includes('return cloneReviewReplayValue(value);') &&
    !examSessionMixinSource.includes('return JSON.parse(JSON.stringify(value));'),
    'exam session replay data must use bounded safe cloning instead of JSON stringify fallback'
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
    reviewHighlightDictionarySource.includes('MAX_FALLBACK_STORAGE_STRING_LENGTH = 5 * 1024 * 1024') &&
    reviewHighlightDictionarySource.includes('function normalizeContextValue') &&
    reviewHighlightDictionarySource.includes('function parseFallbackStorageJson') &&
    reviewHighlightDictionarySource.includes('const parsed = parseFallbackStorageJson(raw)') &&
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
    onboardingTourSource.includes('this._tooltip.replaceChildren(welcome)') &&
    onboardingTourSource.includes('MAX_ONBOARDING_STEPS = 100') &&
    onboardingTourSource.includes('MAX_ONBOARDING_SELECTOR_LENGTH = 240') &&
    onboardingTourSource.includes('function normalizeOnboardingSteps') &&
    onboardingTourSource.includes('this._steps = normalizeOnboardingSteps(steps, DEFAULT_STEPS)'),
    'onboarding tooltip content must be built with DOM APIs and custom steps must be bounded before use'
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
    !goalSettingsPanelSource.includes('placeholder="自定义标题 maxlength="30"') &&
    !goalSettingsPanelSource.includes('placeholder="鑷') &&
    !goalSettingsPanelSource.includes('鍊?/label'),
    'goal settings panel create form must keep valid input attributes and labels'
);

console.log(JSON.stringify({
    status: 'pass',
    detail: 'local data rendering guard tests passed'
}, null, 2));
