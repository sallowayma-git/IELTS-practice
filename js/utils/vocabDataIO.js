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

    const DEFAULT_EXPORT_VERSION = '1.0.0';

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
        const freq = normalizeFrequency(raw.freq);
        const normalized = {
            word,
            meaning,
            example,
        };
        if (freq !== null) {
            normalized.freq = freq;
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
        if (headerLine.includes(',')) {
            return ',';
        }
        if (headerLine.includes(';')) {
            return ';';
        }
        if (headerLine.includes('\t')) {
            return '\t';
        }
        return ',';
    }

    function splitCsvLine(line, delimiter) {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i += 1) {
            const char = line[i];
            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i += 1;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (!inQuotes && char === delimiter) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current.trim());
        return result;
    }

    function parseCsv(text) {
        const lines = String(text || '')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length);
        if (!lines.length) {
            return [];
        }
        const delimiter = selectDelimiter(lines[0]);
        const headerCells = splitCsvLine(lines[0], delimiter).map((cell) => cell.toLowerCase());
        const columnIndex = {
            word: headerCells.indexOf('word'),
            meaning: headerCells.indexOf('meaning'),
            example: headerCells.indexOf('example'),
            freq: headerCells.indexOf('freq')
        };
        const entries = [];
        for (let i = 1; i < lines.length; i += 1) {
            const cells = splitCsvLine(lines[i], delimiter);
            const candidate = {
                word: columnIndex.word >= 0 ? cells[columnIndex.word] : cells[0],
                meaning: columnIndex.meaning >= 0 ? cells[columnIndex.meaning] : cells[1],
                example: columnIndex.example >= 0 ? cells[columnIndex.example] : '',
                freq: columnIndex.freq >= 0 ? cells[columnIndex.freq] : null
            };
            const normalized = normalizeEntry(candidate);
            if (normalized) {
                entries.push(normalized);
            }
        }
        return entries;
    }

    function parseJson(text) {
        const payload = JSON.parse(text);
        if (Array.isArray(payload)) {
            return payload.map(normalizeEntry).filter(Boolean);
        }
        if (payload && typeof payload === 'object' && Array.isArray(payload.words)) {
            return payload.words.map(normalizeEntry).filter(Boolean);
        }
        return [];
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
        let entries = [];
        try {
            if (extension === 'csv' || SUPPORTED_CSV_TYPES.has(mimeType)) {
                entries = parseCsv(text);
            } else if (extension === 'json' || SUPPORTED_JSON_TYPES.has(mimeType)) {
                entries = parseJson(text);
            } else {
                // 默认按 JSON 解析
                entries = parseJson(text);
            }
        } catch (error) {
            console.warn('[VocabDataIO] 词表解析失败:', error);
            throw error;
        }
        if (!entries.length) {
            throw new Error('未在文件中发现有效词汇数据');
        }
        return entries;
    }

    async function exportProgress() {
        const store = window.VocabStore;
        if (!store || typeof store.init !== 'function') {
            throw new Error('VocabStore 未加载');
        }
        await store.init();
        const payload = {
            version: DEFAULT_EXPORT_VERSION,
            exportedAt: new Date().toISOString(),
            config: store.getConfig(),
            words: store.getWords(),
            reviewQueue: store.getReviewQueue()
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
