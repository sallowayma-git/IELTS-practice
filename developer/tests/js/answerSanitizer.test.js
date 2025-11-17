#!/usr/bin/env node
const assert = require('assert');
const path = require('path');
const sanitizer = require(path.resolve(__dirname, '../../../js/utils/answerSanitizer.js'));

describe('AnswerSanitizer.normalizeValue', () => {
  it('extracts preferred fields from objects', () => {
    assert.strictEqual(sanitizer.normalizeValue({ value: '  Test ' }), 'Test');
    assert.strictEqual(sanitizer.normalizeValue({ text: 'Hello' }), 'Hello');
  });

  it('removes [object Object] artifacts', () => {
    assert.strictEqual(sanitizer.normalizeValue({}), '');
    assert.strictEqual(sanitizer.normalizeValue('[object Object]'), '');
  });
});

describe('AnswerSanitizer.sanitizeComparisonMap', () => {
  it('drops entries without meaningful answers', () => {
    const result = sanitizer.sanitizeComparisonMap({
      q1: { userAnswer: '[object Object]', correctAnswer: 'N/A' },
      q28: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true }
    });
    assert.strictEqual(result.q1, undefined);
    assert.deepStrictEqual(result.q28, {
      questionId: 'q28',
      userAnswer: 'A',
      correctAnswer: 'A',
      isCorrect: true
    });
  });
});

function describe(name, fn) {
  try {
    fn();
    console.log(`✔ ${name}`);
  } catch (error) {
    console.error(`✖ ${name}`);
    throw error;
  }
}

function it(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}`);
    throw error;
  }
}
