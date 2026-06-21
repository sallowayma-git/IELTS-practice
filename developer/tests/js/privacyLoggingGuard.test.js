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
        'js/app/spellingErrorCollector.js',
        'js/app/state-service.js',
        'js/app/suitePracticeMixin.js',
        'js/app/vocabListSwitcher.js',
        'js/app.js',
        'js/boot-fallbacks.js',
        'js/components/dataManagementPanel.js',
        'js/components/DataIntegrityManager.js',
        'js/components/PerformanceOptimizer.js',
        'js/components/SystemDiagnostics.js',
        'js/components/PDFHandler.js',
        'js/components/vocabSessionView.js',
        'js/core/practiceRecorder.js',
        'js/core/resourceCore.js',
        'js/core/scoreStorage.js',
        'js/core/vocabStore.js',
        'js/data/dataSources/remotePracticeDataSource.js',
        'js/data/dataSources/storageDataSource.js',
        'js/data/index.js',
        'js/main.js',
        'js/patches/runtime-fixes.js',
        'js/plugins/hp/hp-core-bridge.js',
        'js/plugins/themes/theme-adapter-base.js',
        'js/practice-page-enhancer.js',
        'js/runtime/lazyLoader.js',
        'js/services/libraryManager.js',
        'js/utils/answerComparisonUtils.js',
        'js/utils/dataBackupManager.js',
        'js/utils/dataConsistencyManager.js',
        'js/utils/dom.js',
        'js/utils/markdownExporter.js',
        'js/utils/stateSerializer.js',
        'js/utils/storage.js',
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
        !/console\.(?:log|warn|error|info)\([^;\n]*(?:\$\{\s*trigger\s*\}|,\s*trigger\b)/.test(mainSource),
        'main app flow must not log practice sync triggers'
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

    const dataBackupManager = readSource('js/utils/dataBackupManager.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:error|restoreError)\s*\)/.test(dataBackupManager),
        'data backup manager must summarize errors before logging them'
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

    const libraryManager = readSource('js/services/libraryManager.js');
    assert(
        !/console\.(?:error|warn)\([^;\n]*,\s*(?:key|configKey|error|loadError)\s*\)/.test(libraryManager),
        'library manager must not log config keys or raw errors'
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
});
