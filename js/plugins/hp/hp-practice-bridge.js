/**
 * HP Practice Bridge (minimal stable)
 * - Keeps compatibility but defers logic to Practice Render and system
 */
(function(){
  'use strict';
  if (typeof hpCore === 'undefined') return;

  const Bridge = {
    init(){ /* reserved for future hooks */ }
  };

  hpCore.ready(()=> Bridge.init());
  try { console.log('[HP Practice Bridge] ready'); } catch(_){}
})();

