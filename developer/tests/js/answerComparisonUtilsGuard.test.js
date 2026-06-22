#!/usr/bin/env node
import assert from 'assert';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const AnswerComparisonUtils = require(path.join(repoRoot, 'js', 'utils', 'answerComparisonUtils.js'));

const record = JSON.parse(`{
  "answerComparison": {
    "q1": {
      "userAnswer": "A",
      "correctAnswer": "A"
    },
    "__proto__": {
      "userAnswer": "polluted",
      "correctAnswer": "polluted"
    },
    "prototype": {
      "userAnswer": "polluted",
      "correctAnswer": "polluted"
    }
  },
  "answers": {
    "1": "A",
    "constructor": "polluted",
    "prototype": "polluted"
  },
  "correctAnswers": {
    "q1": "A",
    "__proto__": "polluted",
    "constructor": "polluted"
  },
  "scoreInfo": {
    "details": {
      "prototype": {
        "userAnswer": "polluted",
        "correctAnswer": "polluted"
      }
    }
  }
}`);

const entries = AnswerComparisonUtils.getNormalizedEntries(record);

assert.equal(Object.prototype.polluted, undefined);
assert.equal(entries.length, 1);
assert.equal(entries[0].canonicalKey, 'q1');
assert.equal(entries[0].userAnswer, 'A');
assert.equal(entries[0].correctAnswer, 'A');
assert.equal(entries[0].isCorrect, true);
assert(!entries.some((entry) => /(?:__proto__|prototype|constructor)/i.test(entry.canonicalKey)));
assert(!entries.some((entry) => entry.originalKeys.some((key) => /(?:__proto__|prototype|constructor)/i.test(key))));

console.log(JSON.stringify({
    status: 'pass',
    detail: 'answer comparison utils prototype-pollution guard passed'
}, null, 2));
