/**
 * HP Path Map (scoped)
 * Provide a correct window.pathMap for HP pages so buildResourcePath()
 * resolves file locations accurately for Reading/Listening items.
 */
(function(){
  try {
    // Do not overwrite if already set explicitly elsewhere
    if (window.pathMap && window.pathMap.__hpProvided) return;
  } catch(_) {}

  try {
    var map = {
      reading: {
        // Real root folder for reading HTML/PDF content in this repository
        root: '睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/',
        exceptions: {}
      },
      listening: {
        // Keep consistent with system expectation; ensure content folder exists locally
        root: 'ListeningPractice/',
        exceptions: {}
      },
      version: 'hp-local-1'
    };
    try { map.__hpProvided = true; } catch(_) {}
    window.pathMap = map;
    try { console.log('[HP Path Map] Installed', map); } catch(_){}
  } catch (e) {
    try { console.warn('[HP Path Map] Failed to install:', e); } catch(_){}
  }
})();

