/**
 * HP Welcome Adapter (stable)
 * - Inject two category cards (Reading/Listening)
 * - Inject four stat cards (Total/Completed/Avg/Days)
 */
(function(){
  'use strict';

  function ensureCategoryCards(){
    var root = document.getElementById('practice-cards-container');
    if (!root || root.__hpRendered) return;
    root.innerHTML = [
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
    root.__hpRendered = true;
  }

  function injectStats(){
    var grid = document.getElementById('progress-stats-grid');
    if (!grid || grid.__hpInjected) return;
    function card(title, id, emoji){
      return (
        '<div class="flex flex-col overflow-hidden rounded-lg border border-[#4A4A4A] dark:border-[#543b3f] bg-card-light dark:bg-[#271c1d] p-6 text-center">'
        + '<div class="text-xl mb-2">'+emoji+'</div>'
        + '<h3 class="text-sm uppercase tracking-wider text-text-light dark:text-text-dark">'+title+'</h3>'
        + '<div class="text-primary text-3xl font-extrabold mt-2" id="'+id+'">0</div>'
        + '</div>'
      );
    }
    grid.innerHTML = [
      card('Total Exams', 'total-exams-count', '📚'),
      card('Completed', 'completed-count', '✅'),
      card('Average Score', 'average-score', '🎯'),
      card('Study Days', 'study-days', '📆')
    ].join('');
    grid.__hpInjected = true;
  }

  function init(){
    try { ensureCategoryCards(); injectStats(); }
    catch(e){ try{ console.warn('[HP Welcome Adapter] init failed:', e); }catch(_){} }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

