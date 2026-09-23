const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const QUESTION_BANK_ASSET_ROOTS = Object.freeze([
    'assets/generated/reading-exams',
    'assets/generated/reading-explanations',
    'assets/generated/listening-exams'
]);

function listFilesRecursively(absoluteDirectory) {
    if (!fs.existsSync(absoluteDirectory)) return [];
    return fs.readdirSync(absoluteDirectory, { withFileTypes: true })
        .flatMap((entry) => {
            const absolutePath = path.join(absoluteDirectory, entry.name);
            return entry.isDirectory() ? listFilesRecursively(absolutePath) : [absolutePath];
        });
}

function calculateQuestionBankRevision(repoRoot) {
    const files = QUESTION_BANK_ASSET_ROOTS
        .flatMap((relativeRoot) => listFilesRecursively(path.join(repoRoot, relativeRoot)))
        .map((absolutePath) => path.relative(repoRoot, absolutePath).replace(/\\/g, '/'))
        .sort();
    const hash = crypto.createHash('sha256');
    files.forEach((relativePath) => {
        hash.update(relativePath);
        hash.update('\0');
        hash.update(fs.readFileSync(path.join(repoRoot, relativePath)));
        hash.update('\0');
    });
    return Object.freeze({ revision: hash.digest('hex'), files: files.length });
}

function createQuestionBankRevisionProvider(options = {}) {
    const repoRoot = options.repoRoot || path.resolve(__dirname, '..', '..');
    const cacheTtlMs = Math.max(0, Number(options.cacheTtlMs) || 5000);
    let cached = null;
    let refreshAfter = 0;

    return Object.freeze({
        getRevision() {
            const now = Date.now();
            if (!cached || now >= refreshAfter) {
                cached = calculateQuestionBankRevision(repoRoot);
                refreshAfter = now + cacheTtlMs;
            }
            return cached;
        }
    });
}

module.exports = {
    QUESTION_BANK_ASSET_ROOTS,
    calculateQuestionBankRevision,
    createQuestionBankRevisionProvider
};
