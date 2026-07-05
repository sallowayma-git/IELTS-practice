#!/usr/bin/env node

import assert from 'assert/strict';

import {
    detectGroupKind,
    normalizeQuestionGroupHtml
} from './generate_reading_assets.node.js';

const sourceHtml = `<div class="group" id="q5-6-7-8-anchor">
                <h4>Questions 5–8</h4>
                <p>Reading Passage 1 has seven paragraphs, <strong>A–G</strong>.</p>
                <p>Which paragraph contains the following information?</p>
                <p>Write the correct letter, <strong>A–G</strong>, in boxes 5–8 on your answer sheet.</p>
                <p><strong>NB</strong> You may use any letter more than once.</p>

                <div class="question-item">
                    <p><strong>5</strong> examples of things that affect the distance sound can travel in water<input type="text" id="q5_input" name="q5"></p>
                </div>
                <div class="question-item">
                    <p><strong>6</strong> details of the connection between ocean temperatures and climate<input type="text" id="q6_input" name="q6"></p>
                </div>
                <div class="question-item">
                    <p><strong>7</strong> details of ways in which light and sound are similar<input type="text" id="q7_input" name="q7"></p>
                </div>
                <div class="question-item">
                    <p><strong>8</strong> a reference to a long-term study of different types of weather<input type="text" id="q8_input" name="q8"></p>
                </div>
            </div>`;

const normalized = normalizeQuestionGroupHtml(sourceHtml);

assert.match(normalized, /<table class="matching-table">/);
assert.doesNotMatch(normalized, /type=["']text["']/i);
assert.match(normalized, /name="q5" value="A"/);
assert.match(normalized, /name="q8" value="G"/);
assert.equal(detectGroupKind(normalized), 'table_completion');

const alternateSourceHtml = `<div class="group">
      <h4>Questions 14-20</h4>
      <p>Reading Passage 2 has seven paragraphs, <strong>A-G</strong>.</p>
      <p>Which paragraph contains the following information?</p>
      <p><em>Write the correct letter, A-G, in boxes 14-20 on your answer sheet.</em></p>
      <p><strong>NB</strong> You may use any letter more than once.</p>

      <div style="margin-bottom: 16px;">
        <p><a id="q1-anchor"></a><strong>14</strong> an example prompt</p>
        <input class="blank" type="text" name="q1" maxlength="1" style="width: 60px;">
      </div>
    </div>`;

const alternateNormalized = normalizeQuestionGroupHtml(alternateSourceHtml);

assert.match(alternateNormalized, /<table class="matching-table">/);
assert.doesNotMatch(alternateNormalized, /type=["']text["']/i);
assert.match(alternateNormalized, /name="q1" value="G"/);

process.stdout.write('generate_reading_assets paragraph-match rewrite: ok\n');
