const { test, expect } = require('@playwright/test')

const task1Topic = {
  id: 'task1-energy-trends',
  title: 'Global Energy Consumption by Source',
  type: 'task1',
  category: 'bar_chart',
  min_words: 10,
  time_limit: 20,
  content:
    'The charts below compare the percentage of energy produced from oil, coal, natural gas, and renewables in four countries between 2000 and 2020.'
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

test.describe('AI provider configuration and navigation controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/writing/topics/random**', async route => {
      const url = new URL(route.request().url())
      const type = url.searchParams.get('taskType') || url.searchParams.get('type')
      const payload = type === 'task2' ? task2Topic : task1Topic
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ success: true, data: payload })
      })
    })

    await page.route('**/api/writing/topics**', async route => {
      const url = new URL(route.request().url())
      const type = url.searchParams.get('type') || url.searchParams.get('taskType')
      const payload = type === 'task2' ? task2Topic : task1Topic
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ success: true, data: [payload] })
      })
    })
  })

  test('user switches task type, selects provider/model, and opens settings', async ({ page }) => {
    await page.goto('/writing')

    await expect(page.getByTestId('topic-type-tag')).toHaveText('Task 1 - 图表描述')

    await page.getByTestId('task-type-tab-task2').click()
    await expect(page.getByTestId('topic-type-tag')).toHaveText('Task 2 - 议论文')
    await expect(page.getByTestId('topic-headline')).toHaveText(task2Topic.title)

    await page.locator('[data-test="provider-select"] .el-select__wrapper').click()
    await page.getByRole('option', { name: /DeepSeek/ }).click()
    await expect(page.getByTestId('provider-select')).toContainText('DeepSeek')
    await expect(page.getByTestId('model-select')).toContainText('DeepSeek Chat')

    await page.locator('[data-test="model-select"] .el-select__wrapper').click()
    await page.getByRole('option', { name: /Coder/ }).click()
    await expect(page.getByTestId('model-select')).toContainText('DeepSeek Coder')

    await page.getByTestId('open-settings-button').click()
    await page.waitForURL('**/settings')
    await expect(page.getByTestId('settings-view')).toBeVisible()
  })
})
