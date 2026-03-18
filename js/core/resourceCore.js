(function (global) {
    'use strict';

    const PATH_PROTOCOL_RE = /^(?:[a-z]+:)?\/\//i;
    const WINDOWS_DRIVE_RE = /^[A-Za-z]:\\/;
    const PATH_MAP_STORAGE_PREFIX = 'exam_path_map__';
    const BASE_PREFIX_STORAGE_KEY = 'hp.basePrefix';
    const PATH_FALLBACK_ORDER = ['map', 'fallback', 'raw', 'relative-up', 'relative-design'];
    const RAW_DEFAULT_PATH_MAP = {
        reading: {
            root: '睡着过项目组/2. 所有文章(11.20)[192篇]/',
            exceptions: {}
        },
        listening: {
            root: 'ListeningPractice/',
            exceptions: {}
        }
    };

    function isAbsolutePath(value) {
        return PATH_PROTOCOL_RE.test(value || '') || WINDOWS_DRIVE_RE.test(value || '');
    }

    function clonePathMap(map, fallback = RAW_DEFAULT_PATH_MAP) {
        const source = map && typeof map === 'object' ? map : fallback;
        const cloneCategory = (category) => {
            const segment = source[category] && typeof source[category] === 'object' ? source[category] : {};
            return {
                root: typeof segment.root === 'string' ? segment.root : '',
                exceptions: segment.exceptions && typeof segment.exceptions === 'object'
                    ? Object.assign({}, segment.exceptions)
                    : {}
            };
        };
        return {
            reading: cloneCategory('reading'),
            listening: cloneCategory('listening')
        };
    }

    function normalizePathRoot(value) {
        if (!value) {
            return '';
        }
        let root = String(value).replace(/\\/g, '/');
        root = root.replace(/\/+$/, '') + '/';
        if (root.startsWith('./')) {
            root = root.slice(2);
        }
        return root;
    }

    function mergeRootWithFallback(root, fallbackRoot) {
        const normalizedPrimary = normalizePathRoot(root || '');
        if (normalizedPrimary) {
            return normalizedPrimary;
        }
        return normalizePathRoot(fallbackRoot || '');
    }

    function buildOverridePathMap(metadata, fallback = RAW_DEFAULT_PATH_MAP) {
        const base = clonePathMap(fallback);
        if (!metadata || typeof metadata !== 'object') {
            return base;
        }

        const rootMeta = metadata.pathRoot;
        if (rootMeta && typeof rootMeta === 'object') {
            if (rootMeta.reading) {
                base.reading.root = normalizePathRoot(rootMeta.reading);
            }
            if (rootMeta.listening) {
                base.listening.root = normalizePathRoot(rootMeta.listening);
            }
        }

        return base;
    }

    const DEFAULT_PATH_MAP = buildOverridePathMap(
        typeof global !== 'undefined' ? global.examIndexMetadata : null,
        RAW_DEFAULT_PATH_MAP
    );

    function normalizePathMap(map, fallback = DEFAULT_PATH_MAP) {
        const base = clonePathMap(fallback);
        const incoming = clonePathMap(map);
        if (incoming.reading.root) {
            base.reading.root = normalizePathRoot(incoming.reading.root);
        }
        if (incoming.listening.root) {
            base.listening.root = normalizePathRoot(incoming.listening.root);
        }
        if (Object.keys(incoming.reading.exceptions).length) {
            base.reading.exceptions = Object.assign({}, incoming.reading.exceptions);
        }
        if (Object.keys(incoming.listening.exceptions).length) {
            base.listening.exceptions = Object.assign({}, incoming.listening.exceptions);
        }
        return base;
    }

    function computeCommonRoot(paths) {
        if (!paths || !paths.length) {
            return '';
        }
        const segmentsList = paths.map((rawPath) => {
            if (typeof rawPath !== 'string') {
                return [];
            }
            const normalized = rawPath.replace(/\\/g, '/').replace(/\/+$/g, '');
            return normalized ? normalized.split('/') : [];
        }).filter((segments) => segments.length);

        if (!segmentsList.length) {
            return '';
        }

        let prefix = segmentsList[0].slice();
        for (let i = 1; i < segmentsList.length; i += 1) {
            const segments = segmentsList[i];
            let index = 0;
            while (index < prefix.length && index < segments.length && prefix[index] === segments[index]) {
                index += 1;
            }
            if (index === 0) {
                return '';
            }
            prefix = prefix.slice(0, index);
        }

        return prefix.length ? prefix.join('/') + '/' : '';
    }

    function derivePathMapFromIndex(exams, fallbackMap = DEFAULT_PATH_MAP) {
        const fallback = normalizePathMap(fallbackMap);
        const result = clonePathMap(fallback);

        if (!Array.isArray(exams)) {
            return result;
        }

        const pathsByType = { reading: [], listening: [] };
        exams.forEach((exam) => {
            if (!exam || typeof exam.path !== 'string' || !exam.type) {
                return;
            }
            const normalized = exam.path.replace(/\\/g, '/');
            if (exam.type === 'reading') {
                pathsByType.reading.push(normalized);
            } else if (exam.type === 'listening') {
                pathsByType.listening.push(normalized);
            }
        });

        const readingRoot = computeCommonRoot(pathsByType.reading);
        if (pathsByType.reading.length) {
            result.reading.root = readingRoot ? normalizePathRoot(readingRoot) : '';
        }

        const listeningRoot = computeCommonRoot(pathsByType.listening);
        if (pathsByType.listening.length) {
            result.listening.root = listeningRoot ? normalizePathRoot(listeningRoot) : '';
        }

        return result;
    }

    function getPathMapStorageKey(key) {
        return PATH_MAP_STORAGE_PREFIX + key;
    }

    function setActivePathMap(map) {
        const normalized = normalizePathMap(map);
        try { global.__activeLibraryPathMap = normalized; } catch (_) { }
        try { global.pathMap = normalized; } catch (_) { }
        return normalized;
    }

    function getPathMap() {
        if (global.__activeLibraryPathMap && typeof global.__activeLibraryPathMap === 'object') {
            return normalizePathMap(global.__activeLibraryPathMap);
        }
        if (global.pathMap && typeof global.pathMap === 'object') {
            return normalizePathMap(global.pathMap);
        }
        return clonePathMap(DEFAULT_PATH_MAP);
    }

    async function loadPathMapForConfiguration(key) {
        if (!key || !global.storage || typeof global.storage.get !== 'function') {
            return clonePathMap(DEFAULT_PATH_MAP);
        }
        try {
            const stored = await global.storage.get(getPathMapStorageKey(key));
            if (stored && typeof stored === 'object') {
                return normalizePathMap(stored, DEFAULT_PATH_MAP);
            }
        } catch (error) {
            console.warn('[ResourceCore] 读取路径映射失败:', error);
        }
        return clonePathMap(DEFAULT_PATH_MAP);
    }

    async function savePathMapForConfiguration(key, exams, options = {}) {
        if (!key || !Array.isArray(exams)) {
            return null;
        }
        const fallback = options.fallbackMap || getPathMap();
        const overrideMap = options.overrideMap;
        const derived = overrideMap
            ? normalizePathMap(overrideMap, fallback)
            : derivePathMapFromIndex(exams, fallback);

        if (global.storage && typeof global.storage.set === 'function') {
            try {
                await global.storage.set(getPathMapStorageKey(key), derived);
            } catch (error) {
                console.warn('[ResourceCore] 写入路径映射失败:', error);
            }
        }

        if (options.setActive) {
            setActivePathMap(derived);
        }
        return derived;
    }

    async function refreshPathMap() {
        if (!global.storage || typeof global.storage.get !== 'function') {
            return setActivePathMap(getPathMap());
        }
        try {
            const key = await global.storage.get('active_exam_index_key', 'exam_index');
            const next = await loadPathMapForConfiguration(key || 'exam_index');
            return setActivePathMap(next);
        } catch (error) {
            console.warn('[ResourceCore] 刷新路径映射失败:', error);
            return setActivePathMap(getPathMap());
        }
    }

    function ensureTrailingSlash(value) {
        if (!value) {
            return '';
        }
        return value.endsWith('/') ? value : value + '/';
    }

    function joinAbsoluteResource(base, file) {
        const basePart = base ? String(base).replace(/\\/g, '/') : '';
        const filePart = file ? String(file).replace(/\\/g, '/').replace(/^\/+/, '') : '';
        if (!basePart) {
            return encodeURI(filePart);
        }
        if (!filePart) {
            return encodeURI(basePart);
        }
        const baseWithSlash = basePart.endsWith('/') ? basePart : basePart + '/';
        return encodeURI(baseWithSlash + filePart);
    }

    function encodePathSegments(path) {
        if (!path) {
            return '';
        }
        const segments = String(path).split('/');
        return segments.map((segment) => {
            if (!segment) {
                return segment;
            }
            try {
                return encodeURIComponent(decodeURIComponent(segment));
            } catch (_) {
                return encodeURIComponent(segment);
            }
        }).join('/');
    }

    function sanitizeFilename(name, kind) {
        if (!name) {
            return '';
        }
        const value = String(name);
        if (/\.html?$/i.test(value) || /\.pdf$/i.test(value)) {
            return value;
        }
        if (kind === 'html' && /\.pdf$/i.test(value)) {
            return value.replace(/\.pdf$/i, '.pdf.html');
        }
        if (/html$/i.test(value)) {
            return value.replace(/html$/i, '.html');
        }
        if (/pdf$/i.test(value)) {
            return value.replace(/pdf$/i, '.pdf');
        }
        return kind === 'pdf' ? value + '.pdf' : value + '.html';
    }

    function stripQueryAndHash(url) {
        if (!url) {
            return '';
        }
        const withoutHash = String(url).split('#', 1)[0];
        return withoutHash.split('?', 1)[0];
    }

    function normalizeThemeBasePrefix(prefix) {
        if (prefix == null) {
            return './';
        }
        const normalized = String(prefix).trim().replace(/\\/g, '/');
        if (!normalized || normalized === '.' || normalized === './') {
            return './';
        }
        return normalized.replace(/\/+$/g, '');
    }

    function detectScriptBasePrefix() {
        if (typeof document === 'undefined') {
            return null;
        }
        try {
            const scripts = document.getElementsByTagName('script');
            const candidates = [
                'js/core/resourceCore.js',
                'js/main.js',
                'js/app.js',
                'js/boot-fallbacks.js',
                'js/plugins/hp/hp-path.js'
            ];

            for (let i = scripts.length - 1; i >= 0; i -= 1) {
                const script = scripts[i];
                if (!script) {
                    continue;
                }
                const rawSrc = stripQueryAndHash(script.getAttribute('src'));
                if (!rawSrc) {
                    continue;
                }
                const normalized = rawSrc.replace(/\\/g, '/').trim();
                if (!normalized || isAbsolutePath(normalized)) {
                    continue;
                }
                for (let j = 0; j < candidates.length; j += 1) {
                    const candidate = candidates[j];
                    const index = normalized.lastIndexOf(candidate);
                    if (index === -1) {
                        continue;
                    }
                    const prefix = normalized.slice(0, index);
                    return prefix || './';
                }
            }
        } catch (error) {
            console.warn('[ResourceCore] detectScriptBasePrefix failed:', error);
        }
        return null;
    }

    function loadStoredBasePrefix() {
        try {
            return localStorage.getItem(BASE_PREFIX_STORAGE_KEY) || '';
        } catch (_) {
            return '';
        }
    }

    function storeBasePrefix(value) {
        try {
            if (value) {
                localStorage.setItem(BASE_PREFIX_STORAGE_KEY, value);
            } else {
                localStorage.removeItem(BASE_PREFIX_STORAGE_KEY);
            }
        } catch (_) { }
    }

    function getBasePrefix() {
        const direct = normalizeThemeBasePrefix(global.HP_BASE_PREFIX);
        if (direct && direct !== './') {
            return direct;
        }

        const stored = normalizeThemeBasePrefix(loadStoredBasePrefix());
        if (stored && stored !== './') {
            global.HP_BASE_PREFIX = stored;
            return stored;
        }

        const detected = normalizeThemeBasePrefix(detectScriptBasePrefix());
        if (detected && detected !== './') {
            global.HP_BASE_PREFIX = detected;
            return detected;
        }

        return direct || stored || detected || './';
    }

    function setBasePrefix(value) {
        const normalized = normalizeThemeBasePrefix(value);
        global.HP_BASE_PREFIX = normalized;
        storeBasePrefix(normalized === './' ? '' : normalized);
        return normalized;
    }

    function resolveExamBasePath(exam) {
        const relativePath = exam && exam.path ? String(exam.path) : '';
        const normalizedRelative = relativePath.replace(/\\/g, '/').trim();
        if (normalizedRelative && isAbsolutePath(normalizedRelative)) {
            return ensureTrailingSlash(normalizedRelative);
        }

        let combined = normalizedRelative;
        try {
            const pathMap = getPathMap() || {};
            const type = exam && exam.type;
            const mapped = type && pathMap[type] ? pathMap[type] : {};
            const fallback = type && DEFAULT_PATH_MAP[type] ? DEFAULT_PATH_MAP[type] : {};
            const root = mergeRootWithFallback(mapped.root, fallback.root);
            const normalizedRoot = root.replace(/\\/g, '/');
            if (normalizedRoot) {
                if (normalizedRelative && normalizedRelative.startsWith(normalizedRoot)) {
                    combined = normalizedRelative;
                } else {
                    combined = normalizedRoot + normalizedRelative;
                }
            }
        } catch (_) { }

        combined = combined.replace(/\\/g, '/');
        combined = combined.replace(/\/{2,}/g, '/');
        return ensureTrailingSlash(combined);
    }

    function joinResourcePath(base, folder, fileName) {
        const segments = [];
        const basePart = base ? String(base).replace(/\\/g, '/').replace(/\/+$/g, '') : '';
        const folderPart = folder ? String(folder).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/g, '') : '';
        const filePart = fileName ? String(fileName).replace(/\\/g, '/').replace(/^\/+/, '') : '';
        if (basePart) {
            segments.push(basePart);
        }
        if (folderPart) {
            segments.push(folderPart);
        }
        if (filePart) {
            segments.push(filePart);
        }
        return segments.join('/');
    }

    function buildResourcePath(exam, kind = 'html') {
        if (!exam) {
            return '';
        }
        const resourceKind = kind === 'pdf' ? 'pdf' : 'html';
        const rawName = resourceKind === 'pdf' ? exam.pdfFilename : exam.filename;
        const file = sanitizeFilename(rawName, resourceKind);
        const basePath = resolveExamBasePath(exam);
        const prefix = getBasePrefix();

        const normalizedFile = file ? String(file).replace(/\\/g, '/') : '';
        if (isAbsolutePath(normalizedFile)) {
            return joinAbsoluteResource(normalizedFile, '');
        }

        // Support centralized PDF storage paths such as "ReadingPractice/PDF/*.pdf".
        // These paths are repository-root relative and must not inherit cached HP_BASE_PREFIX.
        if (resourceKind === 'pdf' && /^readingpractice\/pdf\//i.test(normalizedFile)) {
            const rootedPdfPath = normalizedFile.replace(/^\/+/, '');
            const encodedPdfPath = encodePathSegments(rootedPdfPath);
            return encodedPdfPath ? './' + encodedPdfPath : './';
        }

        const normalizedBasePath = basePath ? String(basePath).replace(/\\/g, '/') : '';
        if (isAbsolutePath(normalizedBasePath)) {
            return joinAbsoluteResource(normalizedBasePath, normalizedFile);
        }

        const baseSegment = normalizedBasePath.replace(/^\.+\//, '').replace(/^\/+/, '');
        const normalizedBase = baseSegment && !baseSegment.endsWith('/') ? baseSegment + '/' : baseSegment;
        const relativePath = (normalizedBase || '') + normalizedFile;
        const encodedRelative = encodePathSegments(relativePath);

        if (prefix === './') {
            return encodedRelative ? './' + encodedRelative : './';
        }

        const trimmedPrefix = prefix ? prefix.replace(/\/+$/g, '') : '';
        return trimmedPrefix ? trimmedPrefix + '/' + encodedRelative : encodedRelative;
    }

    function getResourceAttempts(exam, kind = 'html') {
        if (!exam) {
            return [];
        }
        const attempts = [];
        const seen = new Set();
        const addAttempt = (label, path) => {
            if (!path || seen.has(path)) {
                return;
            }
            seen.add(path);
            attempts.push({ label, path });
        };

        addAttempt('map', buildResourcePath(exam, kind));

        const resourceKind = kind === 'pdf' ? 'pdf' : 'html';
        const file = sanitizeFilename(resourceKind === 'pdf' ? (exam.pdfFilename || exam.filename) : exam.filename, resourceKind);
        if (!file) {
            return attempts;
        }

        const folder = exam.path || '';
        addAttempt('fallback', encodePathSegments(joinResourcePath(getBasePrefix(), folder, file)));
        addAttempt('raw', encodePathSegments(joinResourcePath('', folder, file)));
        addAttempt('relative-up', encodePathSegments(joinResourcePath('..', folder, file)));
        addAttempt('relative-design', encodePathSegments(joinResourcePath('../..', folder, file)));

        return attempts;
    }

    function shouldBypassProbe(url) {
        if (!url) return false;
        try {
            const resolved = new URL(url, global.location && global.location.href ? global.location.href : undefined);
            const protocol = (resolved.protocol || '').toLowerCase();
            if (protocol === 'file:' || protocol === 'app:' || protocol === 'chrome-extension:' || protocol === 'capacitor:' || protocol === 'ionic:') {
                return true;
            }
            if (global.location && global.location.protocol === 'file:' && !isAbsolutePath(url)) {
                return true;
            }
        } catch (_) {
            if (global.location && global.location.protocol === 'file:' && !isAbsolutePath(url)) {
                return true;
            }
        }
        return false;
    }

    const resourceProbeCache = new Map();

    function probeResource(url) {
        if (!url) {
            return Promise.resolve(false);
        }
        if (resourceProbeCache.has(url)) {
            return resourceProbeCache.get(url);
        }
        const attempt = (async () => {
            if (shouldBypassProbe(url)) {
                return true;
            }
            try {
                const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
                if (response && (response.ok || response.status === 304 || response.status === 405 || response.type === 'opaque')) {
                    return true;
                }
                if (response && response.status >= 400) {
                    return false;
                }
            } catch (_) {
                if (shouldBypassProbe(url)) {
                    return true;
                }
            }
            return false;
        })();
        resourceProbeCache.set(url, attempt);
        return attempt;
    }

    async function resolveResource(exam, kind = 'html') {
        const attempts = getResourceAttempts(exam, kind);
        for (let i = 0; i < attempts.length; i += 1) {
            const entry = attempts[i];
            try {
                const ok = await probeResource(entry.path);
                if (ok) {
                    return { url: entry.path, attempts };
                }
            } catch (error) {
                console.warn('[ResourceCore] 资源探测失败:', entry, error);
            }
        }
        return { url: '', attempts };
    }

    global.ResourceCore = {
        __stable: true,
        version: '1.0.0',
        RAW_DEFAULT_PATH_MAP,
        DEFAULT_PATH_MAP,
        PATH_MAP_STORAGE_PREFIX,
        PATH_FALLBACK_ORDER,
        clonePathMap,
        normalizePathRoot,
        mergeRootWithFallback,
        buildOverridePathMap,
        derivePathMapFromIndex,
        getPathMapStorageKey,
        getPathMap,
        setActivePathMap,
        loadPathMapForConfiguration,
        savePathMapForConfiguration,
        refreshPathMap,
        getBasePrefix,
        setBasePrefix,
        resolveExamBasePath,
        buildResourcePath,
        getResourceAttempts,
        resolveResource,
        sanitizeFilename,
        encodePathSegments,
        detectScriptBasePrefix,
        normalizeThemeBasePrefix
    };
})(typeof window !== 'undefined' ? window : globalThis);
