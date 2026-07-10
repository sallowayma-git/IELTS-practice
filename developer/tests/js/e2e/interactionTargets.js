(function (global) {
  var targets = Object.freeze({
    "mainNavigationViews": ["overview", "browse", "practice", "settings", "more"],
    "settingsButtonIds": [
      "clear-cache-btn",
      "theme-switcher-btn-entry",
      "practice-settings-entry-btn",
      "library-manager-btn",
      "show-onboarding-btn",
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
