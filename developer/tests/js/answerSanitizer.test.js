#!/usr/bin/env node
import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sanitizer = require(path.resolve(__dirname, '../../../js/utils/answerSanitizer.js'));

describe('AnswerSanitizer.normalizeValue', () => {
  it('extracts preferred fields from objects', () => {
    assert.strictEqual(sanitizer.normalizeValue({ value: '  Test ' }), 'Test');
    assert.strictEqual(sanitizer.normalizeValue({ answerValue: ' B ', label: 'Japan' }), 'B');
    assert.strictEqual(sanitizer.normalizeValue({ heading: ' vi ' }), 'vi');
    assert.strictEqual(sanitizer.normalizeValue({ key: 'C', text: 'choice C' }), 'C');
    assert.strictEqual(sanitizer.normalizeValue({ text: 'Hello' }), 'Hello');
  });

  it('removes [object Object] artifacts', () => {
    assert.strictEqual(sanitizer.normalizeValue({}), '');
    assert.strictEqual(sanitizer.normalizeValue('[object Object]'), '');
  });

  it('bounds oversized answer text without leaving split surrogate pairs', () => {
    const value = `${'a'.repeat(3999)}\uD83D\uDE00tail`;
    const normalized = sanitizer.normalizeValue(value);
    assert.strictEqual(normalized, 'a'.repeat(3999));
    assert(!/[\uD800-\uDFFF]$/.test(normalized));
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

  it('preserves accepted answers and canonical answer for listening spelling review', () => {
    const result = sanitizer.sanitizeComparisonMap({
      q7: {
        userAnswer: 'acommodation',
        correctAnswer: 'accommodation / lodging',
        acceptedAnswers: ['accommodation', { text: 'lodging' }, 'ACCOMMODATION'],
        canonicalAnswer: { value: 'accommodation' },
        isCorrect: false
      }
    });

    assert.deepStrictEqual(result.q7, {
      questionId: 'q7',
      userAnswer: 'acommodation',
      correctAnswer: 'accommodation / lodging',
      isCorrect: false,
      acceptedAnswers: ['accommodation', 'lodging'],
      canonicalAnswer: 'accommodation'
    });
  });

  it('drops prototype-polluting comparison keys', () => {
    const polluted = JSON.parse(`{
      "__proto__": { "userAnswer": "polluted", "correctAnswer": "polluted" },
      "constructor": { "userAnswer": "ctor", "correctAnswer": "ctor" },
      "prototype": { "userAnswer": "proto", "correctAnswer": "proto" },
      "q1": { "questionId": "__proto__", "userAnswer": "A", "correctAnswer": "A", "isCorrect": true }
    }`);

    const result = sanitizer.sanitizeComparisonMap(polluted);

    assert.strictEqual(Object.getPrototypeOf(result), null);
    assert.strictEqual(Object.prototype.polluted, undefined);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(result, '__proto__'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(result, 'constructor'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(result, 'prototype'), false);
    assert.deepStrictEqual(result.q1, {
      questionId: 'q1',
      userAnswer: 'A',
      correctAnswer: 'A',
      isCorrect: true
    });
  });

  it('bounds oversized comparison maps and accepted answer lists', () => {
    const entries = {};
    for (let index = 0; index < 1100; index += 1) {
      entries[`q${index}`] = {
        userAnswer: 'A',
        correctAnswer: 'A',
        acceptedAnswers: Array.from({ length: 250 }, (_, item) => `answer-${item}`)
      };
    }

    const result = sanitizer.sanitizeComparisonMap(entries);

    assert.strictEqual(Object.keys(result).length, 1000);
    assert.strictEqual(result.q0.acceptedAnswers.length, 200);
    assert.strictEqual(result.q999.correctAnswer, 'A');
    assert.strictEqual(result.q1000, undefined);
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
