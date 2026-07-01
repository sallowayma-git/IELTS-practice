#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsRoot = path.join(repoRoot, 'js');

const DIRECT_WRITE_ALLOWLIST = new Set([
    path.join('js', 'utils', 'storage.js')
]);

const PROTOCOL_ALIAS_ALLOWLIST = new Set([
    path.join('js', 'core', 'practiceCore.js')
]);

const PATH_CORE_ALLOWLIST = new Set([
    path.join('js', 'core', 'resourceCore.js')
]);

const STATE_CORE_ALLOWLIST = new Set([
    path.join('js', 'app', 'state-service.js')
]);

const directWritePatterns = [
    /(?:^|[^\w.])storage\.set\s*\(\s*['"]practice_records['"]/g,
    /(?:^|[^\w.])window\.storage\.set\s*\(\s*['"]practice_records['"]/g,
    /(?:^|[^\w.])store\.set\s*\(\s*['"]practice_records['"]/g,
    /(?:^|[^\w.])storage\.remove\s*\(\s*['"]practice_records['"]/g,
    /(?:^|[^\w.])window\.storage\.remove\s*\(\s*['"]practice_records['"]/g,
    /(?:^|[^\w.])store\.remove\s*\(\s*['"]practice_records['"]/g,
    /(?:^|[^\w.])this\.set\s*\(\s*['"]practice_records['"]/g,
    /['"]practice\.records['"]\s*:\s*['"]practice_records['"]/g
];

const practiceRecordsShadowPatterns = [
    /(?:window|global|globalThis|globalRef)\.practiceRecords\s*=/g,
    /practiceRecords\s*:\s*cloneArray\s*\(\s*(?:window|global|globalThis|globalRef)\.practiceRecords\s*\)/g
];

const protocolAliasPatterns = [
    /practice_complete'\s*:\s*'PRACTICE_COMPLETE'/g,
    /practice_completed'\s*:\s*'PRACTICE_COMPLETE'/g,
    /REQUEST_SESSION_INIT/g,
    /PRACTICE_COMPLETE_TYPES/g
];

const pathDefinitionPatterns = [
    /(?:^|\n)\s*function\s+buildResourcePath\s*\(/g,
    /(?:^|\n)\s*function\s+derivePathMapFromIndex\s*\(/g,
    /(?:^|\n)\s*function\s+getResourceAttempts\s*\(/g,
    /(?:^|\n)\s*function\s+resolveResource\s*\(/g,
    /(?:^|\n)\s*(?:async\s+)?buildResourcePath\s*\(/g,
    /(?:^|\n)\s*(?:async\s+)?derivePathMapFromIndex\s*\(/g,
    /(?:^|\n)\s*(?:async\s+)?getResourceAttempts\s*\(/g,
    /(?:^|\n)\s*(?:async\s+)?resolveResource\s*\(/g,
    /(?:const|let|var)\s+buildResourcePath\s*=/g,
    /(?:const|let|var)\s+derivePathMapFromIndex\s*=/g,
    /(?:const|let|var)\s+getResourceAttempts\s*=/g,
    /(?:const|let|var)\s+resolveResource\s*=/g
];

const stateDefinitionPatterns = [
    /function\s+getExamIndexState\s*\(/g,
    /function\s+setExamIndexState\s*\(/g,
    /function\s+getPracticeRecordsState\s*\(/g,
    /function\s+setPracticeRecordsState\s*\(/g,
    /function\s+getFilteredExamsState\s*\(/g,
    /function\s+setFilteredExamsState\s*\(/g,
    /function\s+setBrowseFilterState\s*\(/g,
    /function\s+getSelectedRecordsState\s*\(/g,
    /function\s+assignExamSequenceNumbers\s*\(/g,
    /Object\.defineProperty\(\s*window\s*,\s*['"]fallbackExamSessions['"]/g,
    /Object\.defineProperty\(\s*window\s*,\s*['"]processedSessions['"]/g
];

const legacyMarkers = [
    /LegacyStateBridge/g,
    /LegacyStateAdapter/g,
    /LegacyStateAdapterBridge/g,
    /LegacyStorageFacade/g,
    /legacy-storage/g,
    /deprecated persistent write via storage facade/g
];

const bannedRecordFallbackChecks = [
    {
        file: path.join('js', 'core', 'practiceRecordAPI.js'),
        patterns: [
            /getScoreStorageInstance/g,
            /scoreStorage/g,
            /recalculateUserStats/g,
            /getDefaultUserStats/g,
            /getUserStats/g,
            /global\.dataRepositories/g,
            /readPersistentValue/g,
            /writePersistentValue/g,
            /createStorageInternalAccessOptions/g
        ]
    },
    {
        file: path.join('js', 'core', 'scoreStorage.js'),
        patterns: [
            /this\.storage\.get\s*\(\s*this\.storageKeys\.practiceRecords/g,
            /this\.storage\.set\s*\(\s*this\.storageKeys\.practiceRecords/g,
            /this\.storage\.get\s*\(\s*this\.storageKeys\.userStats/g,
            /this\.storage\.set\s*\(\s*this\.storageKeys\.userStats/g,
            /(?:const|let|var)\s+practiceRepo\s*=/g,
            /practiceRepo\.(?:list|overwrite|clear)\s*\(/g,
            /metaRepo\.(?:get|set|remove)\s*\(\s*['"]user_stats['"]/g,
            /compatSchema(?:Read|Write)/g,
            /window\.PracticeStore\.(?:list|replace|save)/g,
            /window\.simpleStorageWrapper\.(?:savePracticeRecords|addPracticeRecord|getPracticeRecords)/g,
            /PracticeCore\.store\.(?:listPracticeRecords|replacePracticeRecords|savePracticeRecord)/g,
            /practiceCoreStore\.(?:listPracticeRecords|replacePracticeRecords|savePracticeRecord)/g,
            /继续使用底层兼容/g,
            /继续使用底层/g
        ]
    },
    {
        file: path.join('js', 'core', 'practiceStore.js'),
        patterns: [
            /PRACTICE_RECORDS_KEY/g,
            /getCoreStore/g,
            /getLegacyWrapper/g,
            /getStorage/g,
            /PracticeCore\.store/g,
            /simpleStorageWrapper/g,
            /storage\.(?:get|set)\s*\(/g
        ]
    },
    {
        file: path.join('js', 'core', 'practiceRecorder.js'),
        patterns: [
            /fallbackSavePracticeRecord/g,
            /standardizeRecordForFallback/g,
            /savedBy\s*:\s*['"]fallback['"]/g,
            /fallbackReason/g,
            /suiteFallback/g,
            /scoreStorage\.savePracticeRecord/g,
            /scoreStorage\.getPracticeRecords/g,
            /window\.PracticeStore\.(?:list|replace|save)/g,
            /window\.simpleStorageWrapper\.(?:savePracticeRecords|addPracticeRecord|getPracticeRecords)/g,
            /PracticeCore\.store\.(?:listPracticeRecords|replacePracticeRecords|savePracticeRecord)/g,
            /practiceCoreStore\.(?:listPracticeRecords|replacePracticeRecords|savePracticeRecord)/g,
            /practiceRepo\.list\s*\(/g,
            /继续使用底层兼容/g,
            /继续使用底层/g
        ]
    },
    {
        file: path.join('js', 'utils', 'simpleStorageWrapper.js'),
        patterns: [
            /practiceRepo/g,
            /repos\.practice/g,
            /api\.(?:replace|saveRecord|deleteById|deleteMany|clear|writeStats|resetStats)\s*\(/g,
            /PracticeCore\.store\.(?:listPracticeRecords|replacePracticeRecords|savePracticeRecord)/g,
            /practiceCoreStore\.(?:listPracticeRecords|replacePracticeRecords|savePracticeRecord)/g
        ]
    },
    {
        file: path.join('js', 'utils', 'storage.js'),
        patterns: [
            /window\.PracticeStore\.(?:list|replace|save)/g,
            /window\.simpleStorageWrapper\.(?:savePracticeRecords|addPracticeRecord|getPracticeRecords)/g,
            /PracticeCore\.store\.(?:listPracticeRecords|replacePracticeRecords|savePracticeRecord)/g,
            /practiceCoreStore\.(?:listPracticeRecords|replacePracticeRecords|savePracticeRecord)/g,
            /继续使用底层兼容/g,
            /继续使用底层/g
        ]
    },
    {
        file: path.join('js', 'main.js'),
        patterns: [
            /savePracticeRecordFallback/g,
            /\[Fallback\]\s*收到练习完成/g,
            /\[Fallback\]\s*真实数据/g,
            /\[Fallback\]\s*保存练习记录失败/g,
            /PracticeRecordAPI 保存失败，继续/g,
            /window\.PracticeStore\.(?:list|replace|save|clear)/g,
            /window\.simpleStorageWrapper\.(?:savePracticeRecords|addPracticeRecord|getPracticeRecords)/g,
            /PracticeCore\.store\.(?:listPracticeRecords|replacePracticeRecords|savePracticeRecord)/g,
            /practiceCoreStore\.(?:listPracticeRecords|replacePracticeRecords|savePracticeRecord)/g,
            /storage\.get\s*\(\s*\[['"]practice['"]\s*,\s*['"]records['"]\]\.join/g,
            /storage\.set\s*\(\s*\[['"]practice['"]\s*,\s*['"]records['"]\]\.join/g
        ]
    },
    {
        file: path.join('js', 'app', 'suitePracticeMixin.js'),
        patterns: [
            /_listPracticeRecordsWithFallback/g,
            /_replacePracticeRecordsWithFallback/g,
            /_saveSinglePracticeRecordWithFallback/g,
            /_saveSuitePracticeRecordFallback/g,
            /includeRecorder/g
        ]
    },
    {
        file: path.join('js', 'app', 'examSessionMixin.js'),
        patterns: [
            /suiteFallback/g
        ]
    },
    {
        file: path.join('js', 'components', 'onboardingTour.js'),
        patterns: [
            /dataRepositories\.practice/g,
            /repositories\.practice/g,
            /repos\.practice/g
        ]
    }
];

const bannedStatsBypassChecks = [
    {
        file: path.join('js', 'app.js'),
        patterns: [
            /(?:^|[^\w.])storage\.get\s*\(\s*['"]user_stats['"]/g,
            /(?:^|[^\w.])storage\.set\s*\(\s*['"]user_stats['"]/g,
            /window\.storage\.(?:get|set)\s*\(\s*['"]user_stats['"]/g,
            /PracticeCore\.store\.writeMeta\s*\(\s*['"]user_stats['"]/g,
            /scoreStorage\.(?:recalculateUserStats|getDefaultUserStats|getUserStats)/g
        ]
    },
    {
        file: path.join('js', 'main.js'),
        patterns: [
            /(?:^|[^\w.])storage\.get\s*\(\s*['"]user_stats['"]/g,
            /(?:^|[^\w.])storage\.set\s*\(\s*['"]user_stats['"]/g,
            /window\.storage\.(?:get|set)\s*\(\s*['"]user_stats['"]/g,
            /PracticeCore\.store\.writeMeta\s*\(\s*['"]user_stats['"]/g,
            /scoreStorage\.(?:recalculateUserStats|getDefaultUserStats|getUserStats)/g
        ]
    },
    {
        file: path.join('js', 'app', 'suitePracticeMixin.js'),
        patterns: [
            /(?:^|[^\w.])storage\.get\s*\(\s*['"]user_stats['"]/g,
            /(?:^|[^\w.])storage\.set\s*\(\s*['"]user_stats['"]/g,
            /window\.storage\.(?:get|set)\s*\(\s*['"]user_stats['"]/g,
            /PracticeCore\.store\.writeMeta\s*\(\s*['"]user_stats['"]/g,
            /scoreStorage\.(?:recalculateUserStats|getDefaultUserStats|getUserStats)/g
        ]
    },
    {
        file: path.join('js', 'components', 'DataIntegrityManager.js'),
        patterns: [
            /(?:^|[^\w.])storage\.get\s*\(\s*['"]user_stats['"]/g,
            /(?:^|[^\w.])storage\.set\s*\(\s*['"]user_stats['"]/g,
            /window\.storage\.(?:get|set)\s*\(\s*['"]user_stats['"]/g,
            /PracticeCore\.store\.writeMeta\s*\(\s*['"]user_stats['"]/g,
            /scoreStorage\.(?:recalculateUserStats|getDefaultUserStats|getUserStats)/g
        ]
    },
    {
        file: path.join('js', 'utils', 'dataBackupManager.js'),
        patterns: [
            /(?:^|[^\w.])storage\.get\s*\(\s*['"]user_stats['"]/g,
            /(?:^|[^\w.])storage\.set\s*\(\s*['"]user_stats['"]/g,
            /window\.storage\.(?:get|set)\s*\(\s*['"]user_stats['"]/g,
            /PracticeCore\.store\.writeMeta\s*\(\s*['"]user_stats['"]/g,
            /scoreStorage\.(?:recalculateUserStats|getDefaultUserStats|getUserStats|createBackup|restoreBackup)/g,
            /practiceRecorder\.(?:getUserStats|createBackup|restoreBackup)/g
        ]
    },
    {
        file: path.join('js', 'core', 'practiceRecorder.js'),
        patterns: [
            /(?:^|[^\w.])metaRepo\.(?:get|set)\s*\(\s*['"]user_stats['"]/g,
            /(?:^|[^\w.])this\.metaRepo\.(?:get|set)\s*\(\s*['"]user_stats['"]/g,
            /PracticeCore\.store\.writeMeta\s*\(\s*['"]user_stats['"]/g,
            /scoreStorage\.(?:recalculateUserStats|getDefaultUserStats|getUserStats|exportData|importData|createBackup|restoreBackup)/g,
            /this\.scoreStorage\.(?:recalculateUserStats|getDefaultUserStats|getUserStats|exportData|importData|createBackup|restoreBackup)/g
        ]
    },
    {
        file: path.join('js', 'components', 'practiceHistoryEnhancer.js'),
        patterns: [
            /window\.practiceStats/g,
            /(?:^|[^\w.])storage\.get\s*\(\s*['"]user_stats['"]/g,
            /(?:^|[^\w.])storage\.set\s*\(\s*['"]user_stats['"]/g,
            /scoreStorage\.(?:recalculateUserStats|getDefaultUserStats|getUserStats)/g
        ]
    },
    {
        file: path.join('js', 'services', 'achievementManager.js'),
        patterns: [
            /(?:^|[^\w.])storage\.get\s*\(\s*['"]user_stats['"]/g,
            /(?:^|[^\w.])storage\.set\s*\(\s*['"]user_stats['"]/g,
            /window\.storage\.(?:get|set)\s*\(\s*['"]user_stats['"]/g,
            /PracticeCore\.store\.writeMeta\s*\(\s*['"]user_stats['"]/g,
            /scoreStorage\.(?:recalculateUserStats|getDefaultUserStats|getUserStats)/g
        ]
    }
];

const bannedImportNormalizerForkChecks = [
    {
        file: path.join('js', 'components', 'DataIntegrityManager.js'),
        patterns: [
            /_normalizePracticeRecord/g,
            /_standardizePracticeRecord/g,
            /_mergeAnswerMaps/g,
            /_detailsToCorrectMap/g,
            /_comparisonToCorrectMap/g,
            /_resolveCorrectAnswerMap/g,
            /_pickNumber/g,
            /_pickInteger/g,
            /_pickDuration/g,
            /_normalizeDate/g,
            /_stringify/g
        ]
    },
    {
        file: path.join('js', 'utils', 'dataBackupManager.js'),
        patterns: [
            /validateNormalizedRecords/g,
            /looksLikePracticeRecord/g,
            /isPracticeRecordPath/g,
            /extractRecordsFromCommonShapes/g,
            /parseNumber/g,
            /parseInteger/g,
            /firstParsedInteger/g,
            /payload\.records/g,
            /record\.percentage/g,
            /record\.accuracy/g
        ]
    }
];

const productionContractBypassPatterns = [
    /compatSchema(?:Read|Write)/g,
    /(?:^|\n)\s*(?:async\s+)?createInternalAccessOptions\s*\(/g,
    /(?:^|\n)\s*(?:async\s+)?hasInternalAccess\s*\(/g,
    /persistentStore\.createInternalAccessOptions/g,
    /persistentStore\.hasInternalAccess/g,
    /__recordStore/g
];

const replayCorrectAnswerFallbackChecks = [
    {
        file: path.join('js', 'runtime', 'unifiedReadingPage.js'),
        functionNames: ['buildReplayResults'],
        patterns: [
            /(?:entry|realData|rawData|rawRealData)\.correctAnswers/g,
            /(?:entry|realData|rawData|rawRealData)\.answerComparison/g,
            /scoreInfo\.details/g,
            /detailSources/g
        ]
    },
    {
        file: path.join('js', 'practice-page-enhancer.js'),
        functionNames: ['buildReplayResultsFromEntry'],
        patterns: [
            /(?:entry|realData|rawData|rawRealData)\.correctAnswers/g,
            /(?:entry|realData|rawData|rawRealData)\.answerComparison/g,
            /scoreInfo\.details/g,
            /detailSources/g
        ]
    },
    {
        file: path.join('js', 'app', 'examSessionMixin.js'),
        functionNames: ['_resolveReplayCorrectAnswerMap'],
        patterns: [
            /(?:entry|realData|rawData|rawRealData|source)\.correctAnswers/g,
            /(?:entry|realData|rawData|rawRealData|source)\.answerComparison/g,
            /scoreInfo\.details/g,
            /detailSources/g
        ]
    },
    {
        file: path.join('js', 'components', 'practiceRecordModal.js'),
        functionNames: ['getLegacyCorrectAnswers', 'mergeComparisonWithCorrections'],
        patterns: [
            /(?:record|realData)\.correctAnswers/g,
            /scoreInfo\.details/g,
            /detailSources/g
        ]
    },
    {
        file: path.join('js', 'utils', 'storage.js'),
        functionNames: ['compressRealData'],
        patterns: [
            /correctAnswers\s*:\s*realData\.correctAnswers/g,
            /correctAnswer\s*:\s*comparison\.correctAnswer/g
        ]
    },
    {
        file: path.join('templates', 'exam-placeholder.html'),
        functionNames: ['buildReplaySnapshot'],
        patterns: [
            /(?:source|entry|realData|rawData)\.correctAnswers/g,
            /deriveCorrectMapFromDetails/g
        ]
    }
];

const replayCorrectAnswerGlobalPatterns = [
    /extractReplayCorrectAnswersFrom(?:Comparison|Details)/g,
    /_hydrateReplayCorrectAnswersFromDetails/g,
    /fallbackCorrectSources/g
];

function walk(dir, bucket = []) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.forEach((entry) => {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(repoRoot, fullPath);
        if (entry.isDirectory()) {
            if (relativePath === path.join('js', 'bundles')) {
                return;
            }
            walk(fullPath, bucket);
            return;
        }
        if (entry.isFile() && entry.name.endsWith('.js')) {
            bucket.push(fullPath);
        }
    });
    return bucket;
}

function formatLine(source, index) {
    return source.slice(0, index).split('\n').length;
}

function collectMatches(files, patterns, allowlist) {
    const findings = [];
    files.forEach((fullPath) => {
        const relativePath = path.relative(repoRoot, fullPath);
        if (allowlist.has(relativePath)) {
            return;
        }
        const source = fs.readFileSync(fullPath, 'utf8');
        patterns.forEach((pattern) => {
            pattern.lastIndex = 0;
            let match = pattern.exec(source);
            while (match) {
                findings.push({
                    file: relativePath,
                    line: formatLine(source, match.index),
                    snippet: match[0].trim()
                });
                match = pattern.exec(source);
            }
        });
    });
    return findings;
}

function collectTargetedFallbackMatches() {
    const findings = [];
    bannedRecordFallbackChecks.forEach((check) => {
        const fullPath = path.join(repoRoot, check.file);
        if (!fs.existsSync(fullPath)) {
            return;
        }
        const source = fs.readFileSync(fullPath, 'utf8');
        check.patterns.forEach((pattern) => {
            pattern.lastIndex = 0;
            let match = pattern.exec(source);
            while (match) {
                findings.push({
                    file: check.file,
                    line: formatLine(source, match.index),
                    snippet: match[0].trim()
                });
                match = pattern.exec(source);
            }
        });
    });
    return findings;
}

function collectTargetedStatsBypassMatches() {
    const findings = [];
    bannedStatsBypassChecks.forEach((check) => {
        const fullPath = path.join(repoRoot, check.file);
        if (!fs.existsSync(fullPath)) {
            return;
        }
        const source = fs.readFileSync(fullPath, 'utf8');
        check.patterns.forEach((pattern) => {
            pattern.lastIndex = 0;
            let match = pattern.exec(source);
            while (match) {
                findings.push({
                    file: check.file,
                    line: formatLine(source, match.index),
                    snippet: match[0].trim()
                });
                match = pattern.exec(source);
            }
        });
    });
    return findings;
}

function collectImportNormalizerForkMatches() {
    const findings = [];
    bannedImportNormalizerForkChecks.forEach((check) => {
        const fullPath = path.join(repoRoot, check.file);
        if (!fs.existsSync(fullPath)) {
            return;
        }
        const source = fs.readFileSync(fullPath, 'utf8');
        check.patterns.forEach((pattern) => {
            pattern.lastIndex = 0;
            let match = pattern.exec(source);
            while (match) {
                findings.push({
                    file: check.file,
                    line: formatLine(source, match.index),
                    snippet: match[0].trim()
                });
                match = pattern.exec(source);
            }
        });
    });
    return findings;
}

function collectProductionContractBypassMatches(files) {
    return collectMatches(files, productionContractBypassPatterns, new Set());
}

function collectPracticeDataPublicSurfaceMatches() {
    const findings = [];
    const corePath = path.join('js', 'core', 'practiceCore.js');
    const coreFullPath = path.join(repoRoot, corePath);
    if (fs.existsSync(coreFullPath)) {
        const source = fs.readFileSync(coreFullPath, 'utf8');
        const publicStoreMatch = /const\s+publicStore\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\);/m.exec(source);
        if (!publicStoreMatch) {
            findings.push({
                file: corePath,
                line: 0,
                snippet: 'publicStore missing'
            });
        } else {
            const banned = [
                'replacePracticeRecords',
                'savePracticeRecord',
                'routeStorageSet',
                'routeStorageRemove',
                'writeMeta',
                'removeMeta'
            ];
            banned.forEach((name) => {
                const index = publicStoreMatch[1].indexOf(name);
                if (index >= 0) {
                    findings.push({
                        file: corePath,
                        line: formatLine(source, publicStoreMatch.index + index),
                        snippet: `publicStore exposes ${name}`
                    });
                }
            });
        }
    }

    const dataIndexPath = path.join('js', 'data', 'index.js');
    const dataIndexFullPath = path.join(repoRoot, dataIndexPath);
    if (fs.existsSync(dataIndexFullPath)) {
        const source = fs.readFileSync(dataIndexFullPath, 'utf8');
        const apiStart = source.indexOf('const api = {', source.indexOf('const metaFacade'));
        const apiEnd = apiStart >= 0 ? source.indexOf('};', apiStart) : -1;
        if (apiStart < 0 || apiEnd < 0) {
            findings.push({
                file: dataIndexPath,
                line: 0,
                snippet: 'public dataRepositories api missing'
            });
        } else {
            const publicApiBody = source.slice(apiStart, apiEnd);
            const patterns = [
                /get\s+practice\s*\(/g,
                /practiceRepo/g,
                /user_stats[\s\S]{0,80}(?:metaRepo\.set|metaRepo\.get)/g
            ];
            patterns.forEach((pattern) => {
                pattern.lastIndex = 0;
                let match = pattern.exec(publicApiBody);
                while (match) {
                    findings.push({
                        file: dataIndexPath,
                        line: formatLine(source, apiStart + match.index),
                        snippet: match[0].trim()
                    });
                    match = pattern.exec(publicApiBody);
                }
            });
        }
    }
    return findings;
}

function collectReplayCorrectAnswerFallbackMatches(files) {
    const findings = [];
    replayCorrectAnswerFallbackChecks.forEach((check) => {
        const fullPath = path.join(repoRoot, check.file);
        if (!fs.existsSync(fullPath)) {
            return;
        }
        const source = fs.readFileSync(fullPath, 'utf8');
        check.functionNames.forEach((functionName) => {
            const extracted = extractFunctionBody(source, functionName);
            if (!extracted) {
                findings.push({
                    file: check.file,
                    line: 0,
                    snippet: `${functionName} missing`
                });
                return;
            }
            check.patterns.forEach((pattern) => {
                pattern.lastIndex = 0;
                let match = pattern.exec(extracted.body);
                while (match) {
                    findings.push({
                        file: check.file,
                        line: formatLine(source, extracted.startIndex + match.index),
                        snippet: `${functionName}: ${match[0].trim()}`
                    });
                    match = pattern.exec(extracted.body);
                }
            });
        });
    });

    const targetFiles = new Set(replayCorrectAnswerFallbackChecks.map((check) => check.file));
    files.forEach((fullPath) => {
        const relativePath = path.relative(repoRoot, fullPath);
        if (!targetFiles.has(relativePath)) {
            return;
        }
        const source = fs.readFileSync(fullPath, 'utf8');
        replayCorrectAnswerGlobalPatterns.forEach((pattern) => {
            pattern.lastIndex = 0;
            let match = pattern.exec(source);
            while (match) {
                findings.push({
                    file: relativePath,
                    line: formatLine(source, match.index),
                    snippet: match[0].trim()
                });
                match = pattern.exec(source);
            }
        });
    });
    return findings;
}

function collectUnsafeCompatSchemaWrites() {
    const findings = [];
    [
        path.join('js', 'core', 'scoreStorage.js'),
        path.join('js', 'utils', 'storage.js')
    ].forEach((relativePath) => {
        const fullPath = path.join(repoRoot, relativePath);
        if (!fs.existsSync(fullPath)) {
            return;
        }
        const source = fs.readFileSync(fullPath, 'utf8');
        const rawWritePattern = /(?:this\.storage\.set\s*\(\s*this\.storageKeys\.practiceRecords|this\.set\s*\(\s*['"]practice_records['"])/g;
        rawWritePattern.lastIndex = 0;
        let match = rawWritePattern.exec(source);
        while (match) {
            const windowStart = Math.max(0, match.index - 450);
            const windowEnd = Math.min(source.length, match.index + 220);
            const localContext = source.slice(windowStart, windowEnd);
            if (!/compatSchemaWrite/.test(localContext)) {
                findings.push({
                    file: relativePath,
                    line: formatLine(source, match.index),
                    snippet: match[0].trim()
                });
            }
            match = rawWritePattern.exec(source);
        }
    });
    return findings;
}

function extractFunctionBody(source, functionName) {
    const signature = new RegExp(`(?:async\\s+)?${functionName}\\s*\\(`, 'g');
    const match = signature.exec(source);
    if (!match) {
        return null;
    }
    const openBrace = source.indexOf('{', match.index);
    if (openBrace < 0) {
        return null;
    }

    let depth = 0;
    for (let index = openBrace; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') {
            depth += 1;
        } else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return {
                    body: source.slice(openBrace, index + 1),
                    startIndex: openBrace
                };
            }
        }
    }
    return null;
}

function collectRuntimeCompatSchemaWrites() {
    const findings = [];
    const relativePath = path.join('js', 'utils', 'storage.js');
    const fullPath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(fullPath)) {
        return findings;
    }
    const source = fs.readFileSync(fullPath, 'utf8');
    ['restoreFromBackup', 'importData'].forEach((functionName) => {
        const extracted = extractFunctionBody(source, functionName);
        if (!extracted) {
            findings.push({
                file: relativePath,
                line: 0,
                snippet: `${functionName} missing`
            });
            return;
        }
        const pattern = /compatSchemaWrite\s*:\s*true/g;
        pattern.lastIndex = 0;
        let match = pattern.exec(extracted.body);
        while (match) {
            findings.push({
                file: relativePath,
                line: formatLine(source, extracted.startIndex + match.index),
                snippet: `${functionName}: ${match[0]}`
            });
            match = pattern.exec(extracted.body);
        }
    });
    return findings;
}

function collectE2ERawPracticeRecordReads() {
    const findings = [];
    const relativePath = path.join('developer', 'tests', 'e2e', 'suite_practice_flow.py');
    const fullPath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(fullPath)) {
        return findings;
    }
    const source = fs.readFileSync(fullPath, 'utf8');
    const patterns = [
        /window\.storage\.get\(['"]practice_records['"]/g,
        /storage\.get\(['"]practice_records['"]/g,
        /window\.storage\.set\(['"]practice_records['"]/g,
        /storage\.set\(['"]practice_records['"]/g,
        /window\.storage\.remove\(['"]practice_records['"]/g,
        /storage\.remove\(['"]practice_records['"]/g
    ];
    patterns.forEach((pattern) => {
        pattern.lastIndex = 0;
        let match = pattern.exec(source);
        while (match) {
            findings.push({
                file: relativePath,
                line: formatLine(source, match.index),
                snippet: match[0].trim()
            });
            match = pattern.exec(source);
        }
    });
    return findings;
}

function main() {
    const files = walk(jsRoot);
    const directWrites = collectMatches(files, directWritePatterns, DIRECT_WRITE_ALLOWLIST);
    const practiceRecordShadows = collectMatches(files, practiceRecordsShadowPatterns, new Set());
    const recordFallbacks = collectTargetedFallbackMatches();
    const statsBypasses = collectTargetedStatsBypassMatches();
    const importNormalizerForks = collectImportNormalizerForkMatches();
    const productionContractBypasses = collectProductionContractBypassMatches(files);
    const practiceDataPublicSurfaceBypasses = collectPracticeDataPublicSurfaceMatches();
    const replayCorrectAnswerFallbacks = collectReplayCorrectAnswerFallbackMatches(files);
    const unsafeCompatSchemaWrites = collectUnsafeCompatSchemaWrites();
    const runtimeCompatSchemaWrites = collectRuntimeCompatSchemaWrites();
    const e2eRawPracticeRecordReads = collectE2ERawPracticeRecordReads();
    const aliasCopies = collectMatches(files, protocolAliasPatterns, PROTOCOL_ALIAS_ALLOWLIST);
    const pathCopies = collectMatches(files, pathDefinitionPatterns, PATH_CORE_ALLOWLIST);
    const stateCopies = collectMatches(files, stateDefinitionPatterns, STATE_CORE_ALLOWLIST);
    const legacyCopies = collectMatches(files, legacyMarkers, new Set());
    const passed = directWrites.length === 0
        && practiceRecordShadows.length === 0
        && recordFallbacks.length === 0
        && statsBypasses.length === 0
        && importNormalizerForks.length === 0
        && productionContractBypasses.length === 0
        && practiceDataPublicSurfaceBypasses.length === 0
        && replayCorrectAnswerFallbacks.length === 0
        && unsafeCompatSchemaWrites.length === 0
        && runtimeCompatSchemaWrites.length === 0
        && e2eRawPracticeRecordReads.length === 0
        && aliasCopies.length === 0
        && pathCopies.length === 0
        && stateCopies.length === 0
        && legacyCopies.length === 0;

    console.log(JSON.stringify({
        status: passed ? 'pass' : 'fail',
        detail: passed
            ? '无多余 practice_records 直写、记录旧 fallback、导入层 record normalizer 分叉、公开 internal token、回放正确答案兜底、运行期 compat schema 写入、E2E raw records 读取、协议别名复制、路径实现复制、状态实现复制或 legacy bridge 残留'
            : `发现 ${directWrites.length} 处直写、${practiceRecordShadows.length} 处 practiceRecords 影子事实源、${recordFallbacks.length} 处记录旧 fallback、${statsBypasses.length} 处统计旧入口绕行、${importNormalizerForks.length} 处导入层 record normalizer 分叉、${productionContractBypasses.length} 处生产契约绕行、${practiceDataPublicSurfaceBypasses.length} 处练习数据公开写面、${replayCorrectAnswerFallbacks.length} 处回放正确答案兜底、${unsafeCompatSchemaWrites.length} 处非显式 compat schema 写入、${runtimeCompatSchemaWrites.length} 处运行期 compat schema 写入、${e2eRawPracticeRecordReads.length} 处 E2E raw records 读取、${aliasCopies.length} 处协议别名复制、${pathCopies.length} 处路径实现复制、${stateCopies.length} 处状态实现复制、${legacyCopies.length} 处 legacy 残留`,
        directWrites,
        practiceRecordShadows,
        recordFallbacks,
        statsBypasses,
        importNormalizerForks,
        productionContractBypasses,
        practiceDataPublicSurfaceBypasses,
        replayCorrectAnswerFallbacks,
        unsafeCompatSchemaWrites,
        runtimeCompatSchemaWrites,
        e2eRawPracticeRecordReads,
        aliasCopies,
        pathCopies,
        stateCopies,
        legacyCopies
    }, null, 2));

    if (!passed) {
        process.exit(1);
    }
}

main();
