(function (global) {
    'use strict';

    const HTML_RE = /\.html?$/i;
    const PDF_RE = /\.pdf$/i;
    const AUDIO_RE = /\.(?:mp3|m4a|wav|ogg|aac|flac|webm)$/i;
    const VIDEO_RE = /\.(?:mp4|mov|m4v)$/i;
    const MAX_TITLE_LENGTH = 96;
    const LISTENING_THRESHOLD = 5;
    const MAX_DISCOVERY_FILES = 5000;
    const MAX_DISCOVERY_HTML_BYTES = 5 * 1024 * 1024;
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

    function normalizeSafeRelativePath(value) {
        const raw = String(value || '').trim();
        if (!raw) {
            return '';
        }
        if (/^[a-zA-Z]:[\\/]/.test(raw) || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) {
            return '';
        }
        const normalized = normalizePath(raw);
        if (!normalized) {
            return '';
        }
        const segments = normalized.split('/').filter(Boolean);
        if (!segments.length) {
            return '';
        }
        if (segments.some((segment) => segment === '.' || segment === '..' || segment.includes(':'))) {
            return '';
        }
        return segments.join('/');
    }

    function stripTrailingSlash(value) {
        return normalizePath(value).replace(/\/+$/g, '');
    }

    function ensureTrailingSlash(value) {
        const normalized = stripTrailingSlash(value);
        return normalized ? normalized + '/' : '';
    }

    function getFilePath(file) {
        if (!file) {
            return '';
        }
        const relativeCandidates = [
            file.webkitRelativePath,
            file.relativePath,
            file.fullPath
        ];
        for (const candidate of relativeCandidates) {
            const normalized = normalizeSafeRelativePath(candidate);
            if (normalized) {
                return normalized;
            }
        }
        return normalizeSafeRelativePath(file.name);
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

    function getTextByteLength(value) {
        const text = String(value || '');
        if (typeof TextEncoder !== 'undefined') {
            return new TextEncoder().encode(text).byteLength;
        }
        return text.length;
    }

    function getDeclaredFileSize(file) {
        const size = Number(file && file.size);
        return Number.isFinite(size) && size >= 0 ? size : 0;
    }

    function isHtmlTooLarge(file, text) {
        const declaredSize = getDeclaredFileSize(file);
        if (declaredSize > MAX_DISCOVERY_HTML_BYTES) {
            return true;
        }
        return text !== undefined && getTextByteLength(text) > MAX_DISCOVERY_HTML_BYTES;
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

    function hasAnySignal(signals, names) {
        return names.some(function (name) {
            return signals.indexOf(name) !== -1;
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

        const hasAnswerPath = hasAnySignal(signals, ['config-answer-key', 'finish-test', 'bridge-or-tracker'])
            && hasAnySignal(signals, ['config-answer-key', 'review-or-score', 'bridge-or-tracker']);
        const hasListeningShell = hasAnySignal(signals, ['audio-ui', 'nearby-audio', 'ielts-listening-title'])
            && hasAnySignal(signals, ['question-layout', 'review-or-score', 'config-answer-key']);
        const hasReadingConflict = signals.indexOf('reading-negative') !== -1;
        let reason = 'listening-html-signals';
        if (hasReadingConflict) {
            reason = 'looks-like-reading';
        } else if (score < LISTENING_THRESHOLD) {
            reason = 'insufficient-listening-signals';
        } else if (!hasAnswerPath) {
            reason = 'missing-answer-or-scoring-path';
        } else if (!hasListeningShell) {
            reason = 'missing-listening-page-signals';
        }
        const accepted = !hasReadingConflict
            && hasAnswerPath
            && hasListeningShell
            && score >= LISTENING_THRESHOLD;

        return {
            accepted,
            score,
            signals,
            reason: accepted ? 'listening-html-signals' : reason,
            sample: lower.slice(0, 120)
        };
    }

    function isListeningLikeDetection(detection) {
        if (!detection || !Array.isArray(detection.signals)) {
            return false;
        }
        const signals = detection.signals;
        if (signals.indexOf('reading-negative') !== -1) {
            return false;
        }
        const hasShell = hasAnySignal(signals, ['audio-ui', 'nearby-audio', 'ielts-listening-title']);
        const hasQuestions = hasAnySignal(signals, ['question-layout', 'review-or-score', 'config-answer-key', 'finish-test']);
        return detection.accepted || (hasShell && hasQuestions && Number(detection.score) >= LISTENING_THRESHOLD);
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
        if (isHtmlTooLarge(file)) {
            console.warn('[LibraryDiscovery] HTML file skipped because it is too large');
            return '';
        }
        if (typeof file.text === 'function') {
            try {
                const text = await file.text();
                if (isHtmlTooLarge(file, text)) {
                    console.warn('[LibraryDiscovery] HTML file skipped because decoded text is too large');
                    return '';
                }
                return text;
            } catch (error) {
                console.warn('[LibraryDiscovery] file.text failed:', error);
            }
        }
        if (typeof file.content === 'string') {
            if (isHtmlTooLarge(file, file.content)) {
                console.warn('[LibraryDiscovery] HTML content skipped because it is too large');
                return '';
            }
            return file.content;
        }
        if (typeof file.__text === 'string') {
            if (isHtmlTooLarge(file, file.__text)) {
                console.warn('[LibraryDiscovery] HTML text skipped because it is too large');
                return '';
            }
            return file.__text;
        }
        return '';
    }

    async function toFileRecords(files) {
        const allInput = Array.isArray(files) ? files : Array.prototype.slice.call(files || []);
        const input = allInput.slice(0, MAX_DISCOVERY_FILES);
        if (allInput.length > MAX_DISCOVERY_FILES) {
            console.warn(`[LibraryDiscovery] File picker import truncated to ${MAX_DISCOVERY_FILES} files.`);
        }
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
                    if (isListeningLikeDetection(listening)) {
                        rejected.push({
                            path: record.path,
                            reason: 'looks-like-listening',
                            score: listening.score,
                            signals: listening.signals
                        });
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

    function escapeHtmlAttribute(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function createSandboxedRuntimeHtml(innerHtml, title) {
        const safeTitle = cleanTitle(title) || 'Imported Practice';
        const csp = [
            "default-src 'self' blob: data:",
            "script-src 'unsafe-inline' blob: data:",
            "style-src 'unsafe-inline' blob: data:",
            "img-src blob: data:",
            "media-src blob: data:",
            "font-src blob: data:",
            "connect-src 'none'",
            "object-src 'none'",
            "frame-src 'none'",
            "child-src 'none'",
            "worker-src 'none'",
            "base-uri 'none'",
            "form-action 'none'",
            "navigate-to 'none'",
            "frame-ancestors 'self'"
        ].join('; ');
        const frameSrcdoc = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(csp)}">${innerHtml}`;
        return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtmlAttribute(safeTitle)}</title>
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' blob: data:; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; frame-src 'self' blob: data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#fff}#imported-practice-frame{border:0;width:100%;height:100%;display:block}</style>
</head>
<body>
  <iframe id="imported-practice-frame" sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="${escapeHtmlAttribute(frameSrcdoc)}"></iframe>
  <script>
    (function () {
      var frame = document.getElementById('imported-practice-frame');
      var targetOrigin = (location.origin && location.origin !== 'null' && /^https?:\\/\\//i.test(location.origin)) ? location.origin : '*';
      var allowedFromFrame = {
        SESSION_READY: true,
        REQUEST_INIT: true,
        PRACTICE_COMPLETE: true,
        practice_completed: true
      };
      var allowedFromParent = {
        INIT_SESSION: true,
        init_exam_session: true,
        REPLAY_PRACTICE_RECORD: true,
        REVIEW_CONTEXT: true,
        SUITE_NAVIGATE: true,
        SUITE_FORCE_CLOSE: true,
        ENDLESS_COUNTDOWN: true
      };
      function isParent(event) {
        return event && event.source && (event.source === window.opener || event.source === window.parent);
      }
      function sameOriginParent(event) {
        if (!isParent(event)) return false;
        if (!event.origin || event.origin === 'null') {
          return location.protocol === 'file:';
        }
        return location.origin && location.origin !== 'null' && event.origin === location.origin;
      }
      function getType(data) {
        return data && typeof data.type === 'string' ? data.type : '';
      }
      window.addEventListener('message', function (event) {
        var type = getType(event.data);
        if (!type) return;
        if (frame && event.source === frame.contentWindow) {
          if (!allowedFromFrame[type]) return;
          if (window.opener && typeof window.opener.postMessage === 'function') {
            window.opener.postMessage(event.data, targetOrigin);
          } else if (window.parent && window.parent !== window && typeof window.parent.postMessage === 'function') {
            window.parent.postMessage(event.data, targetOrigin);
          }
          return;
        }
        if (sameOriginParent(event) && allowedFromParent[type] && frame && frame.contentWindow) {
          frame.contentWindow.postMessage(event.data, '*');
        }
      });
    })();
  </script>
</body>
</html>`;
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
        return createSandboxedRuntimeHtml(html, record && (record.title || record.name || record.path));
    }

    function registerRuntimeResources(entries, records) {
        const stats = { registered: 0, html: 0, pdf: 0, audio: 0 };
        if (!Array.isArray(entries) || !Array.isArray(records) || !entries.length) {
            return stats;
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
                entry.runtimeResourceMode = 'session-blob';
                entry.runtimeResources = Object.keys(runtime);
                stats.registered += 1;
                if (runtime.html) stats.html += 1;
                if (runtime.pdf) stats.pdf += 1;
                if (runtime.audio) stats.audio += 1;
            }
        });
        return stats;
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

    function countByReason(rejected) {
        return (Array.isArray(rejected) ? rejected : []).reduce(function (acc, item) {
            const reason = item && item.reason ? item.reason : 'unknown';
            acc[reason] = (acc[reason] || 0) + 1;
            return acc;
        }, {});
    }

    function buildDiscoveryReport(type, result, records, runtime) {
        const entries = Array.isArray(result && result.entries) ? result.entries : [];
        const rejected = Array.isArray(result && result.rejected) ? result.rejected : [];
        const fileRecords = Array.isArray(records) ? records : [];
        const runtimeStats = runtime || { registered: 0, html: 0, pdf: 0, audio: 0 };
        return {
            type,
            accepted: entries.length,
            rejected: rejected.length,
            files: fileRecords.length,
            html: fileRecords.filter(function (record) { return record.kind === 'html'; }).length,
            pdf: fileRecords.filter(function (record) { return record.kind === 'pdf'; }).length,
            audio: fileRecords.filter(isAudioRecord).length,
            runtime: runtimeStats,
            reasonCounts: countByReason(rejected),
            rejectedSamples: rejected.slice(0, 8).map(function (item) {
                return {
                    path: item.path,
                    reason: item.reason,
                    score: item.score,
                    signals: Array.isArray(item.signals) ? item.signals.slice(0, 8) : []
                };
            }),
            warnings: runtimeStats.html > 0
                ? ['file-picker-session-resources']
                : []
        };
    }

    async function discover(files, options) {
        const opts = options || {};
        const type = opts.type === 'reading' ? 'reading' : 'listening';
        const records = await toFileRecords(files);
        const groups = groupByDir(records);
        const result = type === 'reading'
            ? discoverReadingEntries(groups, opts)
            : discoverListeningEntries(groups, opts);
        let runtime = { registered: 0, html: 0, pdf: 0, audio: 0 };
        if (opts.registerRuntime !== false) {
            runtime = registerRuntimeResources(result.entries, records);
        }
        const report = buildDiscoveryReport(type, result, records, runtime);
        return {
            entries: result.entries,
            rejected: result.rejected,
            runtime,
            report,
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
            slugify,
            isListeningLikeDetection
        }
    };
})(typeof window !== 'undefined' ? window : globalThis);
