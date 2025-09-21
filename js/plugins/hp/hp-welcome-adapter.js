/**
 * HP Welcome Adapter
 *
 * Purpose
 * - Bridge the design-iteration Welcome.html to existing HP plugins.
 * - Ensure required containers exist and inject stat cards markup that
 *   hp-welcome-ui.js can update.
 */
(function(){
  'use strict';

  function ensureCategoryOverviewContainer(){
    var cardsRoot = document.getElementById('practice-cards-container');
    if (!cardsRoot) return;
    // Render two cards (Reading / Listening) to match template
    if (!cardsRoot.__hpRendered){
      cardsRoot.innerHTML = [
        '<div class="bg-card-light dark:bg-card-dark rounded-lg shadow-lg p-8 flex flex-col items-center justify-center text-center border border-border-light dark:border-border-dark transform hover:scale-105 transition-transform duration-300">',
        '  <span class="material-icons text-7xl text-primary mb-4">menu_book</span>',
        '  <h2 class="font-display text-3xl font-bold mb-2">Reading</h2>',
        '  <p class="mb-6">Delve into texts and enhance comprehension.</p>',
        '  <a href="#" class="font-display inline-block bg-primary text-white py-3 px-8 rounded-full uppercase tracking-wider font-semibold hover:bg-opacity-90 transition-colors" data-cta="start-reading">Start Reading Practice</a>',
        '</div>',
        '<div class="bg-card-light dark:bg-card-dark rounded-lg shadow-lg p-8 flex flex-col items-center justify-center text-center border border-border-light dark:border-border-dark transform hover:scale-105 transition-transform duration-300">',
        '  <span class="material-icons text-7xl text-primary mb-4">headset</span>',
        '  <h2 class="font-display text-3xl font-bold mb-2">Listening</h2>',
        '  <p class="mb-6">Hone your listening skills and speed.</p>',
        '  <a href="#" class="font-display inline-block bg-primary text-white py-3 px-8 rounded-full uppercase tracking-wider font-semibold hover:bg-opacity-90 transition-colors" data-cta="start-listening">Start Listening Practice</a>',
        '</div>'
      ].join('');
      cardsRoot.__hpRendered = true;
    }
  }

  function injectStatsCards(){
    var grid = document.getElementById('progress-stats-grid');
    if (!grid) return;
    if (grid.__hpInjected) return;

    grid.innerHTML = '' +
      card('Total Exams', 'total-exams-count', '📚') +
      card('Completed', 'completed-count', '✅') +
      card('Average Score', 'average-score', '🎯') +
      card('Study Days', 'study-days', '📆');
    grid.__hpInjected = true;

    function card(title, valueId, emoji){
      return (
        '<div class="flex flex-col overflow-hidden rounded-lg border border-[#4A4A4A] dark:border-[#543b3f] bg-card-light dark:bg-[#271c1d] p-6 text-center">' +
          '<div class="text-xl mb-2">'+emoji+'</div>' +
          '<h3 class="text-sm uppercase tracking-wider text-text-light dark:text-text-dark">'+title+'</h3>' +
          '<div class="text-primary text-3xl font-extrabold mt-2" id="'+valueId+'">0</div>' +
        '</div>'
      );
  }
  }

  function init(){
    try {
      ensureCategoryOverviewContainer();
      injectStatsCards();
    } catch (e){
      try { console.warn('[HP Welcome Adapter] init failed:', e); } catch(_){ }
    }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
