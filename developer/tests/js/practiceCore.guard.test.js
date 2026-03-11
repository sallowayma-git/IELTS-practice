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
    /(?:^|[^\w.])this\.set\s*\(\s*['"]practice_records['"]/g
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

function walk(dir, bucket = []) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.forEach((entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
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

function main() {
    const files = walk(jsRoot);
    const directWrites = collectMatches(files, directWritePatterns, DIRECT_WRITE_ALLOWLIST);
    const aliasCopies = collectMatches(files, protocolAliasPatterns, PROTOCOL_ALIAS_ALLOWLIST);
    const pathCopies = collectMatches(files, pathDefinitionPatterns, PATH_CORE_ALLOWLIST);
    const stateCopies = collectMatches(files, stateDefinitionPatterns, STATE_CORE_ALLOWLIST);
    const legacyCopies = collectMatches(files, legacyMarkers, new Set());
    const passed = directWrites.length === 0
        && aliasCopies.length === 0
        && pathCopies.length === 0
        && stateCopies.length === 0
        && legacyCopies.length === 0;

    console.log(JSON.stringify({
        status: passed ? 'pass' : 'fail',
        detail: passed
            ? '无多余 practice_records 直写、协议别名复制、路径实现复制、状态实现复制或 legacy bridge 残留'
            : `发现 ${directWrites.length} 处直写、${aliasCopies.length} 处协议别名复制、${pathCopies.length} 处路径实现复制、${stateCopies.length} 处状态实现复制、${legacyCopies.length} 处 legacy 残留`,
        directWrites,
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
