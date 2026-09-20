import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = (file) => fs.readFileSync(new URL(file, root), 'utf8');

test('Browse uses one persisted sort/filter entry point', () => {
    const html = read('index.html');
    const source = read('js/components/browseLearningControls.js');

    assert.equal((html.match(/id="browse-learning-trigger"/g) || []).length, 1);
    assert.match(html, /id="browse-learning-label">排序筛选</);
    assert.doesNotMatch(html, /browse-sort-select|browse-sort-wrapper/);
    assert.match(html, /name="browse-sort-mode" value="default"/);
    assert.match(html, /name="browse-sort-mode" value="frequency-desc"/);
    assert.match(html, /name="browse-sort-mode" value="difficulty-desc"/);
    assert.match(source, /sortMode: 'default'/);
    assert.match(source, /patchBrowse\(\{[\s\S]*sortMode: selection\.sortMode/);
    assert.match(source, /global\.__browseSortMode = selection\.sortMode/);
    assert.match(source, /const sortMode = options\.resetSort === true \? 'default' : selection\.sortMode/);
    assert.match(source, /patchBrowse\(\{\s*learningState: 'all',\s*favoritesOnly: false\s*\}\)/);
    assert.match(source, /event\.key === 'Escape'/);
});
