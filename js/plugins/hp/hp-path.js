(function () {
  'use strict';

  function getCore() {
    return window.ResourceCore || null;
  }

  function callCore(method, fallback, args) {
    const core = getCore();
    if (core && typeof core[method] === 'function') {
      return core[method].apply(core, args || []);
    }
    return fallback;
  }

  window.hpPath = window.hpPath || {};

  window.hpPath.getBasePrefix = function () {
    return callCore('getBasePrefix', '.', []);
  };

  window.hpPath.setBasePrefix = function (value) {
    return callCore('setBasePrefix', '.', [value]);
  };

  window.hpPath.getPathMap = function () {
    return callCore('getPathMap', null, []);
  };

  window.hpPath.refreshPathMap = function () {
    return callCore('refreshPathMap', Promise.resolve(null), []);
  };

  window.hpPath.buildResourcePath = function (exam, kind) {
    return callCore('buildResourcePath', '', [exam, kind]);
  };

  window.buildResourcePath = function (exam, kind) {
    return window.hpPath.buildResourcePath(exam, kind);
  };
})();
