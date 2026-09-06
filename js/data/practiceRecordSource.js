/**
 * 练习记录来源判定 —— “什么算真实练习记录”的唯一权威定义。
 *
 * 背景（本文件存在的理由）：
 * 这条规则历史上被复制成了两套互不相通的实现，语义还不一样：
 *   - UI 侧 js/main.js `updatePracticeView` 只看顶层 `dataSource`；
 *   - 投影器侧 js/data/v2/appData.js `computeStats` / `computeAchievementProgress`
 *     只看 `metadata.source === 'onboarding-demo'`。
 * 结果是 `demo` / `e2e-seed` 这类记录“在练习记录页看不见，却计入成绩统计和成就解锁”，
 * 用户会看到自己没做过的题影响了正确率与成就。
 *
 * 因此判定必须只有一份实现，并被所有消费方共享。本文件同时被打进
 * core-foundation / reading-page / practice-page-enhancer / listening-record-bridge /
 * listening-wrapper（供 appData.js 的投影器使用）和 browse（供 js/main.js 的渲染过滤使用）
 * 等 bundle；appData.js 在启动时硬性要求本模块存在，缺失即抛错，杜绝“再退回本地副本”。
 *
 * ---------------------------------------------------------------------------
 * 语义（两个维度，任一命中即判为非真实）
 *
 * 1) dataSource（顶层，回退 metadata.dataSource）
 *    - 缺失 / null / 空串  => **真实记录**
 *    - 'real'              => 真实记录
 *    - 其它任何显式值      => 非真实（演示 / 种子 / 占位）
 *
 *    “缺失即真实”是硬性约束，不得收窄：生产代码只在 practiceRecorder / examSessionMixin
 *    三处写过该字段且都写 'real'，套题聚合、听力桥接、legacy 迁移记录从来不写。
 *    曾经有一版把“没标注”当成“非真实”，直接导致练习记录页整页空白（线上 P0）。
 *
 * 2) metadata.source
 *    只精确匹配已知的演示/种子标记，**绝不做包含匹配**。
 *    这个字段是被复用的：套题记录会写 'listening' / 'reading'（内容类型标签，见
 *    js/app/suitePracticeMixin.js），消息通道会写 'practice_page' / 'inline_collector'
 *    / 'suite_placeholder' / 'listening_record_bridge' / 'data_collector'（采集方式标签）。
 *    任何模糊匹配都可能把真实记录判成演示数据，属于同一类 P0。
 *
 * 注意：`record.source` 与 `realData.source` 是采集方式标签而非来源标注，故不参与判定。
 */
(function initPracticeRecordSource(global) {
    'use strict';

    // 同一份源码会被多个 bundle 内联（浏览器里 core-foundation 与 browse 都会执行一次），
    // 重复赋值本身无害，但仍按仓库惯例做幂等保护，避免任何形态的静默覆盖。
    if (global.PracticeRecordSource && global.PracticeRecordSource.__stable === true) {
        return;
    }

    /** 被认可为“真实用户练习”的显式 dataSource 取值。 */
    const REAL_DATA_SOURCES = Object.freeze(['real']);

    /**
     * 被认定为“演示 / 种子 / 夹具数据”的 metadata.source 取值（精确匹配，大小写与首尾空白无关）。
     * 目前生产代码只会写出 'onboarding-demo'（js/components/onboardingTour.js）；
     * 其余是历史与测试夹具里出现过的等价写法，一并显式列出而不是靠模糊匹配推断。
     */
    const DEMO_SOURCE_MARKERS = Object.freeze([
        'onboarding-demo',
        'onboarding_demo',
        'onboardingdemo',
        'demo',
        'e2e-seed',
        'e2e_seed'
    ]);

    /** 只有新手引导自己的 marker 才有资格申请临时历史列表预览。 */
    const ONBOARDING_PREVIEW_MARKERS = Object.freeze([
        'onboarding-demo',
        'onboarding_demo',
        'onboardingdemo'
    ]);

    const realDataSourceSet = new Set(REAL_DATA_SOURCES);
    const demoSourceSet = new Set(DEMO_SOURCE_MARKERS);
    const onboardingPreviewMarkerSet = new Set(ONBOARDING_PREVIEW_MARKERS);

    function normalize(value) {
        if (value === undefined || value === null) return '';
        return String(value).trim().toLowerCase();
    }

    function asObject(value) {
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    }

    function hasOwn(object, field) {
        return Object.prototype.hasOwnProperty.call(object, field);
    }

    /** 读取记录的来源标注：顶层优先，回退 metadata（light 投影同样走这条回退链）。 */
    function readDataSource(record) {
        if (hasOwn(record, 'dataSource')) return normalize(record.dataSource);
        const metadata = asObject(record.metadata);
        return hasOwn(metadata, 'dataSource') ? normalize(metadata.dataSource) : '';
    }

    function readMetadataSource(record) {
        return normalize(asObject(record.metadata).source);
    }

    /**
     * 唯一判定入口：该记录是否算作用户的真实练习。
     * 练习记录列表渲染、practice.stats 投影、achievements.progress 投影三者必须都用它，
     * 三处结论一致是本模块的核心契约。
     */
    function isRealPracticeRecord(record) {
        if (!record || typeof record !== 'object') return false;

        const dataSource = readDataSource(record);
        // 缺失/空值一律按真实记录对待（见文件头“缺失即真实”）。
        if (dataSource !== '' && !realDataSourceSet.has(dataSource)) return false;

        if (demoSourceSet.has(readMetadataSource(record))) return false;

        return true;
    }

    /** isRealPracticeRecord 的补集，仅对合法记录对象成立（非对象既不真也不演示）。 */
    function isDemoPracticeRecord(record) {
        if (!record || typeof record !== 'object') return false;
        return !isRealPracticeRecord(record);
    }

    function filterRealPracticeRecords(records) {
        return (Array.isArray(records) ? records : []).filter(isRealPracticeRecord);
    }

    // -----------------------------------------------------------------------
    // 引导预览白名单（仅影响渲染，永不影响统计与成就）
    //
    // 新手引导的"回顾模式"步骤会先把一条演示记录写进权威 practice records，
    // 再等待它在练习记录列表里出现（js/components/onboardingTour.js
    // `_injectDemoRecord` -> `_waitForSelector`），演示完成后立即删除。
    //
    // 这条记录按上面的判定确实是演示数据（metadata.source = 'onboarding-demo'），
    // 所以它必须继续被 practice.stats / achievements.progress 排除。但引导要教用户
    // 认识这一行 UI，因此需要一个**显式、按 id 限定、临时**的渲染例外。
    //
    // 关键设计：例外只存在于视图层白名单，投影器根本读不到它——
    // 于是"是否真实"仍然只有一份判定，不会退回"UI 与统计各写一套"的老 bug。
    // 历史上引导记录之所以能显示，只是因为没人给它写 dataSource（巧合而非设计）。
    // -----------------------------------------------------------------------
    const previewRecordIds = new Set();

    function normalizeId(value) {
        if (value === undefined || value === null) return '';
        return String(value).trim();
    }

    /** 登记一条允许在练习记录列表中预览的演示记录 id（引导步骤开始时调用）。 */
    function allowPreviewRecordId(recordId) {
        const id = normalizeId(recordId);
        if (id) previewRecordIds.add(id);
        return id !== '';
    }

    /** 撤销预览许可（引导结束/跳过/清理演示记录时调用）。 */
    function clearPreviewRecordId(recordId) {
        if (recordId === undefined) {
            previewRecordIds.clear();
            return true;
        }
        return previewRecordIds.delete(normalizeId(recordId));
    }

    function isPreviewRecord(record) {
        if (!previewRecordIds.size || !record || typeof record !== 'object') return false;
        if (!onboardingPreviewMarkerSet.has(readMetadataSource(record))) return false;
        const id = normalizeId(record.id || record.recordId);
        return Boolean(id && previewRecordIds.has(id));
    }

    /**
     * 练习记录列表的渲染过滤：真实记录 + 已显式登记的引导预览记录。
     * 统计/成就一律用 filterRealPracticeRecords，绝不用这个函数。
     */
    function filterRecordsForHistoryView(records) {
        return (Array.isArray(records) ? records : [])
            .filter((record) => isRealPracticeRecord(record) || isPreviewRecord(record));
    }

    const api = Object.freeze({
        __stable: true,
        REAL_DATA_SOURCES,
        DEMO_SOURCE_MARKERS,
        ONBOARDING_PREVIEW_MARKERS,
        isRealPracticeRecord,
        isDemoPracticeRecord,
        filterRealPracticeRecords,
        allowPreviewRecordId,
        clearPreviewRecordId,
        isPreviewRecord,
        filterRecordsForHistoryView
    });

    global.PracticeRecordSource = api;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
