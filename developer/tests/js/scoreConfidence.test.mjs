#!/usr/bin/env node
// Wording under the band table: agreement, disagreement and a lone surviving
// sample must read differently, and legacy results show nothing.

import assert from 'node:assert/strict'
import {
  buildEvaluationView,
  describeScoreConfidence
} from '../../../apps/writing-vue/src/utils/evaluation-result.js'

const bands = (overall) => ({ overall, taskResponse: overall, coherence: overall, lexical: overall, grammar: overall })

function confidenceOf(confidence) {
  return buildEvaluationView({
    score: bands(6.5),
    diagnosis: { confidence }
  }).scoreConfidence
}

const agreed = confidenceOf({ samples: 2, agreed: true, low: bands(6.5), high: bands(7) })
assert.equal(describeScoreConfidence(agreed), '2 次独立评分基本一致（总分区间 6.5–7.0）。')

const split = confidenceOf({ samples: 3, agreed: false, low: bands(5.5), high: bands(7) })
assert.match(describeScoreConfidence(split), /^独立评分出现分歧，已取 3 次评分的中位数（总分区间 5\.5–7\.0）/)

const single = confidenceOf({ samples: 1, agreed: false, low: bands(6), high: bands(6) })
const singleNote = describeScoreConfidence(single)
assert.match(singleNote, /只有 1 次评分成功，未能交叉核对/)
assert.doesNotMatch(singleNote, /分歧/)

assert.equal(confidenceOf(undefined), null)
assert.equal(describeScoreConfidence(null), '')

console.log('scoreConfidence: ok')
