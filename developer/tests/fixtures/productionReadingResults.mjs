import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export function productionReadingResults(examId, answers) {
    const context = vm.createContext({ document: { addEventListener() {} } });
    context.window = context;
    context.__IELTS_READING_PAGE_TEST_HOOKS__ = true;
    context.__READING_EXAM_DATA__ = { register(id, dataset) { context.dataset = dataset; } };
    for (const file of ['js/utils/answerMatchCore.js', 'js/runtime/unifiedReadingPage.js',
        `assets/generated/reading-exams/${examId}.js`]) {
        vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
    }
    return JSON.parse(JSON.stringify(context.__IELTS_UNIFIED_READING_PAGE_TEST__
        .buildResultsFromAnswers(context.dataset, answers)));
}
