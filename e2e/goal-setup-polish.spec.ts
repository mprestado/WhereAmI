import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test('chooses a task list and saves optional, reordered, and reparented work from mobile setup', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Create a goal', exact: true }).click()
  await page.getByRole('textbox', { name: 'Your goal' }).fill('Weekend plans')
  await expect(page.getByRole('radio', { name: 'Journey', exact: true })).toBeChecked()
  await page.getByRole('radio', { name: 'Task list', exact: true }).check()
  await page.getByRole('button', { name: 'Continue' }).click()

  await page.getByRole('textbox', { name: 'Objective 1', exact: true }).fill('Fix the porch')
  const addSubObjective = page.getByRole('button', { name: 'Add sub-objective', exact: true })
  await addSubObjective.click()
  await page.getByRole('textbox', { name: 'Sub-objective 1 for objective 1' }).fill('Buy paint')
  await addSubObjective.click()
  await page.getByRole('textbox', { name: 'Sub-objective 2 for objective 1' }).fill('Pick brushes')
  await page.getByLabel('Actions for sub-objective 2 for objective 1', { exact: true }).click()
  await page.getByRole('button', { name: 'Mark optional', exact: true }).click()
  await page.getByRole('button', { name: 'Move sub-objective 2 for objective 1 up' }).click()
  await expect(page.getByRole('textbox', { name: 'Sub-objective 1 for objective 1' })).toHaveValue('Pick brushes')

  await page.getByRole('button', { name: 'Add objective', exact: true }).click()
  await page.getByRole('textbox', { name: 'Objective 2', exact: true }).fill('Visit town')
  await addSubObjective.last().click()
  await page.getByRole('textbox', { name: 'Sub-objective 1 for objective 2' }).fill('Call the library')
  await page.getByLabel('Actions for objective 2', { exact: true }).click()
  await page.getByRole('button', { name: 'Mark optional', exact: true }).click()
  await page.getByRole('button', { name: 'Move objective 2 up' }).click()
  await expect(page.getByRole('textbox', { name: 'Objective 1', exact: true })).toHaveValue('Visit town')
  await expect(page.getByRole('textbox', { name: 'Sub-objective 1 for objective 2' })).toHaveValue('Pick brushes')
  await page.getByLabel('Actions for sub-objective 1 for objective 2', { exact: true }).click()
  await page.getByRole('combobox', { name: 'Move to objective', exact: true }).selectOption({ label: 'Visit town' })
  await expect(page.getByRole('textbox', { name: 'Sub-objective 2 for objective 1' })).toHaveValue('Pick brushes')
  await expect(page.getByText('Optional', { exact: true })).toHaveCount(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360)

  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page.getByRole('radio', { name: 'Task list', exact: true })).toBeChecked()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Create goal', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Weekend plans' })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Workspace menu' }).click()
  await page.getByRole('button', { name: 'Account and settings' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export workspace' }).click()
  const saved = JSON.parse(await readFile(await (await download).path(), 'utf8')).workspace
  expect(saved.roadmaps).toEqual([expect.objectContaining({ title: 'Weekend plans', presentation: 'list' })])
  const first = saved.objectives.find(({ title }: { title: string }) => title === 'Visit town')
  const second = saved.objectives.find(({ title }: { title: string }) => title === 'Fix the porch')
  expect(first).toMatchObject({ optional: true, position: 0 })
  expect(second).toMatchObject({ optional: false, position: 1 })
  expect(saved.tasks).toEqual(expect.arrayContaining([
    expect.objectContaining({ title: 'Call the library', objectiveId: first.id, optional: false, position: 0 }),
    expect.objectContaining({ title: 'Pick brushes', objectiveId: first.id, optional: true, position: 1 }),
    expect.objectContaining({ title: 'Buy paint', objectiveId: second.id, optional: false, position: 0 }),
  ]))
})
