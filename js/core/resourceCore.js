(function (global) {
    'use strict';

    const PATH_PROTOCOL_RE = /^(?:[a-z]+:)?\/\//i;
    const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
    const WINDOWS_DRIVE_RE = /^[A-Za-z]:\\/;
    const PATH_MAP_STORAGE_PREFIX = 'exam_path_map__';
    const BASE_PREFIX_STORAGE_KEY = 'hp.basePrefix';
    const PATH_FALLBACK_ORDER = ['map', 'fallback', 'raw', 'relative-up', 'relative-design'];
    const BASE_PREFIX_CONTROL_RE = /[\u0000-\u001f\u007f<>"'`]/;
    const RESOURCE_PATH_CONTROL_RE = /[\u0000-\u001f\u007f<>"'`]/;
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

    function summarizeResourceCoreErrorForLog(error) {
        if (!error || typeof error !== 'object') {
            return { name: typeof error };
        }
        const status = Number(error.status);
        return {
            name: typeof error.name === 'string' && error.name ? error.name.slice(0, 80) : 'Error',
            status: Number.isFinite(status) ? status : undefined
        };
    }

    function isAbsolutePath(value) {
        return PATH_PROTOCOL_RE.test(value || '') || WINDOWS_DRIVE_RE.test(value || '');
    }

    function hasUnsafeRelativeResourcePath(value) {
        if (value == null) {
            return false;
        }
        const raw = String(value).trim().replace(/\\/g, '/');
        if (!raw) {
            return false;
        }
        if (
            PATH_PROTOCOL_RE.test(raw)
            || URL_SCHEME_RE.test(raw)
            || WINDOWS_DRIVE_RE.test(String(value).trim())
            || RESOURCE_PATH_CONTROL_RE.test(raw)
            || raw.includes('?')
            || raw.includes('#')
        ) {
            return true;
        }

        const candidates = [raw];
        try {
            const decoded = decodeURIComponent(raw).replace(/\\/g, '/');
            if (decoded !== raw) {
                candidates.push(decoded);
            }
        } catch (_) {
            return true;
        }

        return candidates.some((candidate) => candidate
            .split('/')
            .filter(Boolean)
            .some((segment) => segment === '.' || segment === '..'));
    }

    function normalizeResourceRelativePath(value) {
        if (!value) {
            return '';
        }
        const normalized = String(value).trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/');
        return hasUnsafeRelativeResourcePath(normalized) ? '' : normalized;
    }

    function normalizeLibraryConfigKey(value) {
        if (typeof value !== 'string') {
            return '';
        }
        const key = value.trim();
        if (!key || key.length > 128) {
            return '';
        }
        if (key === 'exam_index') {
            return key;
        }
        return /^exam_index_[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(key) ? key : '';
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
        const source = map && typeof map === 'object' ? map : {};
        const incoming = clonePathMap(map);
        if (source.reading && Object.prototype.hasOwnProperty.call(source.reading, 'root')) {
            base.reading.root = normalizePathRoot(source.reading.root);
        } else if (incoming.reading.root) {
            base.reading.root = normalizePathRoot(incoming.reading.root);
        }
        if (source.listening && Object.prototype.hasOwnProperty.call(source.listening, 'root')) {
            base.listening.root = normalizePathRoot(source.listening.root);
        } else if (incoming.listening.root) {
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
        const configKey = normalizeLibraryConfigKey(key);
        return configKey ? PATH_MAP_STORAGE_PREFIX + configKey : '';
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
        const configKey = normalizeLibraryConfigKey(key);
        if (!configKey || !global.storage || typeof global.storage.get !== 'function') {
            return clonePathMap(DEFAULT_PATH_MAP);
        }
        try {
            const stored = await global.storage.get(getPathMapStorageKey(configKey));
            if (stored && typeof stored === 'object') {
                return normalizePathMap(stored, DEFAULT_PATH_MAP);
            }
        } catch (error) {
            console.warn('[ResourceCore] 读取路径映射失败:', summarizeResourceCoreErrorForLog(error));
        }
        return clonePathMap(DEFAULT_PATH_MAP);
    }

    async function savePathMapForConfiguration(key, exams, options = {}) {
        const configKey = normalizeLibraryConfigKey(key);
        if (!configKey || !Array.isArray(exams)) {
            return null;
        }
        const fallback = options.fallbackMap || getPathMap();
        const overrideMap = options.overrideMap;
        const derived = overrideMap
            ? normalizePathMap(overrideMap, fallback)
            : derivePathMapFromIndex(exams, fallback);

        if (global.storage && typeof global.storage.set === 'function') {
            try {
                await global.storage.set(getPathMapStorageKey(configKey), derived);
            } catch (error) {
                console.warn('[ResourceCore] 写入路径映射失败:', summarizeResourceCoreErrorForLog(error));
            }
        }

        if (options.setActive) {
            setActivePathMap(derived);
        }
        return derived;
    }

    async function deletePathMapForConfiguration(key) {
        const configKey = normalizeLibraryConfigKey(key);
        if (!configKey || !global.storage || typeof global.storage.remove !== 'function') {
            return false;
        }
        try {
            await global.storage.remove(getPathMapStorageKey(configKey));
            return true;
        } catch (error) {
            console.warn('[ResourceCore] 删除路径映射失败:', summarizeResourceCoreErrorForLog(error));
            return false;
        }
    }

    async function refreshPathMap() {
        if (!global.storage || typeof global.storage.get !== 'function') {
            return setActivePathMap(getPathMap());
        }
        try {
            const key = await global.storage.get('active_exam_index_key', 'exam_index');
            const next = await loadPathMapForConfiguration(normalizeLibraryConfigKey(key) || 'exam_index');
            return setActivePathMap(next);
        } catch (error) {
            console.warn('[ResourceCore] 刷新路径映射失败:', summarizeResourceCoreErrorForLog(error));
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
        const value = normalizeResourceRelativePath(name);
        if (!value || value.startsWith('/')) {
            return '';
        }
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
        if (
            PATH_PROTOCOL_RE.test(normalized)
            || URL_SCHEME_RE.test(normalized)
            || WINDOWS_DRIVE_RE.test(String(prefix).trim())
            || BASE_PREFIX_CONTROL_RE.test(normalized)
            || normalized.includes('?')
            || normalized.includes('#')
        ) {
            return './';
        }
        return normalized.replace(/\/{2,}/g, '/').replace(/\/+$/g, '') || './';
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
            console.warn('[ResourceCore] detectScriptBasePrefix failed:', summarizeResourceCoreErrorForLog(error));
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
        const normalizedRelative = normalizeResourceRelativePath(relativePath);
        if (relativePath && !normalizedRelative) {
            return '';
        }
        if (normalizedRelative && isAbsolutePath(normalizedRelative)) {
            return ensureTrailingSlash(normalizedRelative);
        }

        let combined = normalizedRelative;
        try {
            const pathMap = getPathMap() || {};
            const type = exam && exam.type;
            const mapped = type && pathMap[type] ? pathMap[type] : {};
            const fallback = type && DEFAULT_PATH_MAP[type] ? DEFAULT_PATH_MAP[type] : {};
            const hasExplicitRoot = mapped && Object.prototype.hasOwnProperty.call(mapped, 'root');
            const root = hasExplicitRoot
                ? normalizePathRoot(mapped.root)
                : mergeRootWithFallback(mapped.root, fallback.root);
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
        if (exam.path && hasUnsafeRelativeResourcePath(exam.path)) {
            return '';
        }
        const resourceKind = kind === 'pdf' ? 'pdf' : 'html';
        try {
            if (global.LibraryDiscovery && typeof global.LibraryDiscovery.resolveRuntimeResource === 'function') {
                const runtimeUrl = global.LibraryDiscovery.resolveRuntimeResource(exam, resourceKind);
                if (runtimeUrl) {
                    return runtimeUrl;
                }
            }
        } catch (_) { }

        const rawName = resourceKind === 'pdf' ? exam.pdfFilename : exam.filename;
        const file = sanitizeFilename(rawName, resourceKind);
        if (!file) {
            return '';
        }
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
        if (exam.path && hasUnsafeRelativeResourcePath(exam.path)) {
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

        try {
            if (global.LibraryDiscovery && typeof global.LibraryDiscovery.resolveRuntimeResource === 'function') {
                addAttempt('runtime', global.LibraryDiscovery.resolveRuntimeResource(exam, kind === 'pdf' ? 'pdf' : 'html'));
            }
        } catch (_) { }

        addAttempt('map', buildResourcePath(exam, kind));

        const resourceKind = kind === 'pdf' ? 'pdf' : 'html';
        const file = sanitizeFilename(resourceKind === 'pdf' ? (exam.pdfFilename || exam.filename) : exam.filename, resourceKind);
        if (!file) {
            return attempts;
        }

        const folder = normalizeResourceRelativePath(exam.path || '');
        if (exam.path && !folder) {
            return attempts;
        }
        addAttempt('fallback', encodePathSegments(joinResourcePath(getBasePrefix(), folder, file)));
        addAttempt('raw', encodePathSegments(joinResourcePath('', folder, file)));
        addAttempt('relative-up', encodePathSegments(joinResourcePath('..', folder, file)));
        addAttempt('relative-design', encodePathSegments(joinResourcePath('../..', folder, file)));

        return attempts;
    }

    function resolveProbeBypassUrl(rawUrl) {
        if (!rawUrl) return '';
        try {
            const baseHref = global.location && global.location.href ? global.location.href : undefined;
            const resolved = new URL(String(rawUrl), baseHref);
            const protocol = (resolved.protocol || '').toLowerCase();
            const currentProtocol = global.location && global.location.protocol
                ? String(global.location.protocol).toLowerCase()
                : '';
            if (protocol === 'file:' && currentProtocol === 'file:') {
                return resolved.href;
            }
            if (
                currentProtocol
                && protocol === currentProtocol
                && ['app:', 'chrome-extension:', 'capacitor:', 'ionic:'].includes(protocol)
            ) {
                return resolved.href;
            }
        } catch (_) {
            if (global.location && global.location.protocol === 'file:' && !isAbsolutePath(rawUrl)) {
                return String(rawUrl);
            }
        }
        return '';
    }

    function shouldBypassProbe(url) {
        return Boolean(resolveProbeBypassUrl(url));
    }

    function resolveTrustedProbeUrl(rawUrl) {
        if (!rawUrl) {
            return '';
        }
        try {
            const baseHref = global.location && global.location.href ? global.location.href : 'http://localhost/';
            const resolved = new URL(String(rawUrl), baseHref);
            const protocol = (resolved.protocol || '').toLowerCase();
            const currentOrigin = global.location && global.location.origin;

            if (protocol === 'http:' || protocol === 'https:') {
                return currentOrigin && currentOrigin !== 'null' && resolved.origin === currentOrigin ? resolved.href : '';
            }

            if (protocol === 'blob:') {
                return currentOrigin && currentOrigin !== 'null' && resolved.origin === currentOrigin ? resolved.href : '';
            }
        } catch (_) {
            return '';
        }
        return '';
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
            if (resolveProbeBypassUrl(url)) {
                return true;
            }
            const trustedUrl = resolveTrustedProbeUrl(url);
            if (!trustedUrl) {
                return false;
            }
            try {
                const response = await fetch(trustedUrl, { method: 'HEAD', cache: 'no-store' });
                if (response && (response.ok || response.status === 304 || response.status === 405 || response.type === 'opaque')) {
                    return true;
                }
                if (response && response.status >= 400) {
                    return false;
                }
            } catch (_) {
                if (resolveProbeBypassUrl(url)) {
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
                console.warn('[ResourceCore] 资源探测失败:', summarizeResourceCoreErrorForLog(error));
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
        deletePathMapForConfiguration,
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
