/**
 * HP Path Prefix Helper
 *
 * Purpose
 * - Ensure dynamic resource URLs produced by window.buildResourcePath()
 *   work correctly when pages are served from deep subdirectories
 *   (e.g., .superdesign/design_iterations/HP/).
 * - Does NOT change script paths in HTML; those must be fixed in HTML.
 *
 * Behavior
 * - Detect the base prefix (e.g., '../../../') from already-loaded
 *   system script tags (app.js/main.js/boot-fallbacks.js) or from the
 *   known HP design-iterations path. Store as window.HP_BASE_PREFIX.
 * - Wrap window.buildResourcePath so that when it returns paths that
 *   start with './', we replace './' with HP_BASE_PREFIX.
 */
(function(){
  try {
    // Skip if already installed
    if (window.__hpPathPrefixInstalled) return;

    // Derive prefix from script tags (preferred) or from known path
    function detectPrefix() {
      try {
        var scripts = document.getElementsByTagName('script');
        for (var i = 0; i < scripts.length; i++) {
          var src = scripts[i] && scripts[i].getAttribute && scripts[i].getAttribute('src');
          if (!src || /^https?:\/\//i.test(src)) continue;
          // Normalize
          var norm = src.replace(/\\/g, '/');
          // Look for a system file and extract the leading segment
          var anchors = ['js/app.js', 'js/main.js', 'js/boot-fallbacks.js'];
          for (var k = 0; k < anchors.length; k++) {
            var anchor = anchors[k];
            var idx = norm.indexOf(anchor);
            if (idx > 0) {
              return norm.substring(0, idx); // includes trailing '/'
            }
          }
        }
      } catch (_) {}

      // Fallback: if page path contains design iterations directory depth
      try {
        var p = window.location.pathname.replace(/\\/g, '/');
        if (p.indexOf('/.superdesign/design_iterations/HP/') !== -1) {
          return '../../../';
        }
      } catch (_) {}

      // Default to './' (no-op) if not detectable
      return './';
    }

    var prefix = detectPrefix();
    // Ensure prefix ends with '/'
    if (prefix && !/\/$/.test(prefix)) prefix += '/';
    window.HP_BASE_PREFIX = prefix;

    // Wrap buildResourcePath if present; otherwise, patch later
    function installWrapper() {
      try {
        var original = window.buildResourcePath;
        if (typeof original !== 'function') return false;
        if (original.__hpWrapped) return true;

        function wrapped(exam, kind) {
          var out = original.apply(this, arguments);
          try {
            // Only rewrite './...' to prefix + rest
            if (typeof out === 'string' && out.indexOf('./') === 0) {
              return (window.HP_BASE_PREFIX || './') + out.slice(2);
            }
          } catch (_) {}
          return out;
        }
        wrapped.__hpWrapped = true;
        window.buildResourcePath = wrapped;
        return true;
      } catch (_) { return false; }
    }

    // Try immediately, or after DOMContentLoaded as a fallback
    if (!installWrapper()) {
      document.addEventListener('DOMContentLoaded', installWrapper);
    }

    window.__hpPathPrefixInstalled = true;
    try { console.log('[HP Path Prefix] Installed. Prefix =', window.HP_BASE_PREFIX); } catch(_){}
  } catch (err) {
    try { console.warn('[HP Path Prefix] Failed to install:', err); } catch(_){}
  }
})();

