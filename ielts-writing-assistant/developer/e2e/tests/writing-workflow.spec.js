const { test, expect } = require('@playwright/test')

const task1PrimaryTopic = {
  id: 'task1-energy-trends',
  title: 'Global Energy Consumption by Source',
  type: 'task1',
  category: 'bar_chart',
  min_words: 10,
  time_limit: 20,
  content:
    'The charts below compare the percentage of energy produced from oil, coal, natural gas, and renewables in four countries between 2000 and 2020.'
}

const task1FollowUpTopic = {
  id: 'task1-renewable-transition',
  title: 'Renewable Energy Transition Targets',
  type: 'task1',
  category: 'line_chart',
  min_words: 10,
  time_limit: 20,
  content:
    'The line graph illustrates the projected share of renewable electricity generation in five countries between 2025 and 2040.'
}

const task2Topic = {
  id: 'task2-education-funding',
  title: 'University Funding Responsibilities',
  type: 'task2',
  category: 'education',
  min_words: 10,
  time_limit: 40,
  content:
    'Some people believe university tuition should be fully paid by governments, while others argue students ought to cover the costs themselves. Discuss both views and give your opinion.'
}

const assessmentPayload = {
  id: 'assessment-001',
  writingId: 'record-123',
  topicTitle: task1PrimaryTopic.title,
  content:
    '<p>This is a fully developed response covering every scoring aspect thoroughly.</p>',
  totalScore: 7.5,
  taskAchievement: 7,
  coherence: 7.5,
  lexicalResource: 7,
  grammar: 7,
  overallFeedback:
    'Your report addresses all key features of the chart. Focus on comparing figures more explicitly to reach a higher band score.',
  suggestions: [
    { category: 'Task Response', text: 'Add clearer trend comparisons between countries.' },
    { category: 'Lexical Resource', text: 'Introduce more varied verbs when describing upward changes.' }
  ]
}

test.describe('IELTS writing compose → evaluate → result flow', () => {
  test.beforeEach(async ({ page }) => {
    let task1RequestIndex = 0

    await page.route('**/api/writing/topics/random**', async route => {
      const url = new URL(route.request().url())
      const type = url.searchParams.get('taskType') || url.searchParams.get('type')
      let payload = task1PrimaryTopic

      if (type === 'task2') {
        payload = task2Topic
      } else if (type === 'task1') {
        payload = task1RequestIndex === 0 ? task1PrimaryTopic : task1FollowUpTopic
        if (task1RequestIndex < 1) {
          task1RequestIndex += 1
        }
      } else if (task1RequestIndex === 0) {
        task1RequestIndex += 1
      }

      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ success: true, data: payload })
      })
    })

    await page.route('**/api/writing/topics**', async route => {
      const url = new URL(route.request().url())
      const type = url.searchParams.get('type') || url.searchParams.get('taskType')
      const payload = type === 'task2' ? task2Topic : task1PrimaryTopic
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ success: true, data: [payload] })
      })
    })

    await page.route('**/api/writing/records**', async route => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ success: true, data: { id: 'record-123' } })
        })
      } else {
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ success: true })
        })
      }
    })

    await page.route('**/api/writing/records/*', async route => {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ success: true })
      })
    })

    await page.route('**/api/assessment/submit', async route => {
      await new Promise(resolve => setTimeout(resolve, 200))
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ success: true, data: assessmentPayload })
      })
    })
  })

  test('user writes an essay, triggers evaluation, and reviews AI feedback', async ({ page }) => {
    await page.goto('/writing')

    await expect(page.getByTestId('writing-top-bar')).toBeVisible()
    await expect(page.getByTestId('topic-headline')).toHaveText(task1PrimaryTopic.title)
    await expect(page.getByTestId('word-count-value')).toHaveText('0')

    const editor = page.getByTestId('essay-editor-input')
    await editor.click()
    const essayDraft =
      'This is a fully developed response covering every scoring aspect thoroughly.'
    await page.keyboard.type(essayDraft)

    await expect(page.getByTestId('word-count-value')).toHaveText('11')
    await expect(page.getByTestId('submit-essay-button')).toBeEnabled()

    await page.getByTestId('submit-essay-button').click()

    await page.waitForURL('**/writing/evaluating')
    await expect(page.getByTestId('evaluation-progress')).toBeVisible()

    await page.waitForURL(/\/writing\/result/)
    await expect(page.getByTestId('result-page')).toBeVisible()
    await expect(page.getByTestId('overall-score')).toHaveText('7.5')
    await expect(page.getByTestId('subscore-list')).toContainText('Task Achievement / Response')
    await expect(page.getByTestId('overall-feedback')).toContainText('comparing figures')

    const suggestions = page.getByTestId('suggestions').locator('[data-test="suggestion-item"]')
    await expect(suggestions).toHaveCount(2)

    await page.getByTestId('action-new-essay').click()
    await page.waitForURL('**/writing')
    await expect(page.getByTestId('topic-headline')).toHaveText(task1FollowUpTopic.title)
    await expect(page.getByTestId('word-count-value')).toHaveText('0')
  })
})
