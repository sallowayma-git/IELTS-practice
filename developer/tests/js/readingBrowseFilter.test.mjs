import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import * as browseFilters from '../../../apps/writing-vue/src/modules/practice-reading/browseFilters.js'
import { QUESTION_KIND_LABELS } from '../../../apps/writing-vue/src/modules/practice-reading/readingTags.js'

const view = readFileSync(new URL('../../../apps/writing-vue/src/views/PracticeLibraryPage.vue', import.meta.url), 'utf8')
const script = view.split('<script setup>')[1].split('</script>')[0]
  .replace(/^import[\s\S]*?from ['"][^'"]+['"]\r?\n/gm, '')
const appRequire = createRequire(new URL('../../../apps/writing-vue/package.json', import.meta.url))
const { ref, reactive, computed, watch, nextTick, effectScope } = appRequire('vue')
const assets = [
  { id: 'judgement-1', title: 'Animal intelligence', activity: 'reading', category: 'P1', frequency: 'high', questionKinds: ['judgement'] },
  { id: 'completion-1', title: 'River restoration', activity: 'reading', category: 'P2', frequency: 'medium', questionKinds: ['completion'] },
  { id: 'mixed-1', title: 'Ancient transport', activity: 'reading', category: 'P3', frequency: 'low', questionKinds: ['judgement', 'completion'] }
]

async function flushVue() {
  await nextTick()
  await nextTick()
}

// Execute the actual page with Vue reactivity, watchers and mount callback.
// The router, preference store, repository and DOM are external test doubles.
async function browseState(t, {
  query = { view: 'browse', kind: 'judgement', from: 'weekly-report' },
  savedPreferences = {}
} = {}) {
  const route = reactive({ query: { ...query } })
  const navigations = []
  const scope = effectScope()
  t.after(() => scope.stop())
  let mounted
  const deps = {
    ...browseFilters,
    QUESTION_KIND_LABELS,
    ref, computed, watch, nextTick,
    onMounted: callback => { mounted = callback }, onBeforeUnmount: () => {},
    document: { querySelectorAll: () => [], querySelector: () => null },
    useRoute: () => route,
    useRouter: () => ({ replace: async target => {
      navigations.push(target)
      route.query = target.query
    } }),
    useTauriPreferences: () => ({
      hydrate: async () => {},
      get: (key, fallback) => key === 'browse_view_preferences_v2' ? savedPreferences : fallback
    }),
    useReadingLibrary: () => ({ loadReadingAssets: async () => ({ data: assets }) }),
    useReadingSuite: () => ({}),
    formatTodayLabel: () => 'Today'
  }
  const state = scope.run(() => new Function(...Object.keys(deps), `${script}
    return { readingAssets, filteredReadingAssets, questionKind, questionKindLabel,
      selectedType, selectedCategory, frequencyFilter, keyword, sortMode,
      filterByType, clearQuestionKind, clearSearch, loadAssets, activeView };
  `)(...Object.values(deps)))
  await mounted()
  await flushVue()
  return { ...state, route, navigations }
}

const ids = state => state.filteredReadingAssets.value.map(asset => asset.id)

test('weekly judgement link can return to all and search a completion-only asset', async t => {
  const state = await browseState(t)
  assert.equal(state.questionKindLabel.value, '判断')
  assert.deepEqual(ids(state), ['judgement-1', 'mixed-1'])
  state.selectedCategory.value = 'P1'
  state.keyword.value = 'River restoration'
  assert.deepEqual(ids(state), [])

  await state.filterByType('all')
  await flushVue()

  assert.equal(state.selectedType.value, 'all')
  assert.equal(state.selectedCategory.value, 'all')
  assert.equal(state.questionKindLabel.value, '')
  assert.deepEqual(state.route.query, { view: 'browse', from: 'weekly-report' })
  assert.equal(state.keyword.value, 'River restoration')
  assert.deepEqual(ids(state), ['completion-1'])
  state.clearSearch()
  await flushVue()
  assert.deepEqual(ids(state), ['judgement-1', 'completion-1', 'mixed-1'])
})

test('clear question kind removes only the targeted filter and keeps other browse controls', async t => {
  const state = await browseState(t)
  state.selectedType.value = 'reading'
  state.selectedCategory.value = 'P2'
  state.frequencyFilter.value = 'medium'
  state.sortMode.value = 'difficulty-desc'
  state.keyword.value = 'River'
  assert.deepEqual(ids(state), [])

  await state.clearQuestionKind()
  await flushVue()

  assert.equal(state.selectedType.value, 'reading')
  assert.equal(state.selectedCategory.value, 'P2')
  assert.equal(state.frequencyFilter.value, 'medium')
  assert.equal(state.sortMode.value, 'difficulty-desc')
  assert.equal(state.keyword.value, 'River')
  assert.deepEqual(ids(state), ['completion-1'])
  await state.clearQuestionKind()
  assert.equal(state.navigations.length, 1)
})

test('reading type and search clear preserve the visible question-kind constraint', async t => {
  const state = await browseState(t)
  state.keyword.value = 'River'
  await state.filterByType('reading')
  assert.equal(state.questionKindLabel.value, '判断')
  assert.deepEqual(ids(state), [])
  state.clearSearch()
  await flushVue()
  assert.deepEqual(ids(state), ['judgement-1', 'mixed-1'])
  assert.equal(state.navigations.length, 0)
})

test('route changes recompute the active kind and asset set without stale state', async t => {
  const state = await browseState(t)
  state.route.query.kind = 'completion'
  assert.equal(state.questionKindLabel.value, '填空')
  assert.deepEqual(ids(state), ['completion-1', 'mixed-1'])
  delete state.route.query.kind
  assert.equal(state.questionKindLabel.value, '')
  assert.deepEqual(ids(state), ['judgement-1', 'completion-1', 'mixed-1'])
})

test('saved browse position restores once per visit and cannot override user filter changes', async t => {
  const state = await browseState(t, { savedPreferences: {
    autoScrollEnabled: true,
    lastAssetId: 'judgement-1',
    lastType: 'reading',
    lastCategory: 'P1',
    lastKeyword: 'Animal'
  } })
  assert.equal(state.selectedType.value, 'reading')
  assert.equal(state.selectedCategory.value, 'P1')
  assert.equal(state.keyword.value, 'Animal')
  assert.deepEqual(ids(state), ['judgement-1'])

  await state.filterByType('all')
  state.keyword.value = 'River'
  await flushVue()
  assert.equal(state.selectedType.value, 'all')
  assert.equal(state.selectedCategory.value, 'all')
  assert.equal(state.keyword.value, 'River')
  assert.equal(state.questionKindLabel.value, '')
  assert.deepEqual(ids(state), ['completion-1'])

  // Retrying the asset load in this visit must not reapply old preferences.
  await state.loadAssets()
  await flushVue()
  assert.equal(state.keyword.value, 'River')
  assert.deepEqual(ids(state), ['completion-1'])

  // Navigating away and returning is a new browse visit and still restores.
  state.route.query.view = 'overview'
  await flushVue()
  state.route.query.view = 'browse'
  await flushVue()
  assert.equal(state.selectedType.value, 'reading')
  assert.equal(state.selectedCategory.value, 'P1')
  assert.equal(state.keyword.value, 'Animal')
  assert.deepEqual(ids(state), ['judgement-1'])
})
