import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const checkOnly = process.argv.includes('--check');

const bundles = {
    'js/bundles/runtime-entry.bundle.js': [
        'js/presentation/threeBackground.js',
        'js/runtime/bootScreen.js',
        'js/runtime/lazyLoader.js',
        'js/utils/suitePreference.js',
        'js/presentation/app-actions.js'
    ],
    'js/bundles/core-foundation.bundle.js': [
        'js/utils/environmentDetector.js',
        'js/utils/logger.js',
        'js/data/practiceRecordSource.js',
        'js/data/v2/dataCatalog.js',
        'js/data/v2/dataKernel.js',
        'js/data/v2/appData.js',
        'js/core/externalBackupService.js',
        'js/core/siteDataReset.js',
        'js/core/practiceCore.js',
        'js/core/resourceCore.js',
        'assets/generated/reading-exams/manifest.js',
        'js/app/state-service.js',
        'js/services/libraryDiscovery.js',
        'js/services/libraryManager.js'
    ],
    'js/bundles/ui-shell.bundle.js': [
        'js/utils/dom.js',
        'js/services/overviewStats.js',
        'js/views/overviewView.js',
        'js/presentation/navigation-controller.js',
        'js/presentation/message-center.js',
        'js/utils/practiceTimerPreferences.js',
        'js/components/practiceSettingsPanel.js',
        'js/components/libraryManagerPanel.js',
        'js/app/main-entry.js',
        'js/presentation/indexInteractions.js',
        'js/presentation/emojiIconizer.js'
    ],
    'js/bundles/legacy-app.bundle.js': [
        'js/boot-fallbacks.js',
        'js/app.js',
        'js/components/onboardingTour.js'
    ],
    'js/bundles/browse.bundle.js': [
        'js/views/legacyViewBundle.js',
        'js/data/practiceRecordSource.js',
        'js/app/examActions.js',
        'js/app/spellingErrorCollector.js',
        'js/app/examSessionMixin.js',
        'js/app/browseController.js',
        'js/components/PDFHandler.js',
        'js/components/BrowseStateManager.js',
        'js/utils/suiteBackGuard.js',
        'js/utils/answerMatchCore.js',
        'js/utils/answerComparisonUtils.js',
        'js/utils/BrowsePreferencesUtils.js',
        'js/main.js'
    ],
    'js/bundles/diagnostics.bundle.js': [
        'js/components/SystemDiagnostics.js',
        'js/components/PerformanceOptimizer.js',
        'js/utils/dataConsistencyManager.js',
        'js/utils/performance.js'
    ],
    'js/bundles/practice.bundle.js': [
        'js/app/spellingErrorCollector.js',
        'js/utils/markdownExporter.js',
        'js/components/practiceRecordModal.js',
        'js/components/practiceHistoryEnhancer.js',
        'js/utils/answerSanitizer.js',
        'js/core/practiceRecorder.js'
    ],
    'js/bundles/session.bundle.js': [
        'js/app/suitePracticeMixin.js'
    ],
    'js/bundles/reading-page.bundle.js': [
        'js/data/practiceRecordSource.js',
        'js/data/v2/dataCatalog.js',
        'js/data/v2/dataKernel.js',
        'js/data/v2/appData.js',
        'js/runtime/readingExamRegistry.js',
        'js/runtime/readingExplanationRegistry.js',
        'js/runtime/readingHighlightShared.js',
        'js/utils/answerSanitizer.js',
        'js/utils/answerMatchCore.js',
        'assets/wordlists/ielts_core.bundle.js',
        'assets/wordlists/ecdict_reading.bundle.js',
        'js/core/dictionaryService.js',
        'js/runtime/reviewHighlightDictionary.js',
        'js/utils/practiceTimerPreferences.js',
        'js/runtime/unifiedReadingPage.js'
    ],
    'js/bundles/practice-page-enhancer.bundle.js': [
        'js/data/practiceRecordSource.js',
        'js/data/v2/dataCatalog.js',
        'js/data/v2/dataKernel.js',
        'js/data/v2/appData.js',
        'js/utils/suiteBackGuard.js',
        'js/utils/answerMatchCore.js',
        'js/app/spellingErrorCollector.js',
        'js/practice-page-enhancer.js'
    ],
    'js/bundles/listening-record-bridge.bundle.js': [
        'js/data/practiceRecordSource.js',
        'js/data/v2/dataCatalog.js',
        'js/data/v2/dataKernel.js',
         'js/data/v2/appData.js',
         'js/utils/answerMatchCore.js',
         'js/app/spellingErrorCollector.js',
         'js/utils/safeObjectLiteralParser.js',
         'js/listeningRecordBridge.js'
     ],
    'js/bundles/listening-wrapper.bundle.js': [
        'js/data/practiceRecordSource.js',
        'js/data/v2/dataCatalog.js',
        'js/data/v2/dataKernel.js',
        'js/data/v2/appData.js',
        'js/utils/practiceTimerPreferences.js',
        'js/listeningUnifiedWrapper.js'
    ],
    'js/bundles/more.bundle.js': [
        'assets/wordlists/ielts_core.bundle.js',
        'js/utils/vocabDataIO.js',
        'js/core/vocabScheduler.js',
        'js/core/vocabStore.js',
        'js/app/vocabListSwitcher.js',
        'js/components/vocabDashboardCards.js',
        'js/components/vocabSessionView.js',
        'js/presentation/moreView.js',
        'js/presentation/miniGames.js',
        'js/services/achievementManager.js'
    ],
    'js/bundles/theme.bundle.js': [
        'js/theme-switcher.js'
    ]
};

function readSource(relativePath) {
    const absolutePath = path.join(root, relativePath);
    if (!fs.existsSync(absolutePath)) {
        throw new Error(`Missing bundle input: ${relativePath}`);
    }
    return fs.readFileSync(absolutePath, 'utf8')
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.replace(/[ \t]+$/g, ''))
        .join('\n')
        .replace(/\s*$/, '\n');
}

// ============================================================================
// 全局符号冲突检查
//
// bundle 是多个源文件的纯文本拼接，没有模块作用域隔离：两个文件写入同一个全局名字
// 时，后者会静默覆盖前者。历史事故：js/app/examActions.js 内 IIFE 导出的
// loadExamList 覆盖了 js/main.js 的同名顶层函数（两者语义不同），导致用户切换
// 筛选/排序后题库渲染成空白。
//
// 真正的冲突面是"对全局命名空间的写入"，共两条路径：
//   1. `global.X = ...` / `window.X = ...` / `Object.defineProperty(global|window, 'X', ...)`
//      —— 允许任意缩进，因为这类写入通常发生在 IIFE 内部。
//   2. 非 IIFE 包裹的"裸文件"（如 js/main.js）中缩进为 0 的顶层声明：
//      `function X` / `async function X` / `var|let|const X` / `class X`
//      —— 裸文件的顶层声明会直接落进 bundle 的顶层作用域，等价于全局写入。
//      IIFE 包裹的文件里这类声明是局部的，不算冲突（否则会漏掉上面那个真实 bug，
//      同时把大量私有函数误报成冲突）。
//
// 只做正则词法分析，不引入任何解析器依赖；先屏蔽注释/字符串/模板/正则字面量，
// 以规避把这些内容里的文本误判成代码。不追求 100% 精确。
// ============================================================================

/**
 * 存量符号冲突白名单 —— 历史技术债务，待逐项清理。
 *
 * - 白名单内的冲突：打印警告，不阻断构建。
 * - 白名单外的新增冲突：打印错误并以退出码 1 失败。
 *
 * 每行一项且互不影响：清理掉某处冲突后，把对应的那一行删掉即可。
 * 判定为"已知"要求实际冲突文件是这里所列文件的子集；若有新文件加入同名符号，
 * 说明冲突范围扩大了，会按新增冲突报错。
 */
const KNOWN_SYMBOL_CONFLICTS = {
    'js/bundles/browse.bundle.js': {
        __browseFilterMode: ['js/app/examActions.js', 'js/app/browseController.js', 'js/main.js'],
        __browsePath: ['js/app/examActions.js', 'js/app/browseController.js', 'js/main.js'],
        __browseFrequencyFilter: ['js/app/examActions.js', 'js/main.js'],
        __readingMemorizeBrowseMode: ['js/app/examActions.js', 'js/main.js'],
        __browseMemorizeFilterMode: ['js/app/examActions.js', 'js/main.js'],
        clearPendingBrowseAutoScroll: ['js/utils/BrowsePreferencesUtils.js', 'js/main.js'],
        pdfHandler: ['js/components/PDFHandler.js', 'js/main.js'],
        browseStateManager: ['js/components/BrowseStateManager.js', 'js/main.js']
    },
    'js/bundles/practice-page-enhancer.bundle.js': {
        spellingErrorCollector: ['js/app/spellingErrorCollector.js', 'js/practice-page-enhancer.js']
    }
};

// `/` 出现在这些关键字之后只能是正则字面量，不可能是除法。
const REGEX_ALLOWED_AFTER_KEYWORDS = new Set([
    'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete',
    'void', 'throw', 'case', 'do', 'else', 'yield', 'await'
]);

/**
 * 把注释、字符串、模板字面量文本和正则字面量的内容替换成空格（保留换行与长度），
 * 这样后续正则就不会把它们里面的文本误判成真实代码。
 */
function maskSource(source) {
    const out = source.split('');
    const length = source.length;
    const blank = (from, to) => {
        for (let index = from; index < to && index < length; index += 1) {
            if (out[index] !== '\n') out[index] = ' ';
        }
    };

    // 模板插值 `${...}` 内可能出现对象字面量的 `{}`，需要按大括号深度判断插值结束位置。
    const templateBraceDepth = [];
    const readTemplateChunk = (from) => {
        let index = from;
        while (index < length) {
            if (source[index] === '\\') { index += 2; continue; }
            if (source[index] === '`') return { end: index, interpolated: false };
            if (source[index] === '$' && source[index + 1] === '{') return { end: index, interpolated: true };
            index += 1;
        }
        return { end: length, interpolated: false };
    };

    let cursor = 0;
    let previousChar = '';
    let previousWord = '';
    const regexAllowedHere = () => {
        if (!previousChar) return true;
        if (/[\w$]/.test(previousChar)) return REGEX_ALLOWED_AFTER_KEYWORDS.has(previousWord);
        return previousChar !== ')' && previousChar !== ']';
    };

    while (cursor < length) {
        const char = source[cursor];
        const nextChar = source[cursor + 1];

        if (char === '/' && nextChar === '/') {
            let index = cursor;
            while (index < length && source[index] !== '\n') index += 1;
            blank(cursor, index);
            cursor = index;
            continue;
        }

        if (char === '/' && nextChar === '*') {
            let index = cursor + 2;
            while (index < length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
            index = Math.min(index + 2, length);
            blank(cursor, index);
            cursor = index;
            continue;
        }

        if (char === '"' || char === "'") {
            let index = cursor + 1;
            while (index < length) {
                if (source[index] === '\\') { index += 2; continue; }
                if (source[index] === char || source[index] === '\n') break;
                index += 1;
            }
            blank(cursor + 1, index);
            cursor = Math.min(index + 1, length);
            previousChar = char;
            previousWord = '';
            continue;
        }

        if (char === '`') {
            const chunk = readTemplateChunk(cursor + 1);
            blank(cursor + 1, chunk.end);
            if (chunk.interpolated) {
                templateBraceDepth.push(0);
                cursor = chunk.end + 2;
                previousChar = '{';
                previousWord = '';
                continue;
            }
            cursor = Math.min(chunk.end + 1, length);
            previousChar = '`';
            previousWord = '';
            continue;
        }

        if (templateBraceDepth.length && char === '{') {
            templateBraceDepth[templateBraceDepth.length - 1] += 1;
        } else if (templateBraceDepth.length && char === '}') {
            if (templateBraceDepth[templateBraceDepth.length - 1] > 0) {
                templateBraceDepth[templateBraceDepth.length - 1] -= 1;
            } else {
                // 插值结束，回到模板文本继续屏蔽。
                templateBraceDepth.pop();
                const chunk = readTemplateChunk(cursor + 1);
                blank(cursor + 1, chunk.end);
                if (chunk.interpolated) {
                    templateBraceDepth.push(0);
                    cursor = chunk.end + 2;
                    previousChar = '{';
                    previousWord = '';
                    continue;
                }
                cursor = Math.min(chunk.end + 1, length);
                previousChar = '`';
                previousWord = '';
                continue;
            }
        }

        if (char === '/' && regexAllowedHere()) {
            let index = cursor + 1;
            let inCharacterClass = false;
            let closed = false;
            while (index < length) {
                const current = source[index];
                if (current === '\\') { index += 2; continue; }
                if (current === '\n') break;
                if (current === '[') inCharacterClass = true;
                else if (current === ']') inCharacterClass = false;
                else if (current === '/' && !inCharacterClass) { closed = true; break; }
                index += 1;
            }
            if (closed) {
                blank(cursor + 1, index);
                cursor = index + 1;
                previousChar = '/';
                previousWord = '';
                continue;
            }
        }

        if (/[\w$]/.test(char)) {
            let index = cursor;
            while (index < length && /[\w$]/.test(source[index])) index += 1;
            previousWord = source.slice(cursor, index);
            previousChar = source[index - 1];
            cursor = index;
            continue;
        }

        if (!/\s/.test(char)) {
            previousChar = char;
            previousWord = '';
        }
        cursor += 1;
    }

    return out.join('');
}

// 路径 1：对 global/window 属性的直接赋值，允许任意缩进（多在 IIFE 内部）。
const GLOBAL_PROPERTY_WRITE = /(?:^|[^\w$.])(?:global|window)\s*\.\s*([A-Za-z_$][\w$]*)\s*=(?!=)/g;
// 路径 1 的补充形式：Object.defineProperty(global|window, 'X', ...) 同样是全局写入。
const GLOBAL_DEFINE_PROPERTY = /Object\s*\.\s*defineProperty\s*\(\s*(?:global|window)\s*,\s*['"]([A-Za-z_$][\w$]*)['"]/g;
// 路径 2：裸文件里缩进为 0 的顶层声明（行首即声明关键字）。
const TOP_LEVEL_DECLARATION = /^(?:async[ \t]+)?(?:function\b[ \t*]*|var[ \t]+|let[ \t]+|const[ \t]+|class[ \t]+)([A-Za-z_$][\w$]*)/;

/** 判断整个文件是否被 IIFE 包裹（首个有效 token 就进入 `(function` / `((` 形态）。 */
function isIifeWrapped(maskedSource) {
    const head = maskedSource.replace(/\s+/g, ' ').trim();
    return /^[!+~;]*\s*\(\s*(?:async\s+)?function\b/.test(head) || /^[!+~;]*\s*\(\s*\(/.test(head);
}

const globalSymbolCache = new Map();

/** 提取单个源文件写入的全局符号名集合（同一文件在多个 bundle 中复用，带缓存）。 */
function collectGlobalSymbols(relativePath) {
    if (globalSymbolCache.has(relativePath)) return globalSymbolCache.get(relativePath);

    const masked = maskSource(readSource(relativePath));
    const symbols = new Set();

    let match;
    GLOBAL_PROPERTY_WRITE.lastIndex = 0;
    while ((match = GLOBAL_PROPERTY_WRITE.exec(masked)) !== null) {
        symbols.add(match[1]);
        // 前缀里可能吃掉了下一处匹配的起始字符，回退一位避免漏检相邻写入。
        GLOBAL_PROPERTY_WRITE.lastIndex = match.index + match[0].length - 1;
    }

    GLOBAL_DEFINE_PROPERTY.lastIndex = 0;
    while ((match = GLOBAL_DEFINE_PROPERTY.exec(masked)) !== null) {
        symbols.add(match[1]);
    }

    if (!isIifeWrapped(masked)) {
        for (const line of masked.split('\n')) {
            const declaration = TOP_LEVEL_DECLARATION.exec(line);
            if (declaration) symbols.add(declaration[1]);
        }
    }

    globalSymbolCache.set(relativePath, symbols);
    return symbols;
}

/** 扫描所有 bundle，区分出"存量已知冲突"和"新增冲突"。 */
function findSymbolConflicts(bundleMap) {
    const known = [];
    const introduced = [];
    const staleWhitelistEntries = [];

    for (const [outputPath, inputs] of Object.entries(bundleMap)) {
        const writers = new Map();
        for (const inputPath of inputs) {
            for (const symbol of collectGlobalSymbols(inputPath)) {
                if (!writers.has(symbol)) writers.set(symbol, []);
                const owners = writers.get(symbol);
                if (!owners.includes(inputPath)) owners.push(inputPath);
            }
        }

        const whitelist = KNOWN_SYMBOL_CONFLICTS[outputPath] || {};
        const conflictingSymbols = new Set();

        for (const [symbol, owners] of writers) {
            if (owners.length < 2) continue;
            conflictingSymbols.add(symbol);
            const allowedOwners = whitelist[symbol];
            const isKnown = Array.isArray(allowedOwners)
                && owners.every((owner) => allowedOwners.includes(owner));
            (isKnown ? known : introduced).push({ outputPath, symbol, owners });
        }

        for (const symbol of Object.keys(whitelist)) {
            if (!conflictingSymbols.has(symbol)) staleWhitelistEntries.push({ outputPath, symbol });
        }
    }

    return { known, introduced, staleWhitelistEntries };
}

function formatConflict({ outputPath, symbol, owners }) {
    return [
        `符号冲突: ${outputPath}`,
        `  "${symbol}" 同时写入于:`,
        ...owners.map((owner) => `    - ${owner}`)
    ].join('\n');
}

/** 构建与 --check 模式下都会执行；出现新增冲突时直接失败。 */
function assertNoNewSymbolConflicts(bundleMap) {
    const { known, introduced, staleWhitelistEntries } = findSymbolConflicts(bundleMap);

    if (known.length) {
        console.warn(`存量符号冲突 ${known.length} 处（历史债务，暂不阻断构建）:`);
        for (const conflict of known) console.warn(formatConflict(conflict));
    }

    if (staleWhitelistEntries.length) {
        console.warn('以下白名单条目已不再冲突，可从 KNOWN_SYMBOL_CONFLICTS 中删除:');
        for (const entry of staleWhitelistEntries) console.warn(`  - ${entry.outputPath} :: ${entry.symbol}`);
    }

    if (introduced.length) {
        console.error(`检测到 ${introduced.length} 处新增符号冲突（不在白名单内）:`);
        for (const conflict of introduced) console.error(formatConflict(conflict));
        console.error('同一 bundle 内多个文件写入同名全局符号会静默互相覆盖，请改名或收敛到单一来源。');
        process.exit(1);
    }

    if (!known.length) console.log('符号冲突检查通过: 未发现同一 bundle 内的重复全局写入。');
}

function renderBundle(outputPath, inputs) {
    const sections = inputs.map((inputPath) => {
        const source = readSource(inputPath);
        return [
            `\n/* ===== ${inputPath} ===== */`,
            source
        ].join('\n');
    });

    const provided = JSON.stringify(inputs, null, 4);
    return [
        '/* Generated by scripts/build-bundles.mjs. Do not edit by hand. */',
        ...sections,
        '\n/* ===== bundle provided script markers ===== */',
        '(function markBundleProvided(global) {',
        '    if (global.AppLazyLoader && typeof global.AppLazyLoader.markProvided === "function") {',
        `        global.AppLazyLoader.markProvided(${provided});`,
        '    }',
        '})(typeof window !== "undefined" ? window : this);',
        ''
    ].join('\n');
}

assertNoNewSymbolConflicts(bundles);

const staleOutputs = [];
for (const [outputPath, inputs] of Object.entries(bundles)) {
    const absoluteOutput = path.join(root, outputPath);
    const expected = renderBundle(outputPath, inputs);
    if (checkOnly) {
        const actual = fs.existsSync(absoluteOutput) ? fs.readFileSync(absoluteOutput, 'utf8') : null;
        if (actual !== expected) staleOutputs.push(outputPath);
        continue;
    }
    fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true });
    fs.writeFileSync(absoluteOutput, expected, 'utf8');
    console.log(`${outputPath}: ${inputs.length} files`);
}

const expectedOutputs = new Set(Object.keys(bundles).map((outputPath) => outputPath.replace(/\\/g, '/')));
const bundleDirectory = path.join(root, 'js', 'bundles');
const orphanOutputs = fs.existsSync(bundleDirectory)
    ? fs.readdirSync(bundleDirectory)
        .filter((name) => name.endsWith('.bundle.js'))
        .map((name) => `js/bundles/${name}`)
        .filter((outputPath) => !expectedOutputs.has(outputPath))
        .sort()
    : [];

if (checkOnly) {
    if (staleOutputs.length || orphanOutputs.length) {
        if (staleOutputs.length) console.error(`Stale or missing bundles:\n${staleOutputs.map((item) => `  - ${item}`).join('\n')}`);
        if (orphanOutputs.length) console.error(`Orphan bundles:\n${orphanOutputs.map((item) => `  - ${item}`).join('\n')}`);
        process.exitCode = 1;
    } else {
        console.log(`Bundle check passed: ${expectedOutputs.size} outputs are current.`);
    }
} else if (orphanOutputs.length) {
    console.warn(`Orphan bundles are not part of the manifest:\n${orphanOutputs.map((item) => `  - ${item}`).join('\n')}`);
}
