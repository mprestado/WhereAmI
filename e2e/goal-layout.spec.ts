import { expect, test } from '@playwright/test'

async function createGoal(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Create a goal' }).click()
  await page.getByRole('textbox', { name: 'Your goal' }).fill('Prepare a home workspace')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('textbox', { name: 'Objective 1', exact: true }).fill('Set up the desk')
  await page.getByRole('button', { name: 'Add sub-objective' }).click()
  await page.getByRole('textbox', { name: 'Sub-objective 1 for objective 1' }).fill('Choose a lamp')
  await page.getByRole('button', { name: 'Create goal' }).click()
}

test('switches one goal between Journey and a plain task list without changing its work', async ({ page }) => {
  await createGoal(page)
  const present = page.getByRole('region', { name: 'Present', exact: true })
  await expect(present.getByRole('heading', { name: 'Set up the desk' })).toBeVisible()
  await expect(page.getByRole('progressbar', { name: 'Goal progress' })).toHaveAttribute('value', '0')

  await page.getByRole('button', { name: 'Workspace menu' }).click()
  await page.getByRole('button', { name: 'Goal settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Goal settings' })
  await settings.getByLabel('Layout').selectOption('list')
  await settings.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('region', { name: 'Task list' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Set up the desk' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Present' })).toHaveCount(0)
  await expect(page.getByText('Roadmap', { exact: true })).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('region', { name: 'Task list' })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Complete Choose a lamp' })).toBeVisible()

  await page.getByRole('button', { name: 'Workspace menu' }).click()
  await page.getByRole('button', { name: 'Goal settings' }).click()
  await page.getByRole('dialog', { name: 'Goal settings' }).getByLabel('Layout').selectOption('journey')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('region', { name: 'Present', exact: true }).getByRole('heading', { name: 'Set up the desk' })).toBeVisible()
  await page.getByRole('checkbox', { name: 'Complete Choose a lamp' }).click()
  await expect(page.getByRole('region', { name: 'Past', exact: true }).getByText('Set up the desk')).toBeVisible()
  await expect(page.getByRole('progressbar', { name: 'Goal progress' })).toHaveAttribute('value', '100')
})
