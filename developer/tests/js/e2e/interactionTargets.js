(function (global) {
  var targets = Object.freeze({
    "mainNavigationViews": ["overview", "browse", "practice", "settings"],
    "settingsButtonIds": [
      "clear-cache-btn",
      "load-library-btn",
      "library-config-btn",
      "force-refresh-btn",
      "create-backup-btn",
      "backup-list-btn",
      "export-data-btn",
      "import-data-btn"
    ]
  });

  if (typeof global !== 'undefined') {
    global.__E2E_INTERACTION_TARGETS__ = targets;
  }
})(typeof window !== 'undefined' ? window : this);
