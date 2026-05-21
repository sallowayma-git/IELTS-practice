(function (global) {
    'use strict';

    const HTML_RE = /\.html?$/i;
    const PDF_RE = /\.pdf$/i;
    const AUDIO_RE = /\.(?:mp3|m4a|wav|ogg|aac|flac|webm)$/i;
    const VIDEO_RE = /\.(?:mp4|mov|m4v)$/i;
    const MAX_TITLE_LENGTH = 96;
    const LISTENING_THRESHOLD = 5;
    const runtimeResources = new Map();
    const runtimeObjectUrls = [];

    function normalizePath(value) {
        return String(value || '')
            .replace(/\\/g, '/')
            .replace(/^\.\//, '')
            .replace(/^\/+/, '')
            .replace(/\/{2,}/g, '/')
            .trim();
    }

    function stripTrailingSlash(value) {
        return normalizePath(value).replace(/\/+$/g, '');
    }

    function ensureTrailingSlash(value) {
        const normalized = stripTrailingSlash(value);
        return normalized ? normalized + '/' : '';
    }

    function getFilePath(file) {
        return normalizePath(
            file && (
                file.webkitRelativePath
                || file.relativePath
                || file.fullPath
                || file.path
                || file.name
            )
        );
    }

    function getBaseName(path) {
        const parts = normalizePath(path).split('/').filter(Boolean);
        return parts.length ? parts[parts.length - 1] : '';
    }

    function getDirName(path) {
        const normalized = normalizePath(path);
        const index = normalized.lastIndexOf('/');
        return index >= 0 ? normalized.slice(0, index) : '';
    }

    function getExtensionType(path) {
        const name = getBaseName(path).toLowerCase();
        if (HTML_RE.test(name)) return 'html';
        if (PDF_RE.test(name)) return 'pdf';
        if (AUDIO_RE.test(name)) return 'audio';
        if (VIDEO_RE.test(name)) return 'video';
        return 'other';
    }

    function decodeHtmlEntities(value) {
        return String(value || '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/g, "'")
            .replace(/&#(\d+);/g, function (_, code) {
                const value = Number(code);
                return Number.isFinite(value) ? String.fromCharCode(value) : _;
            });
    }

    function cleanTitle(value) {
        let title = decodeHtmlEntities(value)
            .replace(/\s+/g, ' ')
            .replace(/^IELTS\s+Listening\s+(?:Practice\s*)?[-:·]?\s*/i, '')
            .replace(/^Listening\s+(?:Practice\s*)?[-:·]?\s*/i, '')
            .replace(/^IELTS\s+Reading\s+(?:Practice\s*)?[-:·]?\s*/i, '')
            .replace(/\.html?$/i, '')
            .trim();
        title = title.replace(/^\d+\.\s*/, '').trim();
        if (title.length > MAX_TITLE_LENGTH) {
            title = title.slice(0, MAX_TITLE_LENGTH).trim();
        }
        return title;
    }

    function titleFromHtml(html) {
        const source = String(html || '');
        const titleMatch = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        if (titleMatch && cleanTitle(titleMatch[1])) {
            return cleanTitle(titleMatch[1]);
        }
        const h1Match = source.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        if (h1Match && cleanTitle(h1Match[1].replace(/<[^>]+>/g, ' '))) {
            return cleanTitle(h1Match[1].replace(/<[^>]+>/g, ' '));
        }
        return '';
    }

    function titleFromPath(path) {
        const fileTitle = cleanTitle(getBaseName(path));
        if (fileTitle && !/^index$/i.test(fileTitle)) {
            return fileTitle;
        }
        const dir = getDirName(path);
        return cleanTitle(getBaseName(dir)) || fileTitle || 'Imported Practice';
    }

    function slugify(value) {
        const ascii = String(value || '')
            .toLowerCase()
            .replace(/['"]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 48);
        if (ascii) {
            return ascii;
        }
        return 'imported';
    }

    function hashString(value) {
        let hash = 2166136261;
        const text = String(value || '');
        for (let i = 0; i < text.length; i += 1) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
    }

    function inferCategory(path, html) {
        const combined = `${path || ''}\n${html || ''}`;
        const match = combined.match(/(?:^|[^\w])P\s*([1-4])(?:[^\w]|$)/i);
        return match ? `P${match[1]}` : 'Custom';
    }

    function inferQuestionNumber(path, title) {
        const match = String(path || title || '').match(/(?:^|\/)\s*(\d{1,3})(?:\.|\s)/);
        if (!match) {
            return undefined;
        }
        const value = Number(match[1]);
        return Number.isFinite(value) ? value : undefined;
    }

    function inferFrequency(path) {
        const text = String(path || '').toLowerCase();
        if (/超高频|ultra|very\s*high/.test(text)) return '超高频';
        if (/次高频/.test(text)) return '次高频';
        if (/高频|high/.test(text)) return '高频';
        if (/中频|medium|mid/.test(text)) return '中频';
        if (/低频|low/.test(text)) return '低频';
        return '';
    }

    function hasNearbyAudio(records) {
        return records.some(function (record) {
            return record && (record.kind === 'audio' || record.kind === 'video');
        });
    }

    function scoreListeningHtml(html, path, nearbyRecords) {
        const source = String(html || '');
        const haystack = `${path || ''}\n${source}`;
        const lower = haystack.toLowerCase();
        const signals = [];
        let score = 0;

        function add(name, weight, matched) {
            if (!matched) return;
            score += weight;
            signals.push(name);
        }

        add('config-answer-key', 4, /CONFIG_DATA\s*=|answerKey\s*[:=]|answerKey\.(?:text|single|matching|multiple)/i.test(haystack));
        add('finish-test', 2, /finishTest\s*\(|finish\s+test/i.test(haystack));
        add('audio-ui', 2, /<audio\b|audio-player|audiofilename|new\s+Audio\s*\(|\.(?:mp3|m4a|wav|ogg|aac)/i.test(haystack));
        add('nearby-audio', 2, hasNearbyAudio(nearbyRecords || []));
        add('ielts-listening-title', 3, /IELTS\s+Listening|Listening\s+Practice/i.test(haystack));
        add('review-or-score', 1, /timerSecs|isReviewing|results-table|review-table|correctAnswers?|correctAns/i.test(haystack));
        add('bridge-or-tracker', 2, /listeningRecordBridge|PracticeTracker|PRACTICE_COMPLETE|PRACTICE_RESULT/i.test(haystack));
        add('question-layout', 1, /Questions?\s+\d+|questionsPage|class=["'][^"']*question|data-question/i.test(haystack));

        if (/reading-practice-unified|reading passage|passage\s+1|reading-exams/i.test(haystack)) {
            score -= 4;
            signals.push('reading-negative');
        }

        return {
            accepted: score >= LISTENING_THRESHOLD,
            score,
            signals,
            reason: score >= LISTENING_THRESHOLD ? 'listening-html-signals' : 'insufficient-listening-signals',
            sample: lower.slice(0, 120)
        };
    }

    function isPdfRecord(record) {
        return record && record.kind === 'pdf';
    }

    function isAudioRecord(record) {
        return record && (record.kind === 'audio' || record.kind === 'video');
    }

    function selectAssociatedRecord(records, predicate, htmlRecord) {
        const matches = records.filter(predicate);
        if (!matches.length) {
            return null;
        }
        const htmlStem = htmlRecord
            ? getBaseName(htmlRecord.path).replace(/\.[^.]+$/, '').toLowerCase()
            : '';
        const sameStem = matches.find(function (record) {
            return getBaseName(record.path).replace(/\.[^.]+$/, '').toLowerCase() === htmlStem;
        });
        if (sameStem) {
            return sameStem;
        }
        const audioMp3 = matches.find(function (record) {
            return /^audio\.mp3$/i.test(getBaseName(record.path));
        });
        return audioMp3 || matches[0];
    }

    function makeEntry(type, htmlRecord, groupRecords, options) {
        const path = htmlRecord ? htmlRecord.path : (groupRecords[0] && groupRecords[0].path);
        const dir = getDirName(path);
        const html = htmlRecord && htmlRecord.text ? htmlRecord.text : '';
        const title = (htmlRecord && titleFromHtml(html)) || titleFromPath(path);
        const sourcePath = normalizePath(path);
        const idSource = `${type}:${sourcePath}`;
        const id = `custom-${type}-${slugify(sourcePath)}-${hashString(idSource).slice(0, 8)}`;
        const pdfRecord = selectAssociatedRecord(groupRecords, isPdfRecord, htmlRecord);
        const audioRecord = selectAssociatedRecord(groupRecords, isAudioRecord, htmlRecord);
        const label = cleanTitle(options && options.label);
        const entryTitle = label ? `[${label}] ${title}` : title;
        const category = type === 'listening'
            ? inferCategory(sourcePath, html)
            : inferCategory(sourcePath, html).replace('P4', 'P3');
        const frequency = inferFrequency(sourcePath);
        const questionNumber = inferQuestionNumber(sourcePath, entryTitle);
        const importKey = `${type}:${sourcePath.toLowerCase()}`;

        const entry = {
            id,
            examId: id,
            dataKey: id,
            title: entryTitle,
            category,
            type,
            path: ensureTrailingSlash(dir),
            filename: htmlRecord ? getBaseName(htmlRecord.path) : undefined,
            pdfFilename: pdfRecord ? getBaseName(pdfRecord.path) : undefined,
            hasHtml: !!htmlRecord,
            sourcePath,
            importKey,
            sourceKind: 'file-picker',
            detectedBy: htmlRecord && htmlRecord.detection ? htmlRecord.detection.signals.slice() : [],
            discoveryConfidence: htmlRecord && htmlRecord.detection ? htmlRecord.detection.score : 0
        };

        if (audioRecord) {
            entry.audioFilename = getBaseName(audioRecord.path);
            entry.hasAudio = true;
        } else {
            entry.hasAudio = false;
        }
        if (frequency) {
            entry.frequency = frequency;
        }
        if (questionNumber !== undefined) {
            entry.questionNumber = questionNumber;
        }
        return entry;
    }

    async function readText(file) {
        if (!file) {
            return '';
        }
        if (typeof file.text === 'function') {
            try {
                return await file.text();
            } catch (error) {
                console.warn('[LibraryDiscovery] file.text failed:', error);
            }
        }
        if (typeof file.content === 'string') {
            return file.content;
        }
        if (typeof file.__text === 'string') {
            return file.__text;
        }
        return '';
    }

    async function toFileRecords(files) {
        const input = Array.isArray(files) ? files : Array.prototype.slice.call(files || []);
        const records = [];
        for (let i = 0; i < input.length; i += 1) {
            const file = input[i];
            const path = getFilePath(file);
            if (!path) {
                continue;
            }
            const kind = getExtensionType(path);
            const record = {
                file,
                path,
                dir: getDirName(path),
                name: getBaseName(path),
                kind,
                text: ''
            };
            if (kind === 'html') {
                record.text = await readText(file);
            }
            records.push(record);
        }
        return records;
    }

    function groupByDir(records) {
        const groups = new Map();
        records.forEach(function (record) {
            if (!groups.has(record.dir)) {
                groups.set(record.dir, []);
            }
            groups.get(record.dir).push(record);
        });
        return groups;
    }

    function discoverReadingEntries(groups, options) {
        const entries = [];
        const rejected = [];
        groups.forEach(function (records) {
            const htmlRecords = records.filter(function (record) { return record.kind === 'html'; });
            const pdfRecords = records.filter(function (record) { return record.kind === 'pdf'; });
            const candidates = htmlRecords.length ? htmlRecords : pdfRecords.slice(0, 1);
            candidates.forEach(function (record) {
                if (record.kind === 'html') {
                    const listening = scoreListeningHtml(record.text, record.path, records);
                    if (listening.accepted) {
                        rejected.push({ path: record.path, reason: 'looks-like-listening', score: listening.score });
                        return;
                    }
                    record.detection = { score: 1, signals: ['html-or-pdf'] };
                    entries.push(makeEntry('reading', record, records, options));
                    return;
                }
                const fakeHtml = null;
                const entry = makeEntry('reading', fakeHtml, records, options);
                entry.filename = undefined;
                entry.pdfFilename = getBaseName(record.path);
                entry.path = ensureTrailingSlash(record.dir);
                entry.sourcePath = record.path;
                entry.importKey = `reading:${record.path.toLowerCase()}`;
                entry.hasHtml = false;
                entry.detectedBy = ['pdf'];
                entries.push(entry);
            });
        });
        return { entries, rejected };
    }

    function discoverListeningEntries(groups, options) {
        const entries = [];
        const rejected = [];
        groups.forEach(function (records) {
            records
                .filter(function (record) { return record.kind === 'html'; })
                .forEach(function (record) {
                    const detection = scoreListeningHtml(record.text, record.path, records);
                    record.detection = detection;
                    if (!detection.accepted) {
                        rejected.push({
                            path: record.path,
                            reason: detection.reason,
                            score: detection.score,
                            signals: detection.signals
                        });
                        return;
                    }
                    entries.push(makeEntry('listening', record, records, options));
                });
        });
        return { entries, rejected };
    }

    function createObjectUrl(blobLike) {
        if (!global.URL || typeof global.URL.createObjectURL !== 'function' || !blobLike) {
            return '';
        }
        try {
            const url = global.URL.createObjectURL(blobLike);
            runtimeObjectUrls.push(url);
            return url;
        } catch (error) {
            console.warn('[LibraryDiscovery] createObjectURL failed:', error);
            return '';
        }
    }

    function replaceAllLiteral(source, needle, replacement) {
        if (!needle || !replacement || source.indexOf(needle) === -1) {
            return source;
        }
        return source.split(needle).join(replacement);
    }

    function buildRuntimeHtml(record, groupRecords, assetUrls) {
        let html = String(record && record.text || '');
        groupRecords.forEach(function (asset) {
            if (!asset || asset.kind === 'html') {
                return;
            }
            const url = assetUrls.get(asset.path);
            if (!url) {
                return;
            }
            const name = getBaseName(asset.path);
            const relative = normalizePath(asset.path).slice(ensureTrailingSlash(record.dir).length);
            html = replaceAllLiteral(html, relative, url);
            html = replaceAllLiteral(html, name, url);
        });
        return html;
    }

    function registerRuntimeResources(entries, records) {
        if (!Array.isArray(entries) || !Array.isArray(records) || !entries.length) {
            return;
        }
        const recordsByPath = new Map(records.map(function (record) { return [record.path, record]; }));
        const groups = groupByDir(records);

        entries.forEach(function (entry) {
            if (!entry || !entry.sourcePath) {
                return;
            }
            const htmlRecord = recordsByPath.get(entry.sourcePath);
            const groupRecords = groups.get(getDirName(entry.sourcePath)) || [];
            const assetUrls = new Map();

            groupRecords.forEach(function (record) {
                if (record.kind === 'html') {
                    return;
                }
                const assetUrl = createObjectUrl(record.file);
                if (assetUrl) {
                    assetUrls.set(record.path, assetUrl);
                }
            });

            const runtime = {};
            if (htmlRecord && typeof global.Blob === 'function') {
                const rewritten = buildRuntimeHtml(htmlRecord, groupRecords, assetUrls);
                const blob = new global.Blob([rewritten], { type: 'text/html;charset=utf-8' });
                runtime.html = createObjectUrl(blob);
            } else if (htmlRecord) {
                runtime.html = createObjectUrl(htmlRecord.file);
            }

            if (entry.pdfFilename) {
                const pdfRecord = groupRecords.find(function (record) {
                    return record.kind === 'pdf' && getBaseName(record.path) === entry.pdfFilename;
                });
                if (pdfRecord) {
                    runtime.pdf = assetUrls.get(pdfRecord.path) || createObjectUrl(pdfRecord.file);
                }
            }
            if (entry.audioFilename) {
                const audioRecord = groupRecords.find(function (record) {
                    return isAudioRecord(record) && getBaseName(record.path) === entry.audioFilename;
                });
                if (audioRecord) {
                    runtime.audio = assetUrls.get(audioRecord.path) || createObjectUrl(audioRecord.file);
                }
            }

            if (runtime.html || runtime.pdf || runtime.audio) {
                runtimeResources.set(entry.importKey || entry.id, runtime);
                runtimeResources.set(entry.id, runtime);
            }
        });
    }

    function resolveRuntimeResource(exam, kind) {
        if (!exam) {
            return '';
        }
        const resourceKind = kind === 'pdf' ? 'pdf' : 'html';
        const keys = [exam.importKey, exam.id, exam.examId, exam.dataKey].filter(Boolean);
        for (let i = 0; i < keys.length; i += 1) {
            const record = runtimeResources.get(keys[i]);
            if (record && record[resourceKind]) {
                return record[resourceKind];
            }
        }
        return '';
    }

    function normalizeMergeKey(exam) {
        if (!exam) {
            return '';
        }
        const importKey = String(exam.importKey || '').trim().toLowerCase();
        if (importKey) {
            return importKey;
        }
        const sourcePath = String(exam.sourcePath || '').trim().toLowerCase();
        if (sourcePath) {
            return `${exam.type || ''}:${sourcePath}`;
        }
        return [
            exam.type || '',
            exam.path || '',
            exam.filename || '',
            exam.pdfFilename || '',
            exam.title || ''
        ].join('|').toLowerCase();
    }

    function mergeExamIndexes(currentIndex, additions, options) {
        const current = Array.isArray(currentIndex) ? currentIndex.slice() : [];
        const incoming = Array.isArray(additions) ? additions.slice() : [];
        const mode = options && options.mode === 'full' ? 'full' : 'incremental';
        const type = options && options.type;

        const base = mode === 'full' && type
            ? current.filter(function (exam) { return !exam || exam.type !== type; })
            : current;

        const positions = new Map();
        base.forEach(function (exam, index) {
            const key = normalizeMergeKey(exam);
            if (key) {
                positions.set(key, index);
            }
        });

        let added = 0;
        let updated = 0;
        incoming.forEach(function (exam) {
            const key = normalizeMergeKey(exam);
            if (key && positions.has(key)) {
                base[positions.get(key)] = exam;
                updated += 1;
                return;
            }
            if (key) {
                positions.set(key, base.length);
            }
            base.push(exam);
            added += 1;
        });

        return { index: base, added, updated, skipped: Math.max(0, incoming.length - added - updated) };
    }

    async function discover(files, options) {
        const opts = options || {};
        const type = opts.type === 'reading' ? 'reading' : 'listening';
        const records = await toFileRecords(files);
        const groups = groupByDir(records);
        const result = type === 'reading'
            ? discoverReadingEntries(groups, opts)
            : discoverListeningEntries(groups, opts);
        if (opts.registerRuntime !== false) {
            registerRuntimeResources(result.entries, records);
        }
        return {
            entries: result.entries,
            rejected: result.rejected,
            stats: {
                files: records.length,
                html: records.filter(function (record) { return record.kind === 'html'; }).length,
                pdf: records.filter(function (record) { return record.kind === 'pdf'; }).length,
                audio: records.filter(isAudioRecord).length,
                accepted: result.entries.length,
                rejected: result.rejected.length
            }
        };
    }

    function clearRuntimeResources() {
        if (global.URL && typeof global.URL.revokeObjectURL === 'function') {
            runtimeObjectUrls.splice(0).forEach(function (url) {
                try { global.URL.revokeObjectURL(url); } catch (_) { }
            });
        } else {
            runtimeObjectUrls.length = 0;
        }
        runtimeResources.clear();
    }

    global.LibraryDiscovery = {
        discover,
        mergeExamIndexes,
        registerRuntimeResources,
        resolveRuntimeResource,
        clearRuntimeResources,
        scoreListeningHtml,
        normalizeMergeKey,
        _runtimeResources: runtimeResources,
        _private: {
            normalizePath,
            inferCategory,
            inferFrequency,
            hashString,
            slugify
        }
    };
})(typeof window !== 'undefined' ? window : globalThis);
