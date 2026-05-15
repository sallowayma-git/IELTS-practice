(function initIndexInteractions(global) {
  "use strict";

  var initialized = false;
  var browsePrefetched = false;
  var morePrefetched = false;
  var indexInteractionsInitialized = false;

  function invokeGlobal(name) {
    var fn = global[name];
    if (typeof fn !== "function") {
      return;
    }
    var args = Array.prototype.slice.call(arguments, 1);
    return fn.apply(global, args);
  }

  function prevent(event) {
    if (event) {
      event.preventDefault();
    }
  }

  function callAction(name, datasetKey, fallbackValue) {
    return function (target, event) {
      prevent(event);
      if (!datasetKey) {
        return invokeGlobal(name);
      }
      return invokeGlobal(name, target.dataset[datasetKey] || fallbackValue);
    };
  }

  function notify(type, message) {
    if (typeof global.showMessage === "function") {
      global.showMessage(message, type);
    }
  }

  function ensureBrowse() {
    if (browsePrefetched) {
      return;
    }
    browsePrefetched = true;
    var loader =
      global.AppEntry && typeof global.AppEntry.ensureBrowseGroup === "function"
        ? global.AppEntry.ensureBrowseGroup
        : function fallback() {
            return Promise.resolve();
          };
    loader().catch(function swallow(error) {
      console.warn("[IndexInteractions] 预加载 browse-view 失败:", error);
    });
  }

  function ensureMore() {
    if (morePrefetched) {
      return;
    }
    morePrefetched = true;
    var loader =
      global.AppEntry &&
      typeof global.AppEntry.ensureMoreToolsGroup === "function"
        ? global.AppEntry.ensureMoreToolsGroup
        : function fallback() {
            return Promise.resolve();
          };
    loader().catch(function swallow(error) {
      console.warn("[IndexInteractions] 预加载 more-tools 失败:", error);
    });
  }

  function finishForceRefresh(type, message) {
    if (!global.__forceLibraryRefreshInProgress) {
      return;
    }

    global.__forceLibraryRefreshInProgress = false;
    notify(type, message);
  }

  function forceRefreshLibrary() {
    if (typeof global.loadLibrary !== "function") {
      return;
    }

    notify("info", "正在强制刷新题库...");
    try {
      global.__forceLibraryRefreshInProgress = true;
      var result = global.loadLibrary(true);
      if (result && typeof result.then === "function") {
        result
          .then(function () {
            finishForceRefresh("success", "题库刷新完成");
          })
          .catch(function (error) {
            finishForceRefresh(
              "error",
              "题库刷新失败: " + ((error && error.message) || error),
            );
          });

        return;
      }
      setTimeout(function () {
        finishForceRefresh("success", "题库刷新完成");
      }, 800);
    } catch (error) {
      finishForceRefresh(
        "error",
        "题库刷新失败: " + ((error && error.message) || error),
      );
    }
  }

  function launchOnboarding(_, event) {
    prevent(event);
    if (
      global.OnboardingTour &&
      typeof global.OnboardingTour.start === "function"
    ) {
      global.OnboardingTour.start(true);
    }
  }

  function loadLibraryAction(_, event) {
    prevent(event);
    if (typeof global.showLibraryLoaderModal === "function") {
      global.showLibraryLoaderModal();
      return;
    }
    if (typeof global.loadLibrary === "function") {
      global.loadLibrary(false);
    }
  }

  function exportPracticeMarkdown(_, event) {
    prevent(event);
    if (
      global.AppActions &&
      typeof global.AppActions.exportPracticeMarkdown === "function"
    ) {
      global.AppActions.exportPracticeMarkdown();
    }
  }

  function navigateThemePortal(target, event) {
    prevent(event);
    if (typeof global.navigateToThemePortal !== "function") {
      return;
    }
    var options = {};
    if (target.dataset.themeLabel) {
      options.label = target.dataset.themeLabel;
    }
    if (target.dataset.themeName) {
      options.theme = target.dataset.themeName;
    }
    global.navigateToThemePortal(target.dataset.themeUrl || "", options);
  }

  var actionHandlers = {
    "show-developer-team": callAction("showDeveloperTeam"),
    "hide-developer-team": callAction("hideDeveloperTeam"),
    "show-theme-switcher": callAction("showThemeSwitcherModal"),
    "hide-theme-switcher": callAction("hideThemeSwitcherModal"),
    "show-achievements": callAction("showAchievements"),
    "hide-achievements": callAction("hideAchievements"),
    "filter-exam-type": callAction("filterByType", "filterType", "all"),
    "filter-record-type": callAction(
      "filterRecordsByType",
      "filterType",
      "all",
    ),
    "clear-exam-search": callAction("clearSearch"),
    "clear-history-search": callAction("clearPracticeHistorySearch"),
    "toggle-bulk-delete": callAction("toggleBulkDelete"),
    "clear-practice-data": callAction("clearPracticeData"),
    "toggle-bloom-theme": callAction("toggleBloomDarkMode"),
    "apply-theme": callAction("applyTheme", "theme", "default"),
    "clear-cache": callAction("clearCache"),
    "library-config": callAction("showLibraryConfigListV2"),
    "create-backup": callAction("createManualBackup"),
    "backup-list": callAction("showBackupList"),
    "export-data": callAction("exportAllData"),
    "import-data": callAction("importData"),
    "show-onboarding": launchOnboarding,
    "load-library": loadLibraryAction,
    "force-refresh": function (_, event) {
      prevent(event);
      forceRefreshLibrary();
    },
    "export-practice-markdown": exportPracticeMarkdown,
    "navigate-theme-portal": navigateThemePortal,
  };

  var inputHandlers = {
    "search-exams": function (target) {
      invokeGlobal("searchExams", target.value || "");
    },
    "search-practice-history": function (target) {
      invokeGlobal("searchPracticeHistory", target.value || "");
    },
  };

  function attachPrefetch(button, handler) {
    if (!button) {
      return;
    }
    ["pointerenter", "focus"].forEach(function (eventName) {
      button.addEventListener(eventName, handler, { once: true });
    });
    button.addEventListener("click", handler);
  }

  function attachNavPrefetch() {
    attachPrefetch(
      document.querySelector('.main-nav [data-view=\"browse\"]'),
      ensureBrowse,
    );
    attachPrefetch(
      document.querySelector('.main-nav [data-view=\"more\"]'),
      ensureMore,
    );
  }

  function handleClick(event) {
    var target = event.target.closest("[data-action]");
    if (!target) {
      return;
    }
    var handler = actionHandlers[target.dataset.action];
    if (typeof handler === "function") {
      handler(target, event);
    }
  }

  function handleInput(event) {
    var target =
      event.target && typeof event.target.closest === "function"
        ? event.target.closest("[data-input-action]")
        : null;
    if (
      !target ||
      (target.dataset.inputEvent && target.dataset.inputEvent !== event.type)
    ) {
      return;
    }
    var handler = inputHandlers[target.dataset.inputAction];
    if (typeof handler === "function") {
      handler(target, event);
    }
  }

  function init() {
    if (initialized) {
      return;
    }
    initialized = true;
    attachNavPrefetch();
    document.addEventListener("click", handleClick);
    document.addEventListener("input", handleInput);
    document.addEventListener("keyup", handleInput);
  }

  function getActiveHeroNavButton(nav) {
    if (!nav) {
      return null;
    }
    var active = nav.querySelector(".hero-nav__btn.active");
    if (active) {
      return active;
    }
    return nav.querySelector(".hero-nav__btn");
  }

  function getHeroNavIndicatorRect(nav, btn) {
    if (!nav || !btn || !btn.getBoundingClientRect) {
      return null;
    }

    var navRect = nav.getBoundingClientRect();
    var btnRect = btn.getBoundingClientRect();
    if (!btnRect || btnRect.width <= 0 || btnRect.height <= 0) {
      return null;
    }

    var inset = 3;
    return {
      left: Math.max(0, btnRect.left - navRect.left + inset),
      top: Math.max(0, btnRect.top - navRect.top + inset),
      width: Math.max(16, btnRect.width - inset * 2),
      height: Math.max(16, btnRect.height - inset * 2),
    };
  }

  function applyHeroNavIndicatorRect(indicator, rect) {
    if (!indicator || !rect) {
      return;
    }
    indicator.style.left = rect.left + "px";
    indicator.style.top = rect.top + "px";
    indicator.style.width = rect.width + "px";
    indicator.style.height = rect.height + "px";
  }

  function animateHeroNavIndicator(state, targetRect, immediate) {
    if (!state || !state.indicator || !targetRect) {
      return;
    }

    var indicator = state.indicator;

    // 如果需要瞬间完成（例如窗口 Resize），则临时关闭过渡动画
    var shouldReduceMotion =
      global.matchMedia &&
      global.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (immediate || shouldReduceMotion) {
      indicator.style.transition = "none";
    } else {
      indicator.style.transition = ""; // 恢复 CSS 文件中定义的弹簧过渡动画
    }

    applyHeroNavIndicatorRect(indicator, targetRect);

    // 强制浏览器重排以便 none 立即生效后再恢复
    if (immediate || shouldReduceMotion) {
      void indicator.offsetWidth;
      indicator.style.transition = "";
    }

    state.lastRect = targetRect;
    state.ready = true;
  }

  function setupHeroNavLiquidIndicator() {
    if (global.__heroNavLiquidInitialized) {
      return;
    }

    var nav = document.querySelector(".hero-nav");
    if (!nav) {
      return;
    }

    var indicator = nav.querySelector(".hero-nav__liquid-indicator");
    if (!indicator) {
      indicator = document.createElement("span");
      indicator.className = "hero-nav__liquid-indicator";
      nav.insertBefore(indicator, nav.firstChild);
    }

    var state = {
      nav: nav,
      indicator: indicator,
      lastRect: null,
      ready: false,
      animation: null,
    };

    var sync = function (immediate) {
      var activeBtn = getActiveHeroNavButton(nav);
      var targetRect = getHeroNavIndicatorRect(nav, activeBtn);
      if (!targetRect) {
        return;
      }
      animateHeroNavIndicator(state, targetRect, !!immediate);
      nav.classList.add("hero-nav--liquid-ready");
    };

    var resizeToken = 0;
    var scheduleSync = function (immediate) {
      if (resizeToken) {
        global.cancelAnimationFrame(resizeToken);
      }
      resizeToken = global.requestAnimationFrame(function () {
        resizeToken = 0;
        sync(immediate);
      });
    };

    nav.addEventListener("click", function (event) {
      if (!event.target || !event.target.closest(".hero-nav__btn")) {
        return;
      }
      scheduleSync(false);
    });

    var observer = new MutationObserver(function (mutations) {
      var shouldSync = false;
      for (var i = 0; i < mutations.length; i += 1) {
        var mutation = mutations[i];
        if (
          mutation.type === "attributes" &&
          mutation.attributeName === "class"
        ) {
          shouldSync = true;
          break;
        }
      }
      if (shouldSync) {
        scheduleSync(false);
      }
    });
    observer.observe(nav, {
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });

    global.addEventListener("resize", function () {
      scheduleSync(true);
    });

    if (
      document.fonts &&
      typeof document.fonts.ready === "object" &&
      typeof document.fonts.ready.then === "function"
    ) {
      document.fonts.ready.then(function () {
        scheduleSync(true);
      });
    }

    scheduleSync(true);
    global.__heroNavLiquidInitialized = true;
  }

  function setupSegmentedControls() {
    if (global.__segmentedControlsInitialized) return;

    function syncIndicator(control) {
      // indicator 可能在 innerHTML='' 后被销毁，必须每次检查重建
      var indicator = control.querySelector(".shui-segmented-indicator");
      if (!indicator) {
        indicator = document.createElement("div");
        indicator.className = "shui-segmented-indicator";
        control.insertBefore(indicator, control.firstChild);
      }

      var activeBtn =
        control.querySelector(".shui-segmented-btn.active") ||
        control.querySelector('.shui-segmented-btn[aria-pressed="true"]') ||
        control.querySelector(".shui-filter-btn.active") ||
        control.querySelector('.shui-filter-btn[aria-pressed="true"]');
      if (activeBtn && activeBtn.offsetWidth > 0) {
        indicator.style.width = activeBtn.offsetWidth + "px";
        indicator.style.transform =
          "translateX(" + activeBtn.offsetLeft + "px)";
        indicator.style.opacity = "1";
      } else {
        indicator.style.opacity = "0";
      }
    }

    function syncAll() {
      var controls = document.querySelectorAll(".shui-segmented-control");
      for (var i = 0; i < controls.length; i++) {
        syncIndicator(controls[i]);
      }
    }

    // 点击任何 segmented btn 时立即同步
    document.addEventListener("click", function (e) {
      if (
        e.target &&
        e.target.closest &&
        (e.target.closest(".shui-segmented-btn") ||
          e.target.closest(".shui-filter-btn"))
      ) {
        setTimeout(syncAll, 10);
        setTimeout(syncAll, 60);
      }
    });

    // 监听 DOM 变更：browseController 重建按钮时 childList 会变更
    var observer = new MutationObserver(function (mutations) {
      var needsSync = false;
      for (var i = 0; i < mutations.length; i++) {
        var mutation = mutations[i];
        var target = mutation.target;
        // childList 变更直接在 segmented-control 容器上
        if (
          mutation.type === "childList" &&
          target.classList &&
          target.classList.contains("shui-segmented-control")
        ) {
          needsSync = true;
          break;
        }
        // class 属性变更在 segmented-btn 上（active 切换）
        if (
          mutation.type === "attributes" &&
          target.classList &&
          (target.classList.contains("shui-segmented-btn") ||
            target.classList.contains("shui-filter-btn"))
        ) {
          needsSync = true;
          break;
        }
        // 向上查找（safety net）
        if (target.closest && target.closest(".shui-segmented-control")) {
          needsSync = true;
          break;
        }
      }
      if (needsSync) {
        setTimeout(syncAll, 15);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    global.addEventListener("resize", syncAll);

    // 视图切换时重新同步（view 从 display:none 变为可见后 offsetLeft 才有效）
    document.addEventListener("click", function (e) {
      var navBtn =
        e.target && e.target.closest && e.target.closest(".hero-nav__btn");
      if (navBtn) {
        // 视图切换动画完成后同步
        setTimeout(syncAll, 50);
        setTimeout(syncAll, 200);
        setTimeout(syncAll, 500);
      }
    });

    if (
      document.fonts &&
      document.fonts.ready &&
      typeof document.fonts.ready.then === "function"
    ) {
      document.fonts.ready.then(syncAll);
    }

    setTimeout(syncAll, 50);
    setTimeout(syncAll, 300);
    global.__segmentedControlsInitialized = true;
    global.updateSegmentedIndicators = syncAll;
  }

  function initializeIndexInteractions() {
    setupSegmentedControls();
  }

  function init() {
    if (indexInteractionsInitialized) {
      return;
    }
    indexInteractionsInitialized = true;
    attachNavPrefetch();
    document.addEventListener('click', handleClick);
    document.addEventListener('input', handleInput);
    document.addEventListener('keyup', handleInput);
    setupHeroNavLiquidIndicator();
    setupSegmentedControls();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  global.ensureIndexInteractions = function ensureIndexInteractions() {
    init();
  };
})(typeof window !== "undefined" ? window : this);
