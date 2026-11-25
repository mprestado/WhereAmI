import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdir, mkdtemp } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { text } from 'node:stream/consumers'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, expect } from '@playwright/test'

assert.equal(process.platform, 'win32', 'Run the desktop smoke test on Windows')
const target = process.env.CARGO_TARGET_DIR ?? 'src-tauri/target'
const exe = resolve(process.argv[2] ?? join(target, 'release', 'whereami.exe'))
const legacyExe = process.argv[3] ? resolve(process.argv[3]) : null
await access(exe)
if (legacyExe) await access(legacyExe)
const resultsDirectory = resolve('test-results')
await mkdir(resultsDirectory, { recursive: true })
const profile = await mkdtemp(join(resultsDirectory, 'desktop-profile-'))

async function startDesktop(executable = exe, userData = profile) {
  const reservation = createServer().listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const { port } = reservation.address()
  await new Promise((done, fail) => reservation.close(error => error ? fail(error) : done()))
  const endpoint = `http://127.0.0.1:${port}`
  const application = spawn(executable, [], {
    env: {
      ...process.env,
      WEBVIEW2_USER_DATA_FOLDER: userData,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`,
    },
    stdio: 'inherit',
    windowsHide: true,
  })
  let browser
  const exited = once(application, 'exit')
  async function stop() {
    await browser?.close().catch(() => {})
    if (application.exitCode === null && application.signalCode === null) application.kill()
    await exited
  }

  try {
    let ready = false
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (application.exitCode !== null) throw new Error(`WhereAmI exited with code ${application.exitCode}`)
      ready = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(300) })
        .then(response => response.ok, () => false)
      if (ready) break
      await delay(250)
    }
    assert.ok(ready, 'WebView2 did not provide its local test endpoint')
    browser = await chromium.connectOverCDP(endpoint, { timeout: 10_000 })
    const context = browser.contexts()[0]
    const page = context.pages()[0] ?? await context.waitForEvent('page', { timeout: 10_000 })
    await page.waitForURL(url => url.hostname === 'tauri.localhost', { timeout: 10_000 })
    return { page, stop, processId: application.pid }
  } catch (error) {
    await stop().catch(() => {})
    throw error
  }
}

async function captureTask(page, title) {
  await page.keyboard.press('Control+Shift+Space')
  const dialog = page.getByRole('dialog', { name: /quick capture/i })
  const target = dialog.getByLabel('Quick capture task title')
  await expect(target).toBeFocused()
  await target.fill(title)
  await target.press('Enter')
  await expect(target).toHaveValue('')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
}

async function openWorkspaceMenu(page) {
  await page.getByRole('button', { name: 'Workspace menu', exact: true }).click()
}

async function openTaskView(page, name) {
  await openWorkspaceMenu(page)
  await page.getByText('Tasks', { exact: true }).click()
  await page.getByRole('button', { name, exact: true }).click()
}

function appWindows(processId, hideMain = false) {
  assert.ok(Number.isSafeInteger(processId))
  const result = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
    Add-Type -TypeDefinition @'
    using System;
    using System.Collections.Generic;
    using System.Runtime.InteropServices;
    using System.Text;
    public class WhereAmITest {
      private delegate bool Visit(IntPtr hwnd, IntPtr argument);
      [DllImport("user32.dll")] private static extern bool EnumWindows(Visit callback, IntPtr argument);
      [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
      [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int length);
      [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
      [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr hwnd, int index);
      [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
      public class WindowInfo { public string Title; public bool Visible; public bool Topmost; }
      public static WindowInfo[] Inspect(uint requested, bool closeMain) {
        var results = new List<WindowInfo>();
        EnumWindows((hwnd, argument) => {
          uint owner;
          GetWindowThreadProcessId(hwnd, out owner);
          if (owner != requested) return true;
          var text = new StringBuilder(256);
          GetWindowText(hwnd, text, text.Capacity);
          var title = text.ToString();
          if (title.IndexOf("WhereAmI", StringComparison.OrdinalIgnoreCase) < 0) return true;
          var overlay = title.IndexOf("overlay", StringComparison.OrdinalIgnoreCase) >= 0;
          if (closeMain && !overlay) PostMessage(hwnd, 0x0010, IntPtr.Zero, IntPtr.Zero);
          results.Add(new WindowInfo { Title=title, Visible=IsWindowVisible(hwnd), Topmost=(GetWindowLong(hwnd, -20) & 8) != 0 });
          return true;
        }, IntPtr.Zero);
        return results.ToArray();
      }
    }
'@
    ConvertTo-Json -InputObject @([WhereAmITest]::Inspect(${processId}, ${hideMain ? '$true' : '$false'})) -Compress
  `], { encoding: 'utf8', windowsHide: true, timeout: 10_000 })
  return JSON.parse(result.trim())
}

async function openOverlay(page) {
  const opening = page.context().waitForEvent('page', { timeout: 10_000 })
  await openWorkspaceMenu(page)
  await page.getByRole('button', { name: 'Task overlay', exact: true }).click()
  const overlay = await opening
  await overlay.waitForURL(url => url.hash === '#task-overlay')
  return overlay
}

function viewport(page) {
  return page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
}

const taskTitle = 'Desktop smoke task'
const goalTitle = 'Plan the Windows release'
const firstObjective = 'Prepare the desktop build'
const nextObjective = 'Review the release notes'
const subObjective = 'Verify WebView2'
const first = await startDesktop()
try {
  const page = first.page
  await expect(page.getByRole('button', { name: 'Create a goal' })).toBeVisible()
  await expect(page.getByRole('navigation')).toHaveCount(0)
  await expect.poll(() => page.evaluate(async () => {
    await document.fonts.ready
    await document.fonts.load('16px "DM Sans Variable"', 'WhereAmI')
    await document.fonts.load('16px "Manrope Variable"', 'WhereAmI')
    const extendedManrope = await document.fonts.load('16px "Manrope Variable"', '\u0460')
    return {
      families: Array.from(document.fonts).filter(font => font.status === 'loaded').map(font => font.family.replace(/["']/g, '')),
      cyrillicExtended: extendedManrope.some(font => font.status === 'loaded'),
    }
  })).toEqual({ families: expect.arrayContaining(['DM Sans Variable', 'Manrope Variable']), cyrillicExtended: true })
  await page.getByRole('button', { name: 'Create a goal' }).click()
  await expect(page.getByRole('heading', { name: 'What is your goal?' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Your goal', exact: true }).fill(goalTitle)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Objectives' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Objective 1', exact: true }).fill(firstObjective)
  await page.getByRole('button', { name: 'Add sub-objective', exact: true }).click()
  await page.getByRole('textbox', { name: 'Sub-objective 1 for objective 1', exact: true }).fill(subObjective)
  await page.getByRole('button', { name: 'Add objective', exact: true }).click()
  await page.getByRole('textbox', { name: 'Objective 2', exact: true }).fill(nextObjective)
  await page.getByRole('button', { name: 'Create goal', exact: true }).click()
  await expect(page.getByRole('heading', { name: goalTitle, level: 1 })).toBeVisible()
  const navigation = page.getByRole('navigation', { name: 'Choose an objective' })
  const firstDot = navigation.getByRole('button', { name: 'Show objective 1: ' + firstObjective })
  const nextDot = navigation.getByRole('button', { name: 'Show objective 2: ' + nextObjective })
  await expect(firstDot).toHaveAttribute('aria-current', 'step')
  const dock = await navigation.boundingBox()
  assert.ok(dock, 'Windows shows the objective controls')
  await navigation.getByRole('button', { name: 'Next objective' }).click()
  await expect(nextDot).toHaveAttribute('aria-current', 'step')
  await navigation.getByRole('button', { name: 'Previous objective' }).click()
  await expect(firstDot).toHaveAttribute('aria-current', 'step')
  assert.equal((await navigation.boundingBox()).y, dock.y)
  await expect(page.getByRole('progressbar', { name: 'Goal progress' })).toHaveJSProperty('value', 0)
  const fullSize = await viewport(page)
  const overlayPage = await openOverlay(page)
  const overlay = overlayPage.getByRole('main', { name: 'Task overlay' })
  const overlayCheck = overlay.getByRole('checkbox', { name: 'Complete ' + subObjective, exact: true })
  const overlayNavigation = overlay.getByRole('navigation', { name: 'Overlay objectives' })
  const overlayPrevious = overlayNavigation.getByRole('button', { name: 'Previous objective', exact: true })
  const overlayNext = overlayNavigation.getByRole('button', { name: 'Next objective', exact: true })
  await expect(overlayCheck).toBeVisible()
  await expect.poll(async () => {
    const footer = await overlayNavigation.boundingBox()
    return footer ? Math.abs((await viewport(overlayPage)).height - footer.y - footer.height) : Infinity
  }, { message: 'Overlay navigation stays at the bottom of its window' }).toBeLessThan(4)
  const expandedSize = await viewport(overlayPage)
  assert.ok(expandedSize.width < fullSize.width && expandedSize.height < fullSize.height)
  const openWindows = appWindows(first.processId)
  assert.ok(openWindows.some(window => window.Visible && window.Topmost && /overlay/i.test(window.Title)), 'The overlay is its own topmost window')
  assert.ok(openWindows.some(window => window.Visible && !window.Topmost && !/overlay/i.test(window.Title)), 'The full window remains open independently')
  await expect(overlayNavigation.getByText('1 of 2', { exact: true })).toBeVisible()
  await expect(overlayPrevious).toBeDisabled()
  const overlayDock = await overlayNavigation.boundingBox()
  assert.ok(overlayDock)
  await overlayNext.click()
  await expect(overlay.getByRole('heading', { name: nextObjective })).toBeVisible()
  await expect(overlayCheck).toBeHidden()
  await expect(overlayNavigation.getByText('2 of 2', { exact: true })).toBeVisible()
  await expect(overlayNext).toBeDisabled()
  assert.equal((await overlayNavigation.boundingBox()).y, overlayDock.y)
  await overlay.getByRole('button', { name: 'Collapse task overlay' }).click()
  await expect(overlayNavigation).toBeHidden()
  await overlay.getByRole('button', { name: 'Expand task overlay' }).click()
  await expect(overlay.getByRole('heading', { name: nextObjective })).toBeVisible()
  await overlayPrevious.click()
  await expect(overlayCheck).toBeVisible()
  await expect(overlayPrevious).toBeDisabled()
  await overlay.getByRole('button', { name: 'Collapse task overlay' }).click()
  await expect(overlay.getByRole('button', { name: 'Expand task overlay' })).toBeVisible()
  await expect(overlayCheck).toBeHidden()
  await expect(overlayNavigation).toBeHidden()
  await expect.poll(async () => (await viewport(overlayPage)).height).toBeLessThan(90)
  assert.ok(appWindows(first.processId).some(window => window.Visible && window.Topmost && /overlay/i.test(window.Title)))
  await overlayPage.reload()
  await expect(overlay.getByRole('button', { name: 'Expand task overlay' })).toBeVisible()
  await overlay.getByRole('button', { name: 'Expand task overlay' }).click()
  await expect(overlayCheck).toBeVisible()
  await expect.poll(() => viewport(overlayPage)).toEqual(expandedSize)
  appWindows(first.processId, true)
  await expect.poll(() => appWindows(first.processId).some(window => !window.Visible && !/overlay/i.test(window.Title))).toBe(true)
  await expect(overlayCheck).toBeVisible()
  await overlayCheck.click()
  await expect(overlay.getByText(nextObjective, { exact: true }).first()).toBeVisible()
  await expect(overlayNavigation.getByText('2 of 2', { exact: true })).toBeVisible()
  await overlay.getByRole('button', { name: 'Open full app' }).click()
  await expect.poll(() => appWindows(first.processId).some(window => window.Visible && !/overlay/i.test(window.Title))).toBe(true)
  await expect(overlay).toBeVisible()
  await expect.poll(() => viewport(page)).toEqual(fullSize)
  const closing = overlayPage.waitForEvent('close')
  await overlay.getByRole('button', { name: 'Close task overlay' }).click()
  await closing
  await expect(nextDot).toHaveAttribute('aria-current', 'step')
  await expect(page.getByRole('progressbar', { name: 'Goal progress' })).toHaveJSProperty('value', 50)
  await captureTask(page, taskTitle)
  await openTaskView(page, 'Inbox')
  await expect(page.getByRole('button', { name: taskTitle, exact: true })).toBeVisible()
} finally {
  await first.stop()
}

const second = await startDesktop()
try {
  await expect(second.page.getByRole('heading', { name: goalTitle, level: 1 })).toBeVisible()
  await expect(second.page.getByRole('button', { name: 'Show objective 2: ' + nextObjective })).toHaveAttribute('aria-current', 'step')
  await openTaskView(second.page, 'Inbox')
  await expect(second.page.getByRole('button', { name: taskTitle, exact: true })).toBeVisible()
  await second.page.getByRole('checkbox', { name: `Complete ${taskTitle}` }).click()
  await expect(second.page.getByRole('button', { name: taskTitle, exact: true })).toBeHidden()
  await openWorkspaceMenu(second.page)
  await second.page.getByRole('button', { name: 'Account and settings', exact: true }).click()
  const downloading = second.page.waitForEvent('download', { timeout: 10_000 })
  await second.page.getByRole('button', { name: 'Export workspace' }).click()
  const download = await downloading
  const exported = JSON.parse(await text(await download.createReadStream()))
  const goal = exported.workspace.roadmaps.find(roadmap => roadmap.title === goalTitle)
  assert.ok(goal, 'Export contains the newly created goal')
  assert.ok(exported.workspace.tasks.some(task => task.title === subObjective && task.roadmapId === goal.id && task.status === 'completed'))
  assert.ok(exported.workspace.tasks.some(task => task.title === taskTitle && task.status === 'completed'))
  console.log('Desktop WebView2 smoke passed: separate topmost overlay, main-window close to tray, objective navigation, collapse, shared completion, relaunch, quick capture, and JSON export.')
} finally {
  await second.stop()
}

const trackerProfile = await mkdtemp(join(resultsDirectory, 'desktop-trackers-'))
const trackers = await startDesktop(exe, trackerProfile)
try {
  const page = trackers.page
  const title = 'Collect the certificates'
  const objective = 'Request certificates'
  const subObjective = 'File the copies'
  await page.getByRole('button', { name: 'Create a goal' }).click()
  await page.getByRole('textbox', { name: 'Your goal', exact: true }).fill(title)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('textbox', { name: 'Objective 1', exact: true }).fill(objective)
  await page.getByLabel('Actions for objective 1', { exact: true }).click()
  await page.getByRole('button', { name: 'Set count target', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Count target for objective 1', exact: true }).fill('2')
  await page.getByRole('button', { name: 'Add sub-objective', exact: true }).click()
  await page.getByRole('textbox', { name: 'Sub-objective 1 for objective 1', exact: true }).fill(subObjective)
  await page.getByLabel('Actions for sub-objective 1 for objective 1', { exact: true }).click()
  await page.getByRole('button', { name: 'Set count target', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Count target for sub-objective 1 for objective 1', exact: true }).fill('3')
  await page.getByRole('button', { name: 'Create goal', exact: true }).click()
  const objectiveCount = page.getByRole('group', { name: 'Count for ' + objective, exact: true })
  const copyCount = page.getByRole('group', { name: 'Count for ' + subObjective, exact: true })
  await expect(objectiveCount.getByText('0/2', { exact: true })).toBeVisible()
  await expect(copyCount.getByText('0/3', { exact: true })).toBeVisible()
  await expect(objectiveCount.getByRole('button', { name: 'Decrease count for ' + objective })).toBeDisabled()
  await objectiveCount.getByRole('button', { name: 'Increase count for ' + objective }).click()
  await expect(objectiveCount.getByText('1/2', { exact: true })).toBeVisible()
  await expect(page.getByRole('progressbar', { name: 'Goal progress' })).toHaveJSProperty('value', 0)
  await objectiveCount.getByRole('button', { name: 'Increase count for ' + objective }).click()
  await expect(page.getByRole('progressbar', { name: 'Goal progress' })).toHaveJSProperty('value', 50)

  const overlayPage = await openOverlay(page)
  const overlay = overlayPage.getByRole('main', { name: 'Task overlay' })
  const overlayPercent = overlay.locator('.task-overlay-goal-percent')
  await expect(overlayPercent).toHaveText('50%')
  const heading = overlay.getByRole('heading', { name: objective, exact: true })
  const baseSize = await heading.evaluate(element => parseFloat(getComputedStyle(element).fontSize))
  await overlay.getByText('Aa', { exact: true }).click()
  const zoom = overlay.getByRole('group', { name: 'Overlay text size' })
  await zoom.getByRole('button', { name: 'Increase text size' }).click()
  await expect.poll(() => heading.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThan(baseSize)
  await zoom.getByRole('button', { name: 'Text size 110%, reset to 100%' }).click()
  await expect.poll(() => heading.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBe(baseSize)
  await overlay.getByText('Aa', { exact: true }).click()
  await overlayPage.keyboard.press('Control+-')
  await expect.poll(() => heading.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeLessThan(baseSize)
  await overlayPage.keyboard.press('Control+0')
  await expect.poll(() => heading.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBe(baseSize)
  const copyCounter = overlay.getByRole('group', { name: 'Count for ' + subObjective, exact: true })
  await expect(copyCounter.getByText('0/3', { exact: true })).toBeVisible()
  for (const value of [1, 2, 3]) {
    await copyCounter.getByRole('button', { name: 'Increase count for ' + subObjective }).click()
    await expect(copyCounter.getByText(value + '/3', { exact: true })).toBeVisible()
  }
  await expect(overlayPercent).toHaveText('100%')
  await expect(copyCounter.getByRole('button', { name: 'Increase count for ' + subObjective })).toBeDisabled()
  await copyCounter.getByRole('button', { name: 'Decrease count for ' + subObjective }).click()
  await expect(copyCounter.getByText('2/3', { exact: true })).toBeVisible()
  await expect(overlayPercent).toHaveText('50%')
  await overlayPage.reload()
  await expect(copyCounter.getByText('2/3', { exact: true })).toBeVisible()
  await overlay.getByRole('button', { name: 'Open full app' }).click()
  await expect(page.getByRole('progressbar', { name: 'Goal progress' })).toHaveJSProperty('value', 50)
  console.log('Desktop count tracker smoke passed: main and sub-objective setup, counter limits, shared overlay updates, and persistence.')
} finally {
  await trackers.stop()
}

if (legacyExe) {
  const upgradeProfile = await mkdtemp(join(resultsDirectory, 'desktop-upgrade-profile-'))
  const legacy = await startDesktop(legacyExe, upgradeProfile)
  const legacyGoal = 'Legacy desktop roadmap'
  const legacyObjective = 'Retain the existing objective'
  const legacyChecklist = 'Retain the existing checklist'
  const legacyTask = 'Retain the existing Inbox task'
  async function createLegacyRecord(page, trigger, name, title, afterTitle) {
    await page.getByRole('button', { name: trigger, exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'New ' + name })
    await dialog.getByLabel('Title', { exact: true }).fill(title)
    await afterTitle?.(dialog)
    await dialog.getByRole('button', { name: 'Create ' + name }).click()
    await expect(dialog).toBeHidden()
  }
  try {
    await expect(legacy.page.getByRole('button', { name: 'On this device' })).toBeVisible()
    await captureTask(legacy.page, legacyTask)
    await legacy.page.getByRole('link', { name: 'Roadmaps', exact: true }).click()
    await createLegacyRecord(legacy.page, 'New roadmap', 'roadmap', legacyGoal)
    await createLegacyRecord(legacy.page, 'Add phase', 'phase', 'Existing phase')
    await createLegacyRecord(legacy.page, 'Add main objective', 'main objective', legacyObjective, async dialog => {
      await dialog.getByRole('button', { name: 'Add checklist item' }).click()
      await dialog.getByLabel('Checklist item 1', { exact: true }).fill(legacyChecklist)
    })
  } finally {
    await legacy.stop()
  }
  const upgraded = await startDesktop(exe, upgradeProfile)
  try {
    await expect(upgraded.page.getByRole('heading', { name: legacyGoal, level: 1 })).toBeVisible()
    await expect(upgraded.page.getByRole('button', { name: 'Show objective 1: ' + legacyObjective })).toHaveAttribute('aria-current', 'step')
    await expect(upgraded.page.getByRole('checkbox', { name: 'Complete ' + legacyChecklist })).toBeVisible()
    await openTaskView(upgraded.page, 'Inbox')
    await expect(upgraded.page.getByRole('button', { name: legacyTask, exact: true })).toBeVisible()
    console.log('Desktop upgrade passed: the revised app displayed the goal, checklist, and Inbox record created by the earlier Windows release.')
  } finally {
    await upgraded.stop()
  }
}
