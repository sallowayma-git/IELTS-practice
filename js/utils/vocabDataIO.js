(function(window) {
    const SUPPORTED_JSON_TYPES = new Set([
        'application/json',
        'text/json'
    ]);
    const SUPPORTED_CSV_TYPES = new Set([
        'text/csv',
        'application/vnd.ms-excel',
        'application/csv'
    ]);

    const DEFAULT_EXPORT_VERSION = '0.6.2-fix';

    function isPlainObject(value) {
        return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    }

    function normalizeFrequency(value) {
        if (value == null || value === '') {
            return null;
        }
        const numeric = Number(value);
        if (Number.isNaN(numeric)) {
            return null;
        }
        if (!Number.isFinite(numeric)) {
            return null;
        }
        const clamped = Math.min(1, Math.max(0, numeric));
        return Math.round(clamped * 1000) / 1000;
    }

    function normalizePhonetic(value) {
        if (typeof value !== 'string') {
            return '';
        }
        return value.trim().replace(/^\/+|\/+$/g, '').trim();
    }

    function normalizeCategory(value, fallback = null) {
        if (typeof value !== 'string') {
            return fallback;
        }
        const normalized = value.trim().toLowerCase();
        if (!normalized) {
            return fallback;
        }
        if (/(自设|自定|自訂|自建|自制|custom|user|personal|self)/.test(normalized)) {
            return 'user';
        }
        if (/(外部|其他|其它|共享|公共|他人|others|other|external|shared|community|third)/.test(normalized)) {
            return 'external';
        }
        return fallback;
    }

    function extractCategory(source, fallback = 'external') {
        if (!source) {
            return fallback;
        }
        if (typeof source === 'string') {
            return normalizeCategory(source, fallback);
        }
        if (typeof source !== 'object') {
            return fallback;
        }
        const candidates = [];
        const collect = (value) => {
            if (typeof value === 'string' && value.trim()) {
                candidates.push(value);
            }
        };
        collect(source.category);
        collect(source.listType);
        collect(source.listCategory);
        collect(source.origin);
        collect(source.source);
        collect(source.sourceType);
        collect(source.typeLabel);
        collect(source.type);
        if (source.meta && typeof source.meta === 'object' && source.meta !== source) {
            const nested = extractCategory(source.meta, null);
            if (nested) {
                return nested;
            }
        }
        for (let i = 0; i < candidates.length; i += 1) {
            const resolved = normalizeCategory(candidates[i], null);
            if (resolved) {
                return resolved;
            }
        }
        return fallback;
    }

    function cloneProgressEntry(raw) {
        if (!isPlainObject(raw)) {
            return null;
        }
        const word = typeof raw.word === 'string' ? raw.word.trim() : '';
        const meaning = typeof raw.meaning === 'string' ? raw.meaning.trim() : '';
        if (!word || !meaning) {
            return null;
        }
        const entry = { ...raw, word, meaning };
        const phonetic = normalizePhonetic(raw.phonetic);
        if (phonetic) {
            entry.phonetic = phonetic;
        } else {
            delete entry.phonetic;
        }
        return entry;
    }

    function buildImportResult(type, entries, meta = {}) {
        const safeEntries = Array.isArray(entries) ? entries.filter(Boolean) : [];
        const normalizedMeta = { ...meta };
        normalizedMeta.category = normalizeCategory(normalizedMeta.category, type === 'progress' ? 'user' : 'external');
        return {
            type,
            entries: safeEntries,
            meta: normalizedMeta
        };
    }

    function normalizeEntry(raw) {
        if (!raw || typeof raw !== 'object') {
            return null;
        }
        const word = typeof raw.word === 'string' ? raw.word.trim() : '';
        const meaning = typeof raw.meaning === 'string' ? raw.meaning.trim() : '';
        if (!word || !meaning) {
            return null;
        }
        const example = typeof raw.example === 'string' ? raw.example.trim() : '';
        const phonetic = normalizePhonetic(raw.phonetic);
        const freq = normalizeFrequency(raw.freq);
        const normalized = {
            word,
            meaning,
            example,
        };
        if (freq !== null) {
            normalized.freq = freq;
        }
        if (phonetic) {
            normalized.phonetic = phonetic;
        }
        return normalized;
    }

    function validateSchema(data) {
        if (!data) {
            return false;
        }
        const payload = Array.isArray(data) ? data : Array.isArray(data.words) ? data.words : null;
        if (!Array.isArray(payload) || !payload.length) {
            return false;
        }
        return payload.every((item) => !!normalizeEntry(item));
    }

    function selectDelimiter(headerLine) {
        let inQuotes = false;
        const found = new Set();
        for (let i = 0; i < headerLine.length; i += 1) {
            const char = headerLine[i];
            if (char === '"') {
                if (inQuotes && headerLine[i + 1] === '"') {
                    i += 1;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (!inQuotes && (char === ',' || char === ';' || char === '\t')) {
                found.add(char);
            }
        }
        if (found.has(',')) return ',';
        if (found.has(';')) return ';';
        if (found.has('\t')) return '\t';
        return ',';
    }

    function parseCsvRows(text, delimiter) {
        const rows = [];
        let row = [];
        let current = '';
        let inQuotes = false;
        let rowTouched = false;
        const source = String(text || '');

        const pushRow = () => {
            row.push(current.trim());
            if (rowTouched && row.some((cell) => cell !== '')) {
                rows.push(row);
            }
            row = [];
            current = '';
            rowTouched = false;
        };

        for (let i = 0; i < source.length; i += 1) {
            const char = source[i];
            if (char === '"') {
                rowTouched = true;
                if (inQuotes && source[i + 1] === '"') {
                    current += '"';
                    i += 1;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (!inQuotes && char === delimiter) {
                rowTouched = true;
                row.push(current.trim());
                current = '';
            } else if (char === '\r' || char === '\n') {
                if (char === '\r' && source[i + 1] === '\n') {
                    i += 1;
                }
                if (inQuotes) {
                    current += '\n';
                    rowTouched = true;
                } else {
                    pushRow();
                }
            } else {
                current += char;
                if (!/\s/.test(char)) {
                    rowTouched = true;
                }
            }
        }

        if (inQuotes) {
            throw new Error('CSV 包含未闭合的引号字段');
        }
        if (rowTouched || row.length || current.trim()) {
            pushRow();
        }
        return rows;
    }

    function parseCsv(text) {
        const source = String(text || '');
        const firstContentLine = source
            .split(/\r\n|\r|\n/)
            .find((line) => line.replace(/^\uFEFF/, '').trim()) || '';
        const delimiter = selectDelimiter(firstContentLine.replace(/^\uFEFF/, ''));
        const rows = parseCsvRows(source, delimiter);
        if (!rows.length) {
            return buildImportResult('wordlist', [], { format: 'csv' });
        }
        const headerCells = rows[0].map((cell) => cell.replace(/^\uFEFF/, '').toLowerCase());
        const columnIndex = {
            word: headerCells.indexOf('word'),
            meaning: headerCells.indexOf('meaning'),
            example: headerCells.indexOf('example'),
            phonetic: headerCells.indexOf('phonetic'),
            freq: headerCells.indexOf('freq')
        };
        const entries = [];
        for (let i = 1; i < rows.length; i += 1) {
            const cells = rows[i];
            const candidate = {
                word: columnIndex.word >= 0 ? cells[columnIndex.word] : cells[0],
                meaning: columnIndex.meaning >= 0 ? cells[columnIndex.meaning] : cells[1],
                example: columnIndex.example >= 0 ? cells[columnIndex.example] : '',
                phonetic: columnIndex.phonetic >= 0 ? cells[columnIndex.phonetic] : '',
                freq: columnIndex.freq >= 0 ? cells[columnIndex.freq] : null
            };
            const normalized = normalizeEntry(candidate);
            if (normalized) {
                entries.push(normalized);
            }
        }
        return buildImportResult('wordlist', entries, {
            format: 'csv',
            originalLength: Math.max(rows.length - 1, 0)
        });
    }

    function parseJson(text) {
        const payload = JSON.parse(text);
        if (Array.isArray(payload)) {
            return buildImportResult('wordlist', payload.map(normalizeEntry).filter(Boolean), {
                format: 'json',
                originalLength: payload.length
            });
        }
        if (payload && typeof payload === 'object' && Array.isArray(payload.words)) {
            const metaCategory = extractCategory(payload.meta, null);
            const declaredType = typeof payload.type === 'string' ? payload.type.trim().toLowerCase() : '';
            const explicitProgress = declaredType === 'progress' || declaredType === 'progress-backup';
            const hasListId = typeof payload.listId === 'string' && payload.listId.trim();
            const hasV2ProgressEnvelope = typeof payload.version === 'string'
                && isPlainObject(payload.config)
                && hasListId;
            const legacyProgressEnvelope = !declaredType
                && typeof payload.version === 'string'
                && isPlainObject(payload.config)
                && Array.isArray(payload.reviewQueue)
                && !hasListId;
            if (legacyProgressEnvelope) {
                throw new Error('不支持 v1 进度备份，请使用 v2 格式重新导出');
            }
            if (explicitProgress && !hasV2ProgressEnvelope) {
                throw new Error('进度备份缺少 v2 词表或配置数据');
            }
            const looksProgress = (explicitProgress || !declaredType) && hasV2ProgressEnvelope;
            const category = extractCategory(payload, metaCategory || (looksProgress ? 'user' : 'external'));
            if (looksProgress) {
                const entries = payload.words.map(cloneProgressEntry);
                if (entries.some((entry) => !entry)) {
                    throw new Error('进度备份包含无效词汇数据');
                }
                return buildImportResult('progress', entries, {
                    format: 'json',
                    originalLength: payload.words.length,
                    listId: typeof payload.listId === 'string' && payload.listId.trim()
                        ? payload.listId.trim()
                        : undefined,
                    category: category || 'user',
                    version: typeof payload.version === 'string' ? payload.version : undefined,
                    config: isPlainObject(payload.config) ? { ...payload.config } : undefined,
                    name: typeof payload.name === 'string' ? payload.name : undefined,
                    source: typeof payload.source === 'string' ? payload.source : undefined,
                    exportedAt: typeof payload.exportedAt === 'string' ? payload.exportedAt : undefined
                });
            }
            return buildImportResult('wordlist', payload.words.map(normalizeEntry).filter(Boolean), {
                format: 'json',
                originalLength: payload.words.length,
                category
            });
        }
        if (payload && typeof payload === 'object' && Array.isArray(payload.entries)) {
            const metaCategory = extractCategory(payload.meta, null);
            const category = extractCategory(payload, metaCategory || 'external');
            return buildImportResult('wordlist', payload.entries.map(normalizeEntry).filter(Boolean), {
                format: 'json',
                originalLength: payload.entries.length,
                category
            });
        }
        return buildImportResult('wordlist', [], { format: 'json' });
    }

    async function readFileAsText(file) {
        if (!file) {
            throw new Error('未提供文件');
        }
        if (typeof file.text === 'function') {
            return await file.text();
        }
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(reader.error || new Error('文件读取失败'));
            reader.onload = () => resolve(reader.result || '');
            reader.readAsText(file);
        });
    }

    async function importWordList(file) {
        if (!(file instanceof Blob)) {
            throw new Error('仅支持通过文件导入词表');
        }
        const name = typeof file.name === 'string' ? file.name.toLowerCase() : '';
        const extension = name.split('.').pop();
        const mimeType = typeof file.type === 'string' ? file.type.toLowerCase() : '';
        const text = await readFileAsText(file);
        let result;
        try {
            if (extension === 'csv' || SUPPORTED_CSV_TYPES.has(mimeType)) {
                result = parseCsv(text);
            } else if (extension === 'json' || SUPPORTED_JSON_TYPES.has(mimeType)) {
                result = parseJson(text);
            } else {
                // 默认按 JSON 解析
                result = parseJson(text);
            }
        } catch (error) {
            console.warn('[VocabDataIO] 词表解析失败:', error);
            throw error;
        }
        const normalizedResult = Array.isArray(result)
            ? buildImportResult('wordlist', result)
            : result;
        if (!normalizedResult.entries.length) {
            throw new Error('未在文件中发现有效词汇数据');
        }
        return normalizedResult;
    }

    async function exportProgress(words) {
        if (!window.AppData || !window.AppData.vocab) throw new Error('AppData.vocab 未加载');
        if (!Array.isArray(words)) throw new Error('当前词表尚未加载');
        await window.AppData.ready;
        const config = await window.AppData.vocab.getConfig();
        const listId = config.activeListId || 'default';
        const entries = words.map(cloneProgressEntry);
        if (entries.some((entry) => !entry)) {
            throw new Error('当前词表包含无效词汇数据');
        }
        const payload = {
            type: 'progress',
            version: DEFAULT_EXPORT_VERSION,
            exportedAt: new Date().toISOString(),
            listId,
            config,
            words: entries
        };
        return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    }

    const api = Object.freeze({
        importWordList,
        exportProgress,
        validateSchema,
        normalizeEntry
    });

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        window.VocabDataIO = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
