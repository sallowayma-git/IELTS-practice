/**
 * HP Settings UI Enhancer
 *
 * Purpose
 * - Apply visual styles to match the template cards without rewriting HTML.
 */
(function(){
  'use strict';

  function enhanceCards(){
    // Management sections
    var groups = document.querySelectorAll('.flex.flex-1.gap-3.max-w-[480px].flex-col.items-stretch.px-4.py-3');
    groups.forEach(function(g){
      g.classList.add('overflow-hidden');
      g.classList.add('rounded-lg');
      g.classList.add('border');
      g.classList.add('border-[#543b3f]');
      g.classList.add('bg-[#271c1d]');
      g.classList.add('p-4');
    });

    // System info container
    var sys = document.getElementById('system-info-container');
    if (sys){
      sys.classList.add('overflow-hidden','rounded-lg','border','border-[#543b3f]','bg-[#271c1d]','p-4');
    }
  }

  function init(){
    try { enhanceCards(); } catch(e){ try{ console.warn('[HP Settings UI] enhance failed:', e); }catch(_){}}
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

