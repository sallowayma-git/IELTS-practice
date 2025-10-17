(function () {
  'use strict';

  const PATH_PROTOCOL_RE = /^(?:[a-z]+:)?\/\//i;
  const WINDOWS_DRIVE_RE = /^[A-Za-z]:\\/;
  const FALLBACK_PREFIX = '../../..';

  function detectDefaultPrefix() {
    if (typeof document === 'undefined') {
      return FALLBACK_PREFIX.replace(/\/+$/g, '');
    }
    try {
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i -= 1) {
        const script = scripts[i];
        if (!script) continue;
        const rawSrc = script.getAttribute('src') || '';
        if (!rawSrc) continue;
        if (rawSrc.indexOf('js/plugins/hp/hp-path.js') === -1) continue;
        const normalized = String(rawSrc).replace(/\\/g, '/').trim();
        if (!normalized) break;
        const relativeMatch = normalized.match(/^((?:\.\.?\/)+)/);
        if (relativeMatch && relativeMatch[1]) {
          const trimmed = relativeMatch[1].replace(/\/+$/g, '');
          return trimmed || '.';
        }
        if (normalized.startsWith('/')) {
          return '.';
        }
        const uptoFile = normalized.replace(/[^/]+$/, '');
        if (uptoFile) {
          const segments = uptoFile.split('/').filter(Boolean);
          const ups = segments.filter((segment) => segment === '..').length;
          if (ups > 0) {
            return new Array(ups).fill('..').join('/');
          }
        }
      }
    } catch (error) {
      try { console.warn('[hp-path] detectDefaultPrefix failed', error); } catch (_) {}
    }
    return FALLBACK_PREFIX.replace(/\/+$/g, '');
  }

  const DEFAULT_PREFIX = detectDefaultPrefix();
  const STORAGE_KEY = 'hp.basePrefix';
  const DEFAULT_MAP = {
    reading: {
      root: '睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/',
      exceptions: { 'special-cases': [] }
    },
    listening: {
      root: 'ListeningPractice/',
      exceptions: { 'special-cases': [] }
    }
  };

  const state = {
    base: '.',
    map: DEFAULT_MAP,
    mapPromise: null
  };

  function isAbsolute(value) {
    return PATH_PROTOCOL_RE.test(value) || WINDOWS_DRIVE_RE.test(value || '');
  }

  function normalizePart(value, trimLeading) {
    if (!value) return '';
    let result = String(value).replace(/\\/g, '/');
    if (trimLeading) {
      result = result.replace(/^\/+/, '');
    }
    return result.replace(/\/+$/g, '');
  }

  function ensureFileExtension(name, kind) {
    if (!name) return '';
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

  function joinPaths(base, root, folder, fileName) {
    if (isAbsolute(fileName)) {
      return normalizePart(fileName, false);
    }
    if (isAbsolute(folder)) {
      const folderPart = normalizePart(folder, false);
      const filePart = normalizePart(fileName, true);
      return filePart ? folderPart + '/' + filePart : folderPart;
    }
    const segments = [];
    const basePart = normalizePart(base, false);
    if (basePart) segments.push(basePart);
    const rootPart = normalizePart(root, true);
    if (rootPart) segments.push(rootPart);
    const folderPart = normalizePart(folder, true);
    if (folderPart) segments.push(folderPart);
    const filePart = normalizePart(fileName, true);
    if (filePart) segments.push(filePart);
    return segments.join('/');
  }

  function stripRootPrefix(folder, root) {
    const folderPart = normalizePart(folder, true);
    const rootPart = normalizePart(root, true);
    if (!folderPart) return '';
    if (!rootPart) return folderPart;
    if (folderPart === rootPart) return '';
    if (folderPart.indexOf(rootPart + '/') === 0) {
      return folderPart.slice(rootPart.length + 1);
    }

    const segments = rootPart.split('/').filter(Boolean);
    for (let i = 1; i < segments.length; i += 1) {
      const suffix = segments.slice(i).join('/');
      if (!suffix) continue;
      if (folderPart === suffix) {
        return '';
      }
      if (folderPart.indexOf(suffix + '/') === 0) {
        return folderPart.slice(suffix.length + 1);
      }
    }

    return folderPart;
  }

  function encodePath(path) {
    if (!path) return '';
    if (isAbsolute(path)) return path;
    return encodeURI(path).replace(/#/g, '%23');
  }

  function normalizeBase(value) {
    const str = typeof value === 'string' ? value : '';
    if (!str) return '';
    return str.replace(/\\/g, '/').replace(/\/+$/g, '');
  }

  function loadStoredBase() {
    try {
      return localStorage.getItem(STORAGE_KEY) || '';
    } catch (_) {
      return '';
    }
  }

  function storeBase(value) {
    try {
      if (value) {
        localStorage.setItem(STORAGE_KEY, value);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (_) {}
  }

  function applyBase(value) {
    const normalized = normalizeBase(value) || normalizeBase(DEFAULT_PREFIX) || '.';
    state.base = normalized || '.';
    window.HP_BASE_PREFIX = state.base;
    return state.base;
  }

  function ensureBase() {
    const preset = normalizeBase(window.HP_BASE_PREFIX);
    if (preset) return applyBase(preset);

    const stored = normalizeBase(loadStoredBase());
    if (stored) {
      storeBase(stored);
      return applyBase(stored);
    }

    storeBase(normalizeBase(DEFAULT_PREFIX));
    return applyBase(DEFAULT_PREFIX);
  }

  function detectExamType(exam) {
    if (!exam) return '';
    const explicit = (exam.type || '').toLowerCase();
    if (explicit) return explicit;
    const folder = String(exam.path || '').toLowerCase();
    if (folder.includes('listeningpractice')) return 'listening';
    if (folder) return 'reading';
    return '';
  }

  function getRootForExam(exam) {
    if (!exam || !state.map) return '';
    const type = detectExamType(exam);
    if (type && state.map[type] && state.map[type].root) {
      return state.map[type].root;
    }
    return '';
  }

  function resolveFileName(exam, kind) {
    if (!exam) return '';
    if (kind === 'pdf') {
      return exam.pdfFilename || exam.filename || '';
    }
    return exam.filename || '';
  }

  function buildFromExam(exam, kind) {
    if (!exam) return '';
    const resourceKind = kind === 'pdf' ? 'pdf' : 'html';
    const targetFile = ensureFileExtension(resolveFileName(exam, resourceKind), resourceKind);
    if (isAbsolute(targetFile)) {
      return encodePath(targetFile);
    }

    try {
      if (typeof window.resolveExamBasePath === 'function') {
        const resolvedBase = window.resolveExamBasePath(exam) || '';
        const relativeFromMain = joinPaths(state.base || '.', resolvedBase, '', targetFile);
        if (relativeFromMain) {
          return encodePath(relativeFromMain);
        }
      }
    } catch (error) {
      console.warn('[hp-path] resolveExamBasePath 调用失败', error);
    }

    const root = getRootForExam(exam);
    const folder = stripRootPrefix(exam.path || '', root);
    const relativePath = joinPaths(state.base || '.', root, folder, targetFile);
    return encodePath(relativePath);
  }

  function getRuntimePathMap() {
    if (typeof window === 'undefined') return null;
    const candidates = [
      window.__activeLibraryPathMap,
      window.pathMap,
      window.examIndexMetadata && window.examIndexMetadata.pathRoot
    ];
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      if (candidate && typeof candidate === 'object') {
        return candidate;
      }
    }
    return null;
  }

  function shouldSkipFetch() {
    if (typeof window === 'undefined') return false;
    if (window.__HP_DISABLE_PATH_MAP_FETCH__ === true) return true;
    try {
      const protocol = (window.location && window.location.protocol) || '';
      if (!protocol) return false;
      const lowered = protocol.toLowerCase();
      return lowered === 'file:' || lowered === 'app:' || lowered === 'capacitor:' || lowered === 'ionic:';
    } catch (_) {
      return false;
    }
  }

  function normalizePathMapShape(map) {
    if (!map || typeof map !== 'object') {
      return null;
    }
    const next = { reading: Object.create(null), listening: Object.create(null) };
    const categories = ['reading', 'listening'];
    categories.forEach((category) => {
      const source = map[category] && typeof map[category] === 'object' ? map[category] : {};
      next[category] = {
        root: typeof source.root === 'string' ? source.root : '',
        exceptions: source.exceptions && typeof source.exceptions === 'object' ? source.exceptions : {}
      };
    });
    return next;
  }

  function loadPathMap(force) {
    if (!force && state.mapPromise) {
      return state.mapPromise;
    }

    const runtimeMap = normalizePathMapShape(getRuntimePathMap());
    if (runtimeMap) {
      state.map = runtimeMap;
      state.mapPromise = Promise.resolve(state.map);
      return state.mapPromise;
    }

    if (shouldSkipFetch()) {
      state.map = DEFAULT_MAP;
      state.mapPromise = Promise.resolve(state.map);
      return state.mapPromise;
    }

    const mapUrl = joinPaths(state.base || '.', '', 'assets/data', 'path-map.json');
    state.mapPromise = (async () => {
      try {
        const response = await fetch(mapUrl, { cache: 'no-store' });
        if (!response || !response.ok) {
          state.map = DEFAULT_MAP;
          return state.map;
        }
        const data = await response.json();
        const normalized = normalizePathMapShape(data);
        state.map = normalized || DEFAULT_MAP;
        return state.map;
      } catch (error) {
        console.warn('[hp-path] failed to load path map', error);
      }
      state.map = DEFAULT_MAP;
      return state.map;
    })();

    return state.mapPromise;
  }

  function setBasePrefix(value) {
    const normalized = normalizeBase(value);
    if (!normalized) {
      storeBase('');
      applyBase(DEFAULT_PREFIX);
    } else {
      storeBase(normalized);
      applyBase(normalized);
    }
    state.mapPromise = null;
    state.map = null;
    loadPathMap(true).catch(() => {});
    return state.base;
  }

  ensureBase();
  loadPathMap().catch(() => {});

  window.hpPath = window.hpPath || {};
  window.hpPath.getBasePrefix = function () {
    return state.base;
  };
  window.hpPath.setBasePrefix = function (value) {
    return setBasePrefix(value);
  };
  window.hpPath.getPathMap = function () {
    return state.map;
  };
  window.hpPath.refreshPathMap = function () {
    return loadPathMap(true);
  };

  window.hpPath.buildResourcePath = function (exam, kind) {
    return buildFromExam(exam, kind);
  };

  window.buildResourcePath = function (exam, kind) {
    return window.hpPath.buildResourcePath(exam, kind);
  };
})();
