(function () {
  'use strict';

  if (typeof window.hpCore === 'undefined') {
    console.error('[hp-portal] hpCore missing');
    return;
  }

  const STORAGE_KEY = 'hp.portal.state';
  const VIEW_KEYS = ['overview', 'practice', 'history', 'settings'];
  const PRACTICE_VIRTUAL_THRESHOLD = 28;

  function readState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {
      /* ignore quota errors */
    }
  }

  const Portal = {
    dom: {},
    state: {
      activeView: 'overview',
      practiceFilter: { type: 'all', query: '' }
    },
    practiceVirtualizer: null,
    historySeries: null,

    init() {
      this.dom.root = document.getElementById('hp-portal-root');
      if (!this.dom.root) {
        console.warn('[hp-portal] portal root missing');
        return;
      }

      this.dom.navButtons = Array.from(document.querySelectorAll('[data-hp-view]'));
      this.dom.practiceList = this.dom.root.querySelector('#hp-practice-list');
      this.dom.practiceSearch = this.dom.root.querySelector('#hp-practice-search');
      this.dom.practiceTypeButtons = Array.from(this.dom.root.querySelectorAll('[data-practice-type]'));
      this.dom.practiceEmpty = document.getElementById('hp-practice-empty');
      this.dom.historyTable = this.dom.root.querySelector('#hp-history-table');
      this.dom.historyEmpty = this.dom.root.querySelector('#hp-history-empty');
      this.dom.historyChart = this.dom.root.querySelector('#hp-history-chart');
      this.dom.historyChartEmpty = this.dom.root.querySelector('#hp-history-chart-empty');
      this.dom.historyLevel = document.getElementById('hp-history-level');
      this.dom.historyProgressBar = document.getElementById('hp-history-progress');
      this.dom.historyProgressText = document.getElementById('hp-history-progress-text');
      this.dom.stats = {
        exams: document.getElementById('hp-stat-total-exams'),
        completed: document.getElementById('hp-stat-completed'),
        average: document.getElementById('hp-stat-average'),
        streak: document.getElementById('hp-stat-days'),
        updated: document.getElementById('hp-stat-updated')
      };
      this.dom.quickCards = document.getElementById('hp-quick-cards');
      this.dom.settingsButtons = Array.from(this.dom.root.querySelectorAll('[data-settings-action]'));
      this.dom.themeToggle = document.getElementById('hp-theme-toggle');

      this.restoreState();
      this.bindNav();
      this.bindPracticeFilters();
      this.bindSettings();
      this.bindThemeToggle();
      this.bindHash();

      this.activate(this.state.activeView || 'overview', false);
      this.renderAll();

      hpCore.on('dataUpdated', () => this.renderAll());
      window.showView = (viewName) => this.activate(viewName || 'overview');
      window.hpPortal = this;
    },

    restoreState() {
      const saved = readState();
      if (saved && typeof saved === 'object') {
        if (saved.activeView && VIEW_KEYS.includes(saved.activeView)) {
          this.state.activeView = saved.activeView;
        }
        if (saved.practiceFilter && typeof saved.practiceFilter === 'object') {
          this.state.practiceFilter = Object.assign({}, this.state.practiceFilter, saved.practiceFilter);
        }
      }

      const hashView = (window.location.hash || '').replace('#', '');
      if (hashView && VIEW_KEYS.includes(hashView)) {
        this.state.activeView = hashView;
      }
    },

    persistState() {
      writeState({
        activeView: this.state.activeView,
        practiceFilter: this.state.practiceFilter
      });
    },

    bindNav() {
      this.dom.navButtons.forEach((btn) => {
        btn.addEventListener('click', (event) => {
          event.preventDefault();
          const view = btn.getAttribute('data-hp-view');
          this.activate(view || 'overview');
        });
      });
    },

    bindPracticeFilters() {
      if (this.dom.practiceSearch) {
        let timer = null;
        this.dom.practiceSearch.value = this.state.practiceFilter.query || '';
        this.dom.practiceSearch.addEventListener('input', (event) => {
          clearTimeout(timer);
          const value = (event.target.value || '').trim();
          timer = window.setTimeout(() => {
            this.state.practiceFilter.query = value;
            this.persistState();
            this.renderPractice();
          }, 150);
        });
      }

      this.dom.practiceTypeButtons.forEach((btn) => {
        const type = btn.getAttribute('data-practice-type');
        this.togglePracticeTab(btn, type === this.state.practiceFilter.type);
        btn.addEventListener('click', (event) => {
          event.preventDefault();
          this.state.practiceFilter.type = type;
          this.dom.practiceTypeButtons.forEach((item) => this.togglePracticeTab(item, item === btn));
          this.persistState();
          this.renderPractice();
        });
      });
    },

    togglePracticeTab(button, active) {
      if (!button) return;
      button.classList.toggle('text-white', !!active);
      button.classList.toggle('border-b-2', !!active);
      button.classList.toggle('border-white', !!active);
      button.classList.toggle('text-white/60', !active);
    },

    bindSettings() {
      this.dom.settingsButtons.forEach((btn) => {
        btn.addEventListener('click', (event) => {
          event.preventDefault();
          const action = btn.getAttribute('data-settings-action');
          this.invokeSetting(action);
        });
      });
    },

    bindThemeToggle() {
      if (!this.dom.themeToggle) return;
      const apply = (mode) => {
        if (mode === 'dark') {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      };

      const saved = localStorage.getItem('hp.theme');
      if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        apply('dark');
      }

      this.dom.themeToggle.addEventListener('click', () => {
        const isDark = document.documentElement.classList.toggle('dark');
        localStorage.setItem('hp.theme', isDark ? 'dark' : 'light');
      });
    },

    bindHash() {
      window.addEventListener('hashchange', () => {
        const hashView = (window.location.hash || '').replace('#', '');
        if (hashView && VIEW_KEYS.includes(hashView)) {
          this.activate(hashView);
        }
      });
    },

    activate(view, updateHash = true) {
      const next = VIEW_KEYS.includes(view) ? view : 'overview';
      this.state.activeView = next;
      this.persistState();

      if (updateHash) {
        try { window.history.replaceState(null, '', '#' + next); }
        catch (_) { window.location.hash = next; }
      }

      Array.from(this.dom.root.querySelectorAll('[data-view-section]')).forEach((section) => {
        const key = section.getAttribute('data-view-section');
        if (key === next) {
          section.classList.remove('hidden');
          section.classList.add('block');
        } else {
          section.classList.add('hidden');
          section.classList.remove('block');
        }
      });

      this.dom.navButtons.forEach((btn) => {
        const key = btn.getAttribute('data-hp-view');
        btn.classList.toggle('hp-nav-active', key === next);
      });

      this.renderForView(next);

      if (next === 'practice' && this.practiceVirtualizer && typeof this.practiceVirtualizer.recalculate === 'function') {
        window.requestAnimationFrame(() => {
          try { this.practiceVirtualizer.recalculate(); }
          catch (error) { console.warn('[hp-portal] practice recalc failed', error); }
        });
      }

      if (next === 'history') {
        window.requestAnimationFrame(() => {
          try { this.renderHistory(); }
          catch (error) { console.warn('[hp-portal] history rerender failed', error); }
        });
      }
    },

    renderAll() {
      this.renderOverview();
      this.renderPractice();
      this.renderHistory();
    },

    renderForView(view) {
      if (view === 'overview') this.renderOverview();
      if (view === 'practice') this.renderPractice();
      if (view === 'history') this.renderHistory();
      if (view === 'settings') this.updateSettingsMeta();
    },

    clearContainer(node) {
      if (!node) return;
      while (node.firstChild) {
        node.removeChild(node.firstChild);
      }
    },

    renderOverview() {
      const exams = hpCore.getExamIndex() || [];
      const records = hpCore.getRecords() || [];
      const stats = this.calculateStats(exams, records);

      if (this.dom.stats.exams) this.dom.stats.exams.textContent = stats.totalExams;
      if (this.dom.stats.completed) this.dom.stats.completed.textContent = stats.completed;
      if (this.dom.stats.average) this.dom.stats.average.textContent = stats.average + '%';
      if (this.dom.stats.streak) this.dom.stats.streak.textContent = stats.days;
      if (this.dom.stats.updated) this.dom.stats.updated.textContent = stats.updated;

      if (!this.dom.quickCards) return;

      const featured = exams.slice(0, 4);
      this.clearContainer(this.dom.quickCards);

      if (!featured.length) {
        const placeholder = document.createElement('div');
        placeholder.className = 'hp-empty-state';
        placeholder.textContent = '暂无可推荐的题目，先去题库探索吧。';
        this.dom.quickCards.appendChild(placeholder);
      } else {
        const fragment = document.createDocumentFragment();
        featured.forEach((exam) => fragment.appendChild(this.createQuickCardElement(exam)));
        this.dom.quickCards.appendChild(fragment);
      }

      this.ensureQuickCardBinding();
    },

    ensureQuickCardBinding() {
      if (!this.dom.quickCards || this.dom.quickCards.__bound) return;
      this.dom.quickCards.addEventListener('click', (event) => {
        const btn = event.target.closest('button[data-action]');
        if (!btn) return;
        const id = btn.getAttribute('data-id');
        const action = btn.getAttribute('data-action');
        if (action === 'start') hpCore.startExam(id);
        if (action === 'pdf') hpCore.viewExamPDF(id);
      });
      this.dom.quickCards.__bound = true;
    },

    createQuickCardElement(exam) {
      const article = document.createElement('article');
      article.className = 'flex flex-col gap-4 rounded-2xl border border-white/15 bg-gradient-to-br from-[#39282b]/75 via-[#24181a]/90 to-[#181112]/95 p-6 shadow-xl backdrop-blur';

      const header = document.createElement('div');
      header.className = 'flex items-start justify-between gap-3';
      const title = document.createElement('h3');
      const typeEmoji = (exam.type || '').toLowerCase() === 'listening' ? '🎧' : '📖';
      title.className = 'text-lg font-semibold text-white';
      title.textContent = typeEmoji + ' ' + (exam.title || '未命名试卷');
      header.appendChild(title);
      article.appendChild(header);

      const meta = document.createElement('p');
      meta.className = 'text-sm text-white/70';
      meta.textContent = exam.category || exam.part || '未分类';
      article.appendChild(meta);

      const footer = document.createElement('div');
      footer.className = 'flex flex-wrap gap-3';
      const startBtn = document.createElement('button');
      startBtn.className = 'rounded-full bg-[#ec1337]/90 px-4 py-2 font-semibold text-white shadow-lg shadow-[#ec1337]/30';
      startBtn.textContent = '开始练习';
      startBtn.setAttribute('data-action', 'start');
      startBtn.setAttribute('data-id', exam && exam.id ? exam.id : '');
      footer.appendChild(startBtn);

      if (exam && exam.pdfFilename) {
        const pdfBtn = document.createElement('button');
        pdfBtn.className = 'rounded-full border border-white/30 px-4 py-2 font-semibold text-white/85';
        pdfBtn.textContent = '查看 PDF';
        pdfBtn.setAttribute('data-action', 'pdf');
        pdfBtn.setAttribute('data-id', exam.id || '');
        footer.appendChild(pdfBtn);
      }

      article.appendChild(footer);
      return article;
    },

    renderPractice() {
      if (!this.dom.practiceList) return;
      const exams = hpCore.getExamIndex() || [];
      const filter = this.state.practiceFilter || { type: 'all', query: '' };

      const filtered = exams.filter((exam) => {
        if (!exam) return false;
        const type = (exam.type || '').toLowerCase();
        if (filter.type && filter.type !== 'all' && type !== filter.type) return false;
        if (filter.query) {
          const q = filter.query.toLowerCase();
          const title = (exam.title || '').toLowerCase();
          const category = (exam.category || exam.part || '').toLowerCase();
          return title.includes(q) || category.includes(q);
        }
        return true;
      });

      if (!filtered.length) {
        this.destroyPracticeVirtualizer();
        this.dom.practiceList.dataset.mode = 'empty';
        this.clearContainer(this.dom.practiceList);
        if (this.dom.practiceEmpty) {
          this.dom.practiceEmpty.classList.remove('hidden');
        }
        return;
      }

      if (this.dom.practiceEmpty) {
        this.dom.practiceEmpty.classList.add('hidden');
      }

      if (this.shouldVirtualizePractice(filtered.length)) {
        this.ensurePracticeVirtualizer(filtered);
        return;
      }

      const limited = filtered.slice(0, 120);
      this.destroyPracticeVirtualizer();
      this.dom.practiceList.dataset.mode = 'static';
      this.clearContainer(this.dom.practiceList);
      const fragment = document.createDocumentFragment();
      limited.forEach((exam) => {
        fragment.appendChild(this.createPracticeCardElement(exam));
      });
      this.dom.practiceList.appendChild(fragment);
      this.ensurePracticeBinding();
    },

    shouldVirtualizePractice(count) {
      if (!window.performanceOptimizer || typeof window.performanceOptimizer.createVirtualScroller !== 'function') {
        return false;
      }
      return count > PRACTICE_VIRTUAL_THRESHOLD;
    },

    ensurePracticeVirtualizer(items) {
      if (!this.dom.practiceList) return null;
      const dataset = Array.isArray(items) ? items.slice() : [];
      const layoutCalculator = ({ container, items: currentItems }) => this.calculatePracticeLayout(container, currentItems || dataset);
      const height = Math.max(420, Math.min(720, Math.round(window.innerHeight * 0.65) || 600));

      this.dom.practiceList.dataset.mode = 'virtual';
      this.dom.practiceList.style.padding = '12px';
      this.dom.practiceList.style.boxSizing = 'border-box';
      this.dom.practiceList.style.display = 'block';

      if (!this.practiceVirtualizer) {
        this.practiceVirtualizer = window.performanceOptimizer.createVirtualScroller(
          this.dom.practiceList,
          dataset,
          (exam) => this.createPracticeCardElement(exam),
          {
            containerHeight: height,
            bufferSize: 8,
            layoutCalculator
          }
        );
      } else {
        this.practiceVirtualizer.updateItems(dataset);
      }

      if (this.practiceVirtualizer && typeof this.practiceVirtualizer.recalculate === 'function') {
        this.practiceVirtualizer.recalculate();
      }

      this.ensurePracticeBinding();
      if (this.practiceVirtualizer) {
        this.practiceVirtualizer.itemCount = dataset.length;
      }
      return this.practiceVirtualizer;
    },

    destroyPracticeVirtualizer() {
      if (this.practiceVirtualizer && typeof this.practiceVirtualizer.destroy === 'function') {
        try { this.practiceVirtualizer.destroy(); }
        catch (error) { console.warn('[hp-portal] destroy virtualizer failed', error); }
      }
      this.practiceVirtualizer = null;
      if (this.dom.practiceList) {
        delete this.dom.practiceList.dataset.mode;
        this.dom.practiceList.style.removeProperty('padding');
        this.dom.practiceList.style.removeProperty('box-sizing');
        this.dom.practiceList.style.removeProperty('display');
        this.dom.practiceList.style.removeProperty('position');
        this.dom.practiceList.style.removeProperty('overflow');
        this.dom.practiceList.style.removeProperty('overflow-x');
        this.dom.practiceList.style.removeProperty('overflow-y');
        this.dom.practiceList.style.removeProperty('height');
      }
    },

    ensurePracticeBinding() {
      if (!this.dom.practiceList || this.dom.practiceList.__bound) return;
      this.dom.practiceList.addEventListener('click', (event) => {
        const btn = event.target.closest('button[data-action]');
        if (!btn) return;
        event.preventDefault();
        const id = btn.getAttribute('data-id');
        const action = btn.getAttribute('data-action');
        if (action === 'start') hpCore.startExam(id);
        if (action === 'pdf') hpCore.viewExamPDF(id);
      });
      this.dom.practiceList.__bound = true;
    },

    createPracticeCardElement(exam) {
      const article = document.createElement('article');
      article.className = 'hp-practice-card';

      const title = document.createElement('h4');
      title.textContent = exam && exam.title ? exam.title : '未命名试卷';
      article.appendChild(title);

      const meta = document.createElement('p');
      meta.className = 'text-sm text-white/70';
      const typeLabel = (exam && (exam.type || '').toLowerCase()) === 'listening' ? '🎧 听力' : '📖 阅读';
      const category = exam && (exam.category || exam.part) ? ' · ' + (exam.category || exam.part) : '';
      meta.textContent = typeLabel + category;
      article.appendChild(meta);

      const footer = document.createElement('footer');
      footer.className = 'flex flex-wrap gap-3';
      const startBtn = document.createElement('button');
      startBtn.className = 'rounded-full bg-[#ec1337]/85 px-4 py-2 font-semibold text-white shadow-lg shadow-[#ec1337]/30';
      startBtn.textContent = '开始练习';
      startBtn.setAttribute('data-action', 'start');
      startBtn.setAttribute('data-id', exam && exam.id ? exam.id : '');
      footer.appendChild(startBtn);

      if (exam && exam.pdfFilename) {
        const pdfBtn = document.createElement('button');
        pdfBtn.className = 'rounded-full border border-white/30 px-4 py-2 font-semibold text-white/85';
        pdfBtn.textContent = '查看 PDF';
        pdfBtn.setAttribute('data-action', 'pdf');
        pdfBtn.setAttribute('data-id', exam.id || '');
        footer.appendChild(pdfBtn);
      }

      article.appendChild(footer);
      return article;
    },

    calculatePracticeLayout(container, items) {
      const dataset = Array.isArray(items) ? items : [];
      const gap = 24;
      const baseWidth = 320;
      const measuredWidth = this.measurePracticeWidth(container);
      const columns = Math.max(1, Math.floor((measuredWidth + gap) / (baseWidth + gap)));
      const columnWidth = Math.max(260, Math.floor((measuredWidth - gap * (columns - 1)) / columns));
      const cardHeight = 220;
      const rowHeight = cardHeight + gap;
      const padding = 12;
      const totalRows = Math.max(1, Math.ceil(dataset.length / columns));
      const totalHeight = Math.max(rowHeight * totalRows + padding * 2, rowHeight);

      return {
        rowHeight,
        itemsPerRow: columns,
        totalRows,
        totalHeight,
        positionFor(index) {
          const row = Math.floor(index / columns);
          const col = index % columns;
          return {
            top: padding + row * rowHeight,
            left: padding + col * (columnWidth + gap),
            width: columnWidth,
            height: cardHeight
          };
        }
      };
    },

    measurePracticeWidth(container) {
      if (!container) return 960;
      const candidates = [
        container.clientWidth,
        container.offsetWidth,
        container.parentElement ? container.parentElement.clientWidth : 0,
        container.parentElement && container.parentElement.parentElement ? container.parentElement.parentElement.clientWidth : 0,
        window.innerWidth ? window.innerWidth - 120 : 0,
        960
      ];
      return Math.max.apply(null, candidates.filter((value) => Number.isFinite(value) && value > 0));
    },

    renderHistory() {
      if (!this.dom.historyTable || !this.dom.historyEmpty) return;
      const records = (hpCore.getRecords() || []).slice().sort((a, b) => {
        const da = new Date(a.date || a.timestamp || 0).getTime();
        const db = new Date(b.date || b.timestamp || 0).getTime();
        return db - da;
      });
      const exams = hpCore.getExamIndex() || [];

      if (!records.length) {
        const tbody = this.dom.historyTable.querySelector('tbody');
        if (tbody) this.clearContainer(tbody);
        this.dom.historyTable.classList.add('hidden');
        this.dom.historyEmpty.classList.remove('hidden');
        this.renderHistoryTrend([]);
        this.updateHistoryMeta([]);
        return;
      }

      this.dom.historyEmpty.classList.add('hidden');
      this.dom.historyTable.classList.remove('hidden');

      const examById = new Map();
      exams.forEach((exam) => { if (exam && exam.id) examById.set(exam.id, exam); });

      const tbody = this.dom.historyTable.querySelector('tbody');
      if (tbody) {
        this.clearContainer(tbody);
        const fragment = document.createDocumentFragment();
        records.slice(0, 150).forEach((record) => {
          const exam = examById.get(record.examId) || {};
          const title = exam.title || record.title || record.examName || '未知试卷';
          const score = this.getRecordScore(record);
          const duration = this.formatDuration(record.duration || (record.realData && record.realData.duration));
          const dateText = this.formatDate(record.date || record.timestamp);

          const tr = document.createElement('tr');
          const titleTd = document.createElement('td');
          titleTd.textContent = title;
          const typeTd = document.createElement('td');
          typeTd.textContent = exam.type || record.type || '阅读';
          const scoreTd = document.createElement('td');
          scoreTd.textContent = score + '%';
          const durationTd = document.createElement('td');
          durationTd.textContent = duration;
          const dateTd = document.createElement('td');
          dateTd.textContent = dateText;

          tr.appendChild(titleTd);
          tr.appendChild(typeTd);
          tr.appendChild(scoreTd);
          tr.appendChild(durationTd);
          tr.appendChild(dateTd);
          fragment.appendChild(tr);
        });
        tbody.appendChild(fragment);
      }

      this.renderHistoryTrend(records);
      this.updateHistoryMeta(records);
    },

    getRecordScore(record) {
      if (!record) return 0;
      if (typeof record.score === 'number' && Number.isFinite(record.score)) {
        return Math.round(record.score);
      }
      if (typeof record.percentage === 'number' && Number.isFinite(record.percentage)) {
        return Math.round(record.percentage);
      }
      if (record.realData && typeof record.realData.score === 'number') {
        return Math.round(record.realData.score);
      }
      return 0;
    },

    renderHistoryTrend(records) {
      if (!this.dom.historyChart) return;
      const canvas = this.dom.historyChart;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const series = this.buildHistorySeries(records || []);
      this.historySeries = series;

      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth || 640;
      const height = canvas.clientHeight || 260;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      if (!series.points.length) {
        this.toggleHistoryChartEmpty(true);
        canvas.dataset.rendered = '0';
        canvas.dataset.pointCount = '0';
        ctx.restore();
        return;
      }

      this.toggleHistoryChartEmpty(false);

      const padding = { top: 18, right: 28, bottom: 34, left: 54 };
      const areaWidth = Math.max(10, width - padding.left - padding.right);
      const areaHeight = Math.max(10, height - padding.top - padding.bottom);
      const scores = series.points.map((point) => point.score);
      const minScore = Math.max(0, Math.min.apply(null, scores.concat([60])));
      const maxScore = Math.min(100, Math.max.apply(null, scores.concat([85])));
      const range = Math.max(5, maxScore - minScore);
      const ticks = this.calculateScoreTicks(minScore, maxScore);

      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ticks.forEach((tick) => {
        const ratio = (tick - minScore) / range;
        const y = padding.top + (1 - ratio) * areaHeight;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(padding.left + areaWidth, y);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '12px "Helvetica Neue", Arial, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(Math.round(tick) + '%', padding.left - 8, y + 4);
      });

      ctx.strokeStyle = '#c084fc';
      ctx.lineWidth = 2;
      ctx.beginPath();

      series.points.forEach((point, index) => {
        const xRatio = series.points.length === 1 ? 0.5 : index / (series.points.length - 1);
        const scoreRatio = (point.score - minScore) / range;
        const x = padding.left + xRatio * areaWidth;
        const y = padding.top + (1 - scoreRatio) * areaHeight;
        point._plot = { x, y };
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });

      ctx.stroke();
      ctx.lineTo(padding.left + areaWidth, padding.top + areaHeight);
      ctx.lineTo(padding.left, padding.top + areaHeight);
      ctx.closePath();
      ctx.fillStyle = 'rgba(192,132,252,0.18)';
      ctx.fill();

      ctx.fillStyle = '#f8fafc';
      series.points.forEach((point) => {
        if (!point._plot) return;
        ctx.beginPath();
        ctx.arc(point._plot.x, point._plot.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.font = '12px "Helvetica Neue", Arial, sans-serif';
      ctx.textAlign = 'center';
      const labelStep = Math.max(1, Math.floor(series.points.length / 6));
      series.points.forEach((point, index) => {
        if (!point._plot) return;
        if (index % labelStep !== 0 && index !== series.points.length - 1) return;
        ctx.fillText(point.label, point._plot.x, height - padding.bottom + 20);
      });

      canvas.dataset.rendered = '1';
      canvas.dataset.pointCount = String(series.points.length);
      canvas.dataset.scoreMax = String(maxScore);
      canvas.dataset.scoreMin = String(minScore);
      ctx.restore();
    },

    buildHistorySeries(records) {
      const grouped = new Map();
      (records || []).forEach((record) => {
        const date = this.normalizeRecordDate(record);
        if (!date) return;
        const key = date.toISOString().slice(0, 10);
        const score = this.getRecordScore(record);
        const entry = grouped.get(key) || { sum: 0, count: 0, timestamp: date.getTime() };
        entry.sum += score;
        entry.count += 1;
        entry.timestamp = Math.max(entry.timestamp, date.getTime());
        grouped.set(key, entry);
      });

      const points = Array.from(grouped.entries()).map(([key, value]) => {
        const average = value.count ? value.sum / value.count : 0;
        return {
          dateKey: key,
          timestamp: value.timestamp,
          label: this.formatChartLabel(key),
          score: Math.round(Math.max(0, Math.min(100, average)))
        };
      }).sort((a, b) => a.timestamp - b.timestamp);

      const trimmed = points.slice(-30);
      return { points: trimmed };
    },

    normalizeRecordDate(record) {
      if (!record) return null;
      const raw = record.date || record.timestamp || record.completedAt || null;
      const date = raw ? new Date(raw) : new Date();
      if (isNaN(date.getTime())) return null;
      date.setHours(0, 0, 0, 0);
      return date;
    },

    formatChartLabel(dateKey) {
      try {
        const parts = dateKey.split('-');
        if (parts.length === 3) {
          return parts[1] + '/' + parts[2];
        }
        const d = new Date(dateKey);
        if (!isNaN(d.getTime())) {
          return (d.getMonth() + 1) + '/' + d.getDate();
        }
      } catch (_) {}
      return dateKey;
    },

    calculateScoreTicks(minScore, maxScore) {
      const lower = Math.max(0, Math.floor(minScore / 10) * 10);
      const upper = Math.min(100, Math.ceil(maxScore / 10) * 10);
      const diff = Math.max(10, upper - lower);
      const step = diff <= 30 ? 10 : Math.round(diff / 4 / 5) * 5 || 10;
      const ticks = [];
      for (let value = lower; value <= upper; value += step) {
        ticks.push(value);
      }
      if (!ticks.includes(upper)) ticks.push(upper);
      return ticks;
    },

    toggleHistoryChartEmpty(show) {
      if (!this.dom.historyChartEmpty) return;
      if (show) {
        this.dom.historyChartEmpty.classList.remove('hidden');
      } else {
        this.dom.historyChartEmpty.classList.add('hidden');
      }
    },

    updateHistoryMeta(records) {
      const total = Array.isArray(records) ? records.length : 0;
      const level = Math.max(1, Math.min(20, Math.floor(total / 8) + 1));
      const prevThreshold = (level - 1) * 8;
      const nextThreshold = level * 8;
      const progress = nextThreshold === prevThreshold
        ? 100
        : Math.max(0, Math.min(100, Math.round(((total - prevThreshold) / (nextThreshold - prevThreshold)) * 100)));

      if (this.dom.historyLevel) {
        this.dom.historyLevel.textContent = String(level);
      }
      if (this.dom.historyProgressBar) {
        this.dom.historyProgressBar.style.width = progress + '%';
      }
      if (this.dom.historyProgressText) {
        this.dom.historyProgressText.textContent = progress + '%';
      }
    },

    updateSettingsMeta() {
      const statusEl = document.getElementById('hp-settings-status');
      if (!statusEl) return;
      try {
        const status = hpCore.getStatus ? hpCore.getStatus() : null;
        if (!status) return;
        statusEl.textContent = '题库 ' + status.examCount + ' 套 · 练习记录 ' + status.recordCount + ' 条 · 最近更新 ' + this.formatRelative(status.lastUpdateTime);
      } catch (e) {
        console.warn('[hp-portal] update settings status failed', e);
      }
    },

    invokeSetting(action) {
      switch (action) {
        case 'clear-cache':
          try {
            localStorage.clear();
            sessionStorage.clear();
            hpCore.showMessage('缓存已清理，页面即将刷新', 'success');
            setTimeout(() => window.location.reload(), 400);
          } catch (e) {
            hpCore.showMessage('清理缓存失败: ' + e.message, 'error');
          }
          break;
        case 'load-library':
          if (typeof window.showLibraryLoaderModal === 'function') {
            window.showLibraryLoaderModal();
          } else if (typeof window.loadLibrary === 'function') {
            window.loadLibrary(false);
          } else {
            hpCore.showMessage('题库加载器未就绪', 'warning');
          }
          break;
        case 'force-refresh':
          if (typeof window.loadLibrary === 'function') {
            hpCore.showMessage('正在刷新题库…', 'info');
            window.loadLibrary(true);
          } else {
            window.location.reload();
          }
          break;
        case 'config-list':
          if (typeof window.showLibraryConfigListV2 === 'function') {
            window.showLibraryConfigListV2();
          } else {
            hpCore.showMessage('暂无可用配置列表', 'info');
          }
          break;
        case 'backup-create':
          if (typeof window.createManualBackup === 'function') {
            window.createManualBackup();
          } else {
            hpCore.showMessage('备份模块不可用', 'warning');
          }
          break;
        case 'backup-list':
          if (typeof window.showBackupList === 'function') {
            window.showBackupList();
          } else {
            hpCore.showMessage('暂无备份列表', 'info');
          }
          break;
        case 'export':
          if (typeof window.exportAllData === 'function') {
            window.exportAllData();
          } else {
            hpCore.showMessage('导出功能不可用', 'warning');
          }
          break;
        case 'import':
          if (typeof window.importData === 'function') {
            window.importData();
          } else {
            hpCore.showMessage('导入功能不可用', 'warning');
          }
          break;
        case 'theme-modal':
          if (window.HPTheme && typeof window.HPTheme.open === 'function') {
            window.HPTheme.open();
          } else if (typeof window.toggleThemeModal === 'function') {
            window.toggleThemeModal(true);
          } else {
            const modal = document.getElementById('hp-theme-modal');
            if (modal) {
              modal.classList.remove('hidden');
            } else {
              hpCore.showMessage('主题面板已合并，使用顶部按钮切换主题', 'info');
            }
          }
          break;
        default:
          hpCore.showMessage('未识别的操作: ' + action, 'warning');
      }
    },

    calculateStats(exams, records) {
      const totalExams = Array.isArray(exams) ? exams.length : 0;
      const completed = Array.isArray(records) ? records.length : 0;
      let average = 0;
      if (completed) {
        const totalScore = records.reduce((sum, record) => {
          const val = typeof record.score === 'number' ? record.score : (record.percentage || 0);
          return sum + (Number.isFinite(val) ? val : 0);
        }, 0);
        average = Math.round(totalScore / completed);
      }

      const daySet = new Set();
      (records || []).forEach((record) => {
        const date = new Date(record.date || record.timestamp || Date.now());
        if (!isNaN(date.getTime())) {
          daySet.add(date.toDateString());
        }
      });

      const lastRecord = records && records[0] ? new Date(records[0].date || records[0].timestamp || Date.now()) : new Date();
      const updated = this.formatRelative(lastRecord.getTime());

      return {
        totalExams,
        completed,
        average: Math.max(0, Math.min(100, average || 0)),
        days: daySet.size,
        updated
      };
    },

    formatDuration(value) {
      const seconds = Number(value) || 0;
      const m = Math.floor(seconds / 60);
      const s = Math.abs(seconds % 60);
      return m + '分' + String(s).padStart(2, '0') + '秒';
    },

    formatDate(value) {
      if (!value) return '未知时间';
      const date = new Date(value);
      if (isNaN(date.getTime())) return '未知时间';
      return date.toLocaleString();
    },

    formatRelative(timestamp) {
      if (!timestamp) return '暂无记录';
      const delta = Date.now() - Number(timestamp || 0);
      if (!Number.isFinite(delta)) return '暂无记录';
      if (delta < 60 * 1000) return '刚刚';
      if (delta < 60 * 60 * 1000) return Math.round(delta / (60 * 1000)) + ' 分钟前';
      if (delta < 24 * 60 * 60 * 1000) return Math.round(delta / (60 * 60 * 1000)) + ' 小时前';
      return Math.round(delta / (24 * 60 * 60 * 1000)) + ' 天前';
    },

    escape(value) {
      return String(value || '').replace(/[&<>"']/g, function (match) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[match];
      });
    },

    escapeAttr(value) {
      return this.escape(value).replace(/"/g, '&quot;');
    }
  };

  const boot = () => Portal.init();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => hpCore.ready(boot));
  } else {
    hpCore.ready(boot);
  }
})();
