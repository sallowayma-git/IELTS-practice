import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function readSource(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('frontend console logs do not expose practice session identifiers or payloads', () => {
    const sources = [
        'js/app/examSessionMixin.js',
        'js/app/examActions.js',
        'js/app/browseController.js',
        'js/app/main-entry.js',
        'js/app/spellingErrorCollector.js',
        'js/app/state-service.js',
        'js/app/suitePracticeMixin.js',
        'js/app/vocabListSwitcher.js',
        'js/app.js',
        'js/boot-fallbacks.js',
        'js/components/dataManagementPanel.js',
        'js/components/BrowseStateManager.js',
        'js/components/DataIntegrityManager.js',
        'js/components/PerformanceOptimizer.js',
        'js/components/SystemDiagnostics.js',
        'js/components/PDFHandler.js',
        'js/components/onboardingTour.js',
        'js/components/practiceHistoryEnhancer.js',
        'js/components/practiceRecordModal.js',
        'js/components/vocabSessionView.js',
        'js/core/goalManager.js',
        'js/core/practiceCore.js',
        'js/core/practiceRecorder.js',
        'js/core/resourceCore.js',
        'js/core/scoreStorage.js',
        'js/core/storageProviderRegistry.js',
        'js/core/vocabStore.js',
        'js/data/dataSources/remotePracticeDataSource.js',
        'js/data/dataSources/storageDataSource.js',
        'js/data/index.js',
        'js/main.js',
        'js/patches/runtime-fixes.js',
        'js/plugins/hp/hp-core-bridge.js',
        'js/plugins/hp/hp-portal.js',
        'js/plugins/themes/academic/academic-adapter.js',
        'js/plugins/themes/melody/melody-adapter.js',
        'js/plugins/themes/theme-adapter-base.js',
        'js/presentation/app-actions.js',
        'js/presentation/indexInteractions.js',
        'js/presentation/miniGames.js',
        'js/presentation/navigation-controller.js',
        'js/presentation/threeBackground.js',
        'js/practice-page-enhancer.js',
        'js/runtime/lazyLoader.js',
        'js/runtime/reviewHighlightDictionary.js',
        'js/runtime/unifiedReadingPage.js',
        'js/services/achievementManager.js',
        'js/services/libraryDiscovery.js',
        'js/services/libraryManager.js',
        'js/theme-switcher.js',
        'js/utils/BrowsePreferencesUtils.js',
        'js/utils/answerComparisonUtils.js',
        'js/utils/dataBackupManager.js',
        'js/utils/dataConsistencyManager.js',
        'js/utils/dom.js',
        'js/utils/environmentDetector.js',
        'js/utils/markdownExporter.js',
        'js/utils/stateSerializer.js',
        'js/utils/storage.js',
        'js/utils/vocabDataIO.js',
        'js/views/legacyViewBundle.js'
    ];

    for (const sourcePath of sources) {
        const source = readSource(sourcePath);
        const consoleLines = source
            .split(/\r?\n/)
            .filter((line) => /console\.(?:log|warn|error|info)\(/.test(line));

        for (const line of consoleLines) {
            const consoleStart = line.search(/console\.(?:log|warn|error|info)\(/);
            const consoleExpression = consoleStart >= 0 ? line.slice(consoleStart) : line;
            const lineWithoutStringLiterals = consoleExpression.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""');
            const lineWithoutAllowedSummaries = lineWithoutStringLiterals
                .replace(/summarize[A-Za-z0-9_]*ForLog\([^)]*\)/g, 'summary');
            assert(
                !/\$\{\s*(?:examId|record\.id|savedRecord\.id|standardizedRecord\.id|suiteData\.suiteId|sessionId|payload|realData|tempRecord|sanitized|vocabList\.id|list\.id|achievement\.id|match\.id|exam\.id|listId|questionId|detected\.userInput|detected\.word|error\.word|word|normalizedQuery|activeKey|misses|pdfPath|safePdfPath|examTitle|cleanKey|finalFilename|key)\s*\}/.test(line),
                `${sourcePath} must not interpolate practice identifiers or payloads into console logs`
            );
            assert(
                !/\b[A-Za-z_$][\w$]*\s*&&\s*[A-Za-z_$][\w$]*\.id\b/.test(lineWithoutAllowedSummaries),
                `${sourcePath} must not pass conditional record identifiers to console logs`
            );
            assert(
                !/\b(?:payload|realData|sessionId|matched\.sid|resolvedExamId|suiteSessionId|savedRecord\.id|standardizedRecord\.id|record\.id|tempRecord\.id|cleanRecord\?\.id|suiteData\.suiteId|examId|errorData|exam\.id|match\.id|backup\.id|vocabList\.id|list\.id|container\.id|container\.className|rawUrl|targetUrl|safeUrl|trustedPath|this\.currentListId|this\.indexedDB\.name|this\.prefix|listId|questionId|detected\.userInput|detected\.word|error\.word|word|normalizedQuery|activeKey|misses|pdfPath|safePdfPath|examTitle|cleanKey|finalFilename)\b/.test(lineWithoutAllowedSummaries),
                `${sourcePath} must not pass practice identifiers or payloads to console logs`
            );
            assert(
                !/window\.practicePageEnhancer\.(?:answers|correctAnswers|interactions)|generateAnswerComparison\(\)/.test(lineWithoutStringLiterals),
                `${sourcePath} must not log raw practice enhancer answer or interaction state`
            );
        }
    }

    const systemDiagnostics = readSource('js/components/SystemDiagnostics.js');
    assert(
        !/console\.(?:log|warn|error|info)\([^;\n]*(?:exam\.title|field)\b/.test(systemDiagnostics),
        'system diagnostics must not log raw exam titles or field names'
    );

    const themeAdapter = readSource('js/plugins/themes/theme-adapter-base.js');
    assert(
        !themeAdapter.includes("console.log('[ThemeAdapterBase] 收到练习完成消息:', normalizedType, payload)"),
        'theme adapter must not log full practice completion payloads'
    );
    assert(
        !/console\.log\(`\[ThemeAdapterBase\][^`]*\$\{\s*message\s*\}/.test(themeAdapter),
        'theme adapter must not log raw UI message text'
    );
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*error\s*\)/.test(themeAdapter),
        'theme adapter must summarize errors before logging them'
    );

    const appSource = readSource('js/app.js');
    assert(
        !/console\.error\(`\[App\][^`]*\$\{\s*path\s*\}/.test(appSource),
        'app state logging must not expose state paths'
    );
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e|event\.reason|event\.error)\s*\)/.test(appSource),
        'app bootstrap must summarize raw errors and global event errors before logging them'
    );

    const bootFallbacks = readSource('js/boot-fallbacks.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e)\s*\)/.test(bootFallbacks),
        'boot fallbacks must summarize raw errors before logging them'
    );
    assert(
        !/(?:showMessage\([^;\n]*|message:\s*)(?:error && error\.message|error\.message|exportErr && exportErr\.message|exportErr\.message)/.test(bootFallbacks),
        'boot fallbacks must not expose raw exception messages to users or reports'
    );

    const mainEntry = readSource('js/app/main-entry.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e)\s*\)/.test(mainEntry),
        'main entry must summarize raw errors before logging them'
    );

    const examActions = readSource('js/app/examActions.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e)\s*\)/.test(examActions),
        'exam actions must summarize raw errors before logging them'
    );
    assert(
        !/showMessage\([^;\n]*(?:error\.message|e\.message)/.test(examActions),
        'exam actions must not expose raw exception messages to users'
    );

    const browseController = readSource('js/app/browseController.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e)\s*\)/.test(browseController),
        'browse controller must summarize raw errors before logging them'
    );

    const practiceRecordModal = readSource('js/components/practiceRecordModal.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err)\s*\)/.test(practiceRecordModal),
        'practice record modal must summarize raw errors before logging them'
    );
    assert(
        !/showMessage\([^;\n]*(?:error\.message|err\.message)/.test(practiceRecordModal),
        'practice record modal must not expose raw exception messages to users'
    );

    const practiceHistoryEnhancer = readSource('js/components/practiceHistoryEnhancer.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err)\s*\)/.test(practiceHistoryEnhancer),
        'practice history enhancer must summarize raw errors before logging them'
    );
    assert(
        !/showMessage\([^;\n]*(?:error\.message|err\.message)/.test(practiceHistoryEnhancer),
        'practice history enhancer must not expose raw exception messages to users'
    );
    assert(
        !/alert\([^;\n]*error\.message/.test(practiceHistoryEnhancer),
        'practice history enhancer must not alert raw exception messages'
    );

    const vocabStore = readSource('js/core/vocabStore.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e)\s*\)/.test(vocabStore),
        'vocab store must summarize raw errors before logging them'
    );

    const vocabSessionView = readSource('js/components/vocabSessionView.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e)\s*\)/.test(vocabSessionView),
        'vocab session view must summarize raw errors before logging them'
    );
    assert(
        !/(?:showFeedbackMessage|textContent|innerHTML)[^;\n]*(?:error\.message|err\.message|e\.message)/.test(vocabSessionView),
        'vocab session view must not expose raw exception messages to users'
    );

    const spellingErrorCollector = readSource('js/app/spellingErrorCollector.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e)\s*\)/.test(spellingErrorCollector),
        'spelling error collector must summarize raw errors before logging them'
    );
    assert(
        !/console\.(?:error|warn)\([^;\n]*(?:fetchError\.message|xhrError\.message|error\.message)/.test(spellingErrorCollector),
        'spelling error collector must not log raw exception messages'
    );

    const hpPortal = readSource('js/plugins/hp/hp-portal.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e)\s*\)/.test(hpPortal),
        'HP portal must summarize raw errors before logging them'
    );
    assert(
        !/showMessage\([^;\n]*(?:error\.message|err\.message|e\.message)/.test(hpPortal),
        'HP portal must not expose raw exception messages to users'
    );

    const academicAdapter = readSource('js/plugins/themes/academic/academic-adapter.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e)\s*\)/.test(academicAdapter),
        'academic adapter must summarize raw errors before logging them'
    );

    const melodyAdapter = readSource('js/plugins/themes/melody/melody-adapter.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e)\s*\)/.test(melodyAdapter),
        'melody adapter must summarize raw errors before logging them'
    );

    const stateSerializer = readSource('js/utils/stateSerializer.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e)\s*\)/.test(stateSerializer),
        'state serializer must summarize raw errors before logging them'
    );

    const unifiedReadingPage = readSource('js/runtime/unifiedReadingPage.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*error\s*\)/.test(unifiedReadingPage),
        'unified reading page must summarize raw errors before logging them'
    );
    assert(
        !/(?:innerHTML\s*=|escapeHtml\()([^;\n]*error\.message)/.test(unifiedReadingPage),
        'unified reading page must not render raw exception messages'
    );

    const examSessionMixin = readSource('js/app/examSessionMixin.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e|sessionError|recorderError|monitorError|loadError|restoreError)\s*\)/.test(examSessionMixin),
        'exam session mixin must summarize errors before logging them'
    );
    assert(
        !/catch\(console\.warn\)/.test(examSessionMixin),
        'exam session mixin must not pass raw errors directly to console.warn'
    );
    assert(
        !/Practice session error:',\s*error\b/.test(examSessionMixin),
        'exam session mixin must not log raw practice session errors'
    );

    const suitePracticeMixin = readSource('js/app/suitePracticeMixin.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e|sessionError|recorderError)\s*\)/.test(suitePracticeMixin),
        'suite practice mixin must summarize errors before logging them'
    );

    const mainSource = readSource('js/main.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e|syncError)\s*\)/.test(mainSource),
        'main app flow must summarize errors before logging them'
    );
    assert(
        !/showMessage\([^;\n]*(?:error && error\.message|error\.message|err\.message|e\.message)/.test(mainSource),
        'main app flow must not expose raw exception messages to users'
    );
    assert(
        !/console\.(?:log|warn|error|info)\([^;\n]*(?:\$\{\s*trigger\s*\}|,\s*trigger\b)/.test(mainSource),
        'main app flow must not log practice sync triggers'
    );

    const appActions = readSource('js/presentation/app-actions.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e)\s*\)/.test(appActions),
        'app actions must summarize raw errors before logging them'
    );

    const indexInteractions = readSource('js/presentation/indexInteractions.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e)\s*\)/.test(indexInteractions),
        'index interactions must summarize raw errors before logging them'
    );

    const miniGames = readSource('js/presentation/miniGames.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e)\s*\)/.test(miniGames),
        'mini games must summarize raw errors before logging them'
    );

    const navigationController = readSource('js/presentation/navigation-controller.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e)\s*\)/.test(navigationController),
        'navigation controller must summarize raw errors before logging them'
    );

    const threeBackground = readSource('js/presentation/threeBackground.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e)\s*\)/.test(threeBackground),
        'three background must summarize raw errors before logging them'
    );

    const themeSwitcher = readSource('js/theme-switcher.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e)\s*\)/.test(themeSwitcher),
        'theme switcher must summarize raw errors before logging them'
    );

    const dataIntegrity = readSource('js/components/DataIntegrityManager.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|reportError|fallbackError|recordsError|settingsError|vocabError)\s*\)/.test(dataIntegrity),
        'data integrity manager must summarize errors before logging them'
    );
    assert(
        !/console\.log\([^;\n]*this\.consistencyReport/.test(dataIntegrity),
        'data integrity manager must not log full consistency reports'
    );
    assert(
        !/console\.log\(`\[DataIntegrityManager\][^`]*\$\{\s*(?:id|backupId|type)\s*\}/.test(dataIntegrity),
        'data integrity manager must not log backup identifiers'
    );

    const dataManagementPanel = readSource('js/components/dataManagementPanel.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*error\s*\)/.test(dataManagementPanel),
        'data management panel must summarize errors before logging them'
    );
    assert(
        !/showMessage\([^;\n]*(?:error\.message|err\.message|e\.message)/.test(dataManagementPanel),
        'data management panel must not expose raw exception messages to users'
    );

    const performanceOptimizer = readSource('js/components/PerformanceOptimizer.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e)\s*\)/.test(performanceOptimizer),
        'performance optimizer must summarize raw errors before logging them'
    );

    const pdfHandler = readSource('js/components/PDFHandler.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e)\s*\)/.test(pdfHandler),
        'PDF handler must summarize raw errors before logging them'
    );

    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e)\s*\)/.test(systemDiagnostics),
        'system diagnostics must summarize raw errors before logging them'
    );
    assert(
        !/(?:error:\s*error\.message|message:\s*`[^`]*error\.message)/.test(systemDiagnostics),
        'system diagnostics must not place raw exception messages into diagnostic reports'
    );

    const browseStateManager = readSource('js/components/BrowseStateManager.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e)\s*\)/.test(browseStateManager),
        'browse state manager must summarize raw errors before logging them'
    );

    const onboardingTour = readSource('js/components/onboardingTour.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e)\s*\)/.test(onboardingTour),
        'onboarding tour must summarize raw errors before logging them'
    );

    const scoreStorage = readSource('js/core/scoreStorage.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|restoreError|e)\s*\)/.test(scoreStorage),
        'score storage must summarize errors before logging them'
    );

    const storageSource = readSource('js/utils/storage.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e|parseError|migrateError|importError|localStorageError|migrationError|restoreError)\s*\)/.test(storageSource),
        'storage manager must summarize errors before logging them'
    );
    assert(
        !/console\.(?:log|warn|error|info)\([^;\n]*(?:\$\{\s*(?:oldKey|newKey|key|cleanKey|storageKey|path|filename|namespace)\s*\}|\+\s*(?:oldKey|newKey|key|cleanKey|storageKey|path|filename|namespace)\b)/.test(storageSource),
        'storage manager must not log dynamic storage keys or paths'
    );

    const environmentDetector = readSource('js/utils/environmentDetector.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e)\s*\)/.test(environmentDetector),
        'environment detector must summarize raw errors before logging them'
    );

    const browsePreferences = readSource('js/utils/BrowsePreferencesUtils.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e)\s*\)/.test(browsePreferences),
        'browse preferences must summarize raw errors before logging them'
    );

    const vocabDataIo = readSource('js/utils/vocabDataIO.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e)\s*\)/.test(vocabDataIo),
        'vocab data IO must summarize raw errors before logging them'
    );

    const dataBackupManager = readSource('js/utils/dataBackupManager.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|restoreError)\s*\)/.test(dataBackupManager),
        'data backup manager must summarize errors before logging them'
    );
    assert(
        !/throw new Error\([^;\n]*error\.message/.test(dataBackupManager),
        'data backup manager must not wrap raw exception messages into thrown errors'
    );

    const markdownExporter = readSource('js/utils/markdownExporter.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|key|qNum)\s*\)/.test(markdownExporter),
        'markdown exporter must summarize errors and avoid logging answer keys or question labels'
    );

    const appStateService = readSource('js/app/state-service.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:topic|key|error)\s*\)/.test(appStateService),
        'app state service must not log topics, property keys, or raw errors'
    );

    const runtimeFixes = readSource('js/patches/runtime-fixes.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e)\s*\)/.test(runtimeFixes),
        'runtime fixes must summarize raw errors before logging them'
    );

    const practiceCore = readSource('js/core/practiceCore.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e)\s*\)/.test(practiceCore),
        'practice core must summarize raw errors before logging them'
    );

    const storageProviderRegistry = readSource('js/core/storageProviderRegistry.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e)\s*\)/.test(storageProviderRegistry),
        'storage provider registry must summarize raw errors before logging them'
    );

    const goalManager = readSource('js/core/goalManager.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e)\s*\)/.test(goalManager),
        'goal manager must summarize raw errors before logging them'
    );

    const libraryDiscovery = readSource('js/services/libraryDiscovery.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e)\s*\)/.test(libraryDiscovery),
        'library discovery must summarize raw errors before logging them'
    );

    const achievementManager = readSource('js/services/achievementManager.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e)\s*\)/.test(achievementManager),
        'achievement manager must summarize raw errors before logging them'
    );
    assert(
        !/console\.(?:error|warn)\(`\[AchievementManager\][^`]*\$\{\s*achievement\.id\s*\}/.test(achievementManager),
        'achievement manager must not log achievement identifiers from failed checks'
    );

    const libraryManager = readSource('js/services/libraryManager.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:key|configKey|error|loadError)\s*\)/.test(libraryManager),
        'library manager must not log config keys or raw errors'
    );
    assert(
        !/showMessage\([^;\n]*(?:error && error\.message|error\.message)/.test(libraryManager),
        'library manager must not expose raw exception messages to users'
    );

    const remotePracticeDataSource = readSource('js/data/dataSources/remotePracticeDataSource.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*error\s*\)/.test(remotePracticeDataSource),
        'remote practice data source must summarize errors before logging them'
    );
    assert(
        !/console\.(?:error|warn)\(`\[RemotePracticeDataSource\][^`]*\$\{\s*label\s*\}/.test(remotePracticeDataSource),
        'remote practice data source must not log transaction labels'
    );

    const storageDataSource = readSource('js/data/dataSources/storageDataSource.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*error\s*\)/.test(storageDataSource),
        'storage data source must summarize errors before logging them'
    );
    assert(
        !/console\.(?:error|warn)\(`\[StorageDataSource\][^`]*\$\{\s*label\s*\}/.test(storageDataSource),
        'storage data source must not log transaction labels'
    );

    const dataIndex = readSource('js/data/index.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*error\s*\)/.test(dataIndex),
        'data index bootstrap must summarize errors before logging them'
    );

    const resourceCore = readSource('js/core/resourceCore.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:entry|error)\s*\)/.test(resourceCore),
        'resource core must not log raw resource entries or errors'
    );

    const lazyLoader = readSource('js/runtime/lazyLoader.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*(?:label|groupName|error && error\.message|,\s*error\s*\))/.test(lazyLoader),
        'lazy loader must not log script labels, group names, or raw errors'
    );

    const reviewHighlightDictionary = readSource('js/runtime/reviewHighlightDictionary.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e)\s*\)/.test(reviewHighlightDictionary),
        'review highlight dictionary must summarize raw errors before logging them'
    );

    const hpBridge = readSource('js/plugins/hp/hp-core-bridge.js');
    assert(
        !hpBridge.includes("console.log('[hpCore] 发送 INIT_SESSION 到练习页', payload)")
        && !hpBridge.includes("console.log('[hpCore] 启动本地握手', payload)"),
        'HP bridge must not log local handshake payloads'
    );
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|e|setError|callbackError)\s*\)/.test(hpBridge),
        'HP bridge must summarize raw errors before logging them'
    );
    assert(
        !/console\.error\('\[hpCore emit error\]',\s*event\b/.test(hpBridge),
        'HP bridge must not log event names from emitted callbacks'
    );
    assert(
        !/console\.warn\('\[hpCore\][^']*',\s*(?:entry|\{\s*exam,)/.test(hpBridge),
        'HP bridge must not log raw resource probe entries or exam objects'
    );
    const practiceRecorder = readSource('js/core/practiceRecorder.js');
    assert(
        !practiceRecorder.includes("console.log('[PracticeRecorder] 处理真实练习数据:', examId, realData)"),
        'practice recorder must not log full real practice data'
    );
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*error\s*\)/.test(practiceRecorder),
        'practice recorder must summarize errors before logging them'
    );
    assert(
        !/throw new Error\([^;\n]*error\.message/.test(practiceRecorder),
        'practice recorder must not wrap raw exception messages into thrown errors'
    );

    const practiceEnhancer = readSource('js/practice-page-enhancer.js');
    assert(
        !practiceEnhancer.includes("console.log('交互记录:', window.practicePageEnhancer.interactions)"),
        'practice enhancer debug output must summarize interactions instead of logging them'
    );
    assert(
        !practiceEnhancer.includes('keys: keys.slice')
        && !practiceEnhancer.includes('questionIds:'),
        'practice enhancer debug summaries must not expose question identifiers'
    );
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|hookError|mixinError|eventError)\s*\)/.test(practiceEnhancer),
        'practice enhancer must summarize errors before logging them'
    );
    assert(
        !/console\.(?:log|warn|error|info)\([^;\n]*(?:\$\{\s*(?:suiteId|hookName|strategy\.name|mixin\.name|event|message)\s*\}|,\s*(?:suiteId|hookName|strategy\.name|mixin|mixinError|eventError|message)\b)/.test(practiceEnhancer),
        'practice enhancer must not log suite ids, hook names, strategy names, or raw messages'
    );

    const legacyViewBundle = readSource('js/views/legacyViewBundle.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|err|e)\s*\)/.test(legacyViewBundle),
        'legacy view bundle must summarize raw errors before logging them'
    );
});
