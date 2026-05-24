import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

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
        'js/utils/storage.js',
        'js/core/storageProviderRegistry.js',
        'js/data/dataSources/storageDataSource.js',
        'js/data/repositories/baseRepository.js',
        'js/data/repositories/dataRepositoryRegistry.js',
        'js/data/repositories/practiceRepository.js',
        'js/data/repositories/settingsRepository.js',
        'js/data/repositories/backupRepository.js',
        'js/data/repositories/metaRepository.js',
        'js/data/index.js',
        'js/core/practiceCore.js',
        'js/core/practiceStore.js',
        'js/core/resourceCore.js',
        'assets/generated/reading-exams/manifest.js',
        'js/utils/stateSerializer.js',
        'js/utils/simpleStorageWrapper.js',
        'js/app/state-service.js',
        'js/services/libraryManager.js'
    ],
    'js/bundles/ui-shell.bundle.js': [
        'js/utils/dom.js',
        'js/services/overviewStats.js',
        'js/views/overviewView.js',
        'js/presentation/navigation-controller.js',
        'js/app/main-entry.js',
        'js/presentation/indexInteractions.js',
        'js/presentation/emojiIconizer.js'
    ],
    'js/bundles/legacy-app.bundle.js': [
        'js/boot-fallbacks.js',
        'js/patches/runtime-fixes.js',
        'js/app.js',
        'js/components/onboardingTour.js'
    ],
    'js/bundles/browse.bundle.js': [
        'js/views/legacyViewBundle.js',
        'js/app/examActions.js',
        'js/app/examSessionMixin.js',
        'js/app/browseController.js',
        'js/presentation/message-center.js',
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
        'js/utils/performance.js',
        'js/utils/typeChecker.js',
        'js/utils/codeStandards.js'
    ],
    'js/bundles/settings.bundle.js': [
        'js/components/DataIntegrityManager.js',
        'js/utils/dataBackupManager.js'
    ],
    'js/bundles/practice.bundle.js': [
        'js/app/spellingErrorCollector.js',
        'js/utils/markdownExporter.js',
        'js/components/practiceRecordModal.js',
        'js/components/practiceHistoryEnhancer.js',
        'js/core/scoreStorage.js',
        'js/utils/answerSanitizer.js',
        'js/core/practiceRecorder.js'
    ],
    'js/bundles/session.bundle.js': [
        'js/app/suitePracticeMixin.js'
    ],
    'js/bundles/reading-page.bundle.js': [
        'js/runtime/readingExamRegistry.js',
        'js/runtime/readingExplanationRegistry.js',
        'js/runtime/readingHighlightShared.js',
        'js/utils/answerMatchCore.js',
        'assets/wordlists/ielts_core.bundle.js',
        'assets/wordlists/ecdict_reading.bundle.js',
        'js/core/dictionaryService.js',
        'js/runtime/reviewHighlightDictionary.js',
        'js/runtime/unifiedReadingPage.js'
    ],
    'js/bundles/practice-page-enhancer.bundle.js': [
        'js/utils/suiteBackGuard.js',
        'js/utils/answerMatchCore.js',
        'js/app/spellingErrorCollector.js',
        'js/practice-page-enhancer.js'
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
    return fs.readFileSync(absolutePath, 'utf8').replace(/\s*$/, '\n');
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

for (const [outputPath, inputs] of Object.entries(bundles)) {
    const absoluteOutput = path.join(root, outputPath);
    fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true });
    fs.writeFileSync(absoluteOutput, renderBundle(outputPath, inputs), 'utf8');
    console.log(`${outputPath}: ${inputs.length} files`);
}
