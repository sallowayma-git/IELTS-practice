import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../../js/components/readingNotebookView.js', import.meta.url), 'utf8');

function harness(entries, articles) {
    const window = {
        ReadingVocabStore: {
            getAll: () => entries,
            _state: { snapshot: { reading: { articles } } }
        }
    };
    const context = vm.createContext({
        window,
        console,
        Map,
        Set,
        Intl,
        Date,
        JSON,
        String,
        Number,
        Array,
        Object,
        Math,
        setTimeout,
        clearTimeout
    });
    vm.runInContext(source, context);
    return window.ReadingNotebookView;
}

test('notebook search indexes titles for occurrence-less secondary manual associations', () => {
    const notebook = harness([
        {
            id: 'term:adapt', word: 'adapt', examId: 'primary', examTitle: 'Primary passage',
            context: '', highlights: [],
            associations: [
                { id: 'primary-association', articleId: 'article:primary', manual: true },
                { id: 'secondary-association', articleId: 'article:secondary', manual: true }
            ]
        }
    ], [
        { id: 'article:primary', examId: 'primary', title: 'Primary passage', sourceId: 'source:a' },
        { id: 'article:secondary', examId: 'secondary', title: 'Secondary migration article', sourceId: 'source:b' }
    ]);

    notebook.state.searchQuery = 'secondary migration';
    assert.equal(notebook.getEntries().length, 1);
    notebook.state.searchQuery = 'secondary';
    assert.equal(notebook.getEntries()[0].word, 'adapt');
});

test('notebook source badges include every associated article, including manual secondary rows', () => {
    const notebook = harness([
        {
            id: 'term:adapt', word: 'adapt', examId: 'primary', examTitle: 'Primary passage',
            context: '', highlights: [{ examId: 'primary', text: 'adapt' }],
            associations: [
                { id: 'primary-association', articleId: 'article:primary', manual: true },
                { id: 'secondary-association', articleId: 'article:secondary', manual: true },
                { id: 'third-association', articleId: 'article:third', manual: true },
                { id: 'fourth-association', articleId: 'article:fourth', manual: true }
            ]
        }
    ], [
        { id: 'article:primary', examId: 'primary', title: 'Primary passage', sourceId: 'source:a' },
        { id: 'article:secondary', examId: 'secondary', title: 'Secondary migration article', sourceId: 'source:b' },
        { id: 'article:third', examId: 'third', title: 'Third climate article', sourceId: 'source:c' },
        { id: 'article:fourth', examId: 'fourth', title: 'Fourth policy article', sourceId: 'source:d' }
    ]);

    const markup = notebook.renderEntries(notebook.getEntries(), true);
    assert.match(markup, /Primary passage/);
    assert.match(markup, /Secondary migration article/);
    assert.match(markup, /Third climate article/);
    assert.match(markup, /\+1 篇/);
    assert.doesNotMatch(markup, /Fourth policy article/);
    assert.doesNotMatch(markup, /article:(?:primary|secondary|third|fourth)/);
});

test('notebook search still indexes occurrence text and the canonical article', () => {
    const notebook = harness([
        {
            id: 'term:brief', word: 'brief', examId: 'primary', examTitle: 'Primary passage',
            context: 'a brief example',
            highlights: [{ text: 'briefly stated' }],
            associations: [{ articleId: 'article:primary', manual: false }]
        }
    ], [{ id: 'article:primary', examId: 'primary', title: 'Primary passage', sourceId: 'source:a' }]);

    for (const query of ['primary passage', 'briefly stated', 'example']) {
        notebook.state.searchQuery = query;
        assert.equal(notebook.getEntries().length, 1, `expected ${query} to match`);
    }
});
