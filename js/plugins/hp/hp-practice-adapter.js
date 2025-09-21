/**
 * HP Practice Adapter
 *
 * Purpose
 * - Make the design-iteration practice page compatible with HP practice
 *   render/bridge plugins by ensuring a recognizable grid container.
 */
(function(){
  'use strict';

  function init(){
    try{
      var grid = document.getElementById('practice-exam-grid');
      if (grid){
        // Add the class expected by hp-practice-render
        grid.classList.add('exam-grid');
      }
    } catch(e){
      try { console.warn('[HP Practice Adapter] failed:', e); } catch(_){ }
    }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

