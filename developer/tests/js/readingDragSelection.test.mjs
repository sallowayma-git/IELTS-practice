import assert from 'node:assert/strict'
import { createDragSelectionController } from '../../../apps/writing-vue/src/modules/practice-reading/readingDragSelectionCore.js'

const statuses = []
const changes = []
let review = false
const controller = createDragSelectionController({
  isReview: () => review,
  onStatus: (message) => statuses.push(message),
  onChange: (value) => changes.push(value)
})

assert.equal(controller.select({ value: 'A', label: 'Heading A', sourceQuestionId: '' }), true)
assert.equal(controller.getSelected().value, 'A')

let assigned = null
assert.equal(controller.place('q1', (questionId, selected) => {
  assigned = { questionId, selected }
  return true
}), true)
assert.deepEqual(assigned, {
  questionId: 'q1',
  selected: { value: 'A', label: 'Heading A', sourceQuestionId: '' }
})
assert.equal(controller.getSelected(), null)

controller.select({ value: 'B', label: 'Heading B', sourceQuestionId: '' })
assert.equal(controller.place('q2', () => false), false)
assert.equal(controller.getSelected().value, 'B', 'rejected placement keeps the selection')

assert.equal(controller.activateKey('Escape', () => assert.fail('escape must not activate')), true)
assert.equal(controller.getSelected(), null)

let activated = 0
assert.equal(controller.activateKey('Enter', () => { activated += 1 }), true)
assert.equal(controller.activateKey(' ', () => { activated += 1 }), true)
assert.equal(controller.activateKey('ArrowRight', () => { activated += 1 }), false)
assert.equal(activated, 2)

review = true
assert.equal(controller.select({ value: 'C', label: 'Heading C' }), false)
assert.equal(controller.place('q3', () => assert.fail('review mode must not assign')), false)
assert.equal(controller.activateKey('Enter', () => assert.fail('read-only keyboard must not assign')), false)
assert.equal(controller.getSelected(), null)

let memorizeReadOnly = false
const memorizeController = createDragSelectionController({
  isReadOnly: () => memorizeReadOnly
})
assert.equal(memorizeController.select({ value: 'M', label: 'Memorize option' }), true)
memorizeReadOnly = true
assert.equal(memorizeController.place('q4', () => assert.fail('memorize mode must not assign')), false)
assert.equal(memorizeController.activateKey(' ', () => assert.fail('memorize keyboard must not assign')), false)

review = false
controller.select({ value: 'D', label: 'Heading D', sourceQuestionId: 'q4' })
assert.equal(controller.select({ value: 'D', label: 'Heading D', sourceQuestionId: 'q4' }), false)
assert.equal(controller.getSelected(), null, 'selecting the same option toggles it off')

assert.ok(statuses.some((message) => message.includes('请选择目标位置')))
assert.ok(statuses.some((message) => message.includes('回顾模式为只读')))
assert.ok(changes.length >= 4)

console.log('reading drag selection controller: ok')
