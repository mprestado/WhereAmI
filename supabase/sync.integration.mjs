import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { PGlite } from '@electric-sql/pglite'
import { chromium } from '@playwright/test'
import { createServer as createViteServer } from 'vite'

const db = new PGlite()
const userId = randomUUID()
const email = 'test-user@example.invalid'
const authTokens = new Set()
let vite
let browser

// This test-only adapter sends the published client's RPCs to real PostgreSQL
// code. It issues simulated auth sessions and exposes no product data.
const api = createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Headers', '*')
  response.setHeader('Content-Type', 'application/json')
  if (request.method === 'OPTIONS') return response.writeHead(204).end()

  function send(status, payload) {
    response.writeHead(status)
    response.end(JSON.stringify(payload))
  }

  try {
    const path = new URL(request.url, 'http://127.0.0.1').pathname
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8')
    const body = raw ? JSON.parse(raw) : {}

    if (path === '/auth/v1/token' && body.email === email) {
      const expires_at = Math.floor(Date.now() / 1000) + 3_600
      const claims = Buffer.from(JSON.stringify({ sub: userId, role: 'authenticated', exp: expires_at })).toString('base64url')
      const access_token = 'eyJhbGciOiJub25lIn0.' + claims + '.' + randomUUID()
      authTokens.add(access_token)
      return send(200, {
        access_token, expires_at, expires_in: 3_600, token_type: 'bearer', refresh_token: randomUUID(),
        user: { id: userId, email, role: 'authenticated', aud: 'authenticated', app_metadata: {}, user_metadata: {} },
      })
    }
    if (!authTokens.has(request.headers.authorization?.slice(7))) {
      return send(401, { code: '42501', message: 'The test account is signed out.' })
    }

    if (path === '/auth/v1/logout') {
      authTokens.delete(request.headers.authorization.slice(7))
      return response.writeHead(204).end()
    }
    if (path === '/rest/v1/rpc/get_workspace') {
      const result = await db.query('select public.get_workspace() as data')
      return send(200, result.rows[0].data)
    }
    if (path === '/rest/v1/rpc/commit_workspace_v2' || path === '/rest/v1/rpc/commit_workspace_v3') {
      const procedure = path.endsWith('_v3') ? 'commit_workspace_v3' : 'commit_workspace_v2'
      const result = await db.query(`select public.${procedure}($1,$2,$3) as data`, [
        body.p_expected_owner, body.p_batch_id, JSON.stringify(body.p_changes),
      ])
      return send(200, result.rows[0].data)
    }
    return send(404, { code: 'PGRST202', message: 'Unknown test endpoint.' })
  } catch (error) {
    return send(error.code?.startsWith('40') ? 409 : 400, { code: error.code, message: error.message })
  }
})

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon, authenticated;
  `)
  await db.query('insert into auth.users (id) values ($1)', [userId])
  await db.exec(await readFile(new URL('./migrations/202611230001_workspace.sql', import.meta.url), 'utf8'))
  await db.exec(await readFile(new URL('./migrations/202611230002_goal_presentation.sql', import.meta.url), 'utf8'))
  await db.exec(await readFile(new URL('./migrations/202611240003_count_trackers.sql', import.meta.url), 'utf8'))
  await db.exec('set role authenticated')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId])
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve))
  process.env.VITE_SUPABASE_URL = 'http://127.0.0.1:' + api.address().port
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'whereami-integration-test-only'

  vite = await createViteServer({ server: { host: '127.0.0.1', port: 14980, strictPort: true } })
  await vite.listen()
  const url = 'http://127.0.0.1:14980/supabase/fixtures/storage.html'
  browser = await chromium.launch(process.env.WHEREAMI_BROWSER_CHANNEL
    ? { channel: process.env.WHEREAMI_BROWSER_CHANNEL }
    : {})

  const deviceOne = await browser.newContext()
  const deviceTwo = await browser.newContext()
  const first = await deviceOne.newPage()
  const second = await deviceTwo.newPage()
  for (const page of [first, second]) {
    await page.goto(url)
    await page.waitForFunction(() => window.storageHarness?.syncState === 'local')
    await page.evaluate(email => window.storageHarness.signIn(email, 'test-password'), email)
    await page.waitForFunction(() => window.storageHarness?.syncState === 'saved')
  }

  await first.evaluate(() => window.storageHarness.addTask('Captured on device one'))
  await first.waitForFunction(() =>
    window.storageHarness.syncState === 'saved' && window.storageHarness.data.tasks[0]?.title === 'Captured on device one')
  const taskId = await first.evaluate(() => window.storageHarness.data.tasks[0].id)
  await second.evaluate(() => window.storageHarness.refresh())
  await second.waitForFunction(() => window.storageHarness.data.tasks[0]?.title === 'Captured on device one')

  await deviceTwo.setOffline(true)
  await second.waitForFunction(() => window.storageHarness.syncState === 'offline')
  await second.evaluate(() => window.storageHarness.addTask('Queued offline on device two'))
  await second.waitForFunction(() => window.storageHarness.pending === 1)
  assert.equal(await second.evaluate(() => window.storageHarness.syncState), 'offline')
  await deviceTwo.setOffline(false)
  await second.waitForFunction(() => window.storageHarness.pending === 0 && window.storageHarness.syncState === 'saved')
  await first.evaluate(() => window.storageHarness.refresh())
  await first.waitForFunction(() => window.storageHarness.data.tasks.some(task => task.title === 'Queued offline on device two'))

  const failRpc = route => route.abort()
  const rpc = '**/rest/v1/rpc/**'
  await deviceTwo.route(rpc, failRpc)
  await second.evaluate(id => window.storageHarness.renameTask(id, 'Retained after a failed request'), taskId)
  await second.waitForFunction(() => window.storageHarness.pending === 1 && window.storageHarness.syncState === 'failed')
  await second.reload()
  await second.waitForFunction(() => window.storageHarness.pending === 1 && window.storageHarness.syncState === 'failed')
  assert.ok(await second.evaluate(() =>
    window.storageHarness.getExport().pendingBatches[0].changes[0].record.title === 'Retained after a failed request'))

  await first.evaluate(id => window.storageHarness.renameTask(id, 'Accepted remote edit'), taskId)
  await first.waitForFunction(() => window.storageHarness.pending === 0 &&
    window.storageHarness.syncState === 'saved' &&
    window.storageHarness.data.tasks.some(task => task.title === 'Accepted remote edit'))
  await deviceTwo.unroute(rpc, failRpc)
  await second.evaluate(() => window.storageHarness.refresh())
  await second.waitForFunction(() => window.storageHarness.pending === 1 &&
    window.storageHarness.syncState === 'failed' && window.storageHarness.syncError.includes('another device'))
  await second.evaluate(() => window.storageHarness.discardPending())
  await second.waitForFunction(() => window.storageHarness.pending === 0 &&
    window.storageHarness.data.tasks.some(task => task.title === 'Accepted remote edit'))

  await deviceTwo.setOffline(true)
  await second.waitForFunction(() => window.storageHarness.syncState === 'offline')
  await second.evaluate(() => window.storageHarness.addGoalWithOptionalWork())
  await second.waitForFunction(() => window.storageHarness.pending === 5)
  await deviceTwo.setOffline(false)
  await second.waitForFunction(() => window.storageHarness.pending === 0 && window.storageHarness.syncState === 'saved')
  await first.evaluate(() => window.storageHarness.refresh())
  await first.waitForFunction(() => {
    const { roadmaps, objectives, tasks, checklistItems } = window.storageHarness.data
    const goal = roadmaps.find(item => item.title === 'Unordered list')
    const objective = objectives.find(item => item.title === 'Optional objective')
    const task = tasks.find(item => item.title === 'Ordered sub-objective')
    const check = checklistItems.find(item => item.title === 'Optional check')
    return goal?.presentation === 'list' && objective?.optional === true && objective.goalPosition === 0
      && task?.optional === true && task.position === 1 && task.roadmapId === goal.id
      && task.objectiveId === objective.id && check?.optional === true && check.objectiveId === objective.id
  })

  await first.evaluate(() => window.storageHarness.addTrackedTask('Certificates', 3))
  await first.waitForFunction(() => window.storageHarness.syncState === 'saved' && window.storageHarness.pending === 0
    && window.storageHarness.data.tasks.some(task => task.title === 'Certificates' && task.countTarget === 3))
  const countId = await first.evaluate(() => window.storageHarness.data.tasks.find(task => task.title === 'Certificates').id)
  await deviceOne.setOffline(true)
  await first.waitForFunction(() => window.storageHarness.syncState === 'offline')
  await first.evaluate(async id => {
    const { adjustWorkspaceCount } = window.storageHarness
    await Promise.all(Array.from({ length: 3 }, () => adjustWorkspaceCount('tasks', id, 1)))
  }, countId)
  await first.waitForFunction(id => window.storageHarness.pending === 3
    && window.storageHarness.data.tasks.some(task => task.id === id && task.countValue === 3 && task.status === 'completed'), countId)
  await deviceOne.setOffline(false)
  await first.waitForFunction(() => window.storageHarness.syncState === 'saved' && window.storageHarness.pending === 0)
  await second.evaluate(() => window.storageHarness.refresh())
  await second.waitForFunction(id => window.storageHarness.data.tasks
    .some(task => task.id === id && task.countValue === 3 && task.status === 'completed'), countId)
  await second.evaluate(id => window.storageHarness.adjustWorkspaceCount('tasks', id, -1), countId)
  await second.waitForFunction(() => window.storageHarness.syncState === 'saved' && window.storageHarness.pending === 0)
  await first.evaluate(() => window.storageHarness.refresh())
  await first.waitForFunction(id => window.storageHarness.data.tasks
    .some(task => task.id === id && task.countValue === 2 && task.status === 'active'), countId)

  await first.evaluate(() => window.storageHarness.signOut())
  await first.waitForFunction(() => window.storageHarness.syncState === 'local' &&
    window.storageHarness.session === null && window.storageHarness.data.tasks.length === 0)
  assert.ok(await second.evaluate(() => window.storageHarness.session !== null))

  // Copy a local-only hierarchy into an account that already has cloud work.
  await first.evaluate(async () => {
    await window.storageHarness.addGoalWithOptionalWork()
    await window.storageHarness.addTask('Local before sign-in')
  })
  await first.waitForFunction(() => window.storageHarness.data.tasks.some(task => task.title === 'Local before sign-in'))
  const localIds = await first.evaluate(() => ({
    goal: window.storageHarness.data.roadmaps[0].id,
    objective: window.storageHarness.data.objectives[0].id,
    task: window.storageHarness.data.tasks.find(task => task.title === 'Local before sign-in').id,
  }))
  await first.evaluate(email => window.storageHarness.signIn(email, 'test-password'), email)
  await first.waitForFunction(() => window.storageHarness.syncState === 'saved' && window.storageHarness.deviceRecordCount === 6)
  const copy = await first.evaluate(() => window.storageHarness.copyDeviceWorkspace())
  assert.equal(copy.recordKeys.length, 6)
  assert.equal(copy.unavailable, 0)
  await first.waitForFunction(keys => window.storageHarness.isDeviceCopyConfirmed(keys), copy.recordKeys)
  await second.evaluate(() => window.storageHarness.refresh())
  await second.waitForFunction(({ goal, objective, task }) => {
    const data = window.storageHarness.data
    return data.roadmaps.some(row => row.id === goal && row.presentation === 'list')
      && data.objectives.some(row => row.id === objective && row.optional)
      && data.tasks.some(row => row.objectiveId === objective && row.roadmapId === goal && row.position === 1)
      && data.checklistItems.some(row => row.objectiveId === objective && row.optional)
      && data.tasks.some(row => row.id === task)
      && data.tasks.some(row => row.title === 'Accepted remote edit')
  }, localIds)
  assert.equal((await first.evaluate(() => window.storageHarness.copyDeviceWorkspace())).recordKeys.length, 0)

  await second.evaluate(id => window.storageHarness.commit([{ table: 'tasks', deleteId: id }]), localIds.task)
  await second.waitForFunction(id => window.storageHarness.syncState === 'saved' && !window.storageHarness.data.tasks.some(row => row.id === id), localIds.task)
  assert.equal((await first.evaluate(() => window.storageHarness.copyDeviceWorkspace())).recordKeys.length, 0)
  await first.evaluate(() => window.storageHarness.signOut())
  await first.waitForFunction(id => window.storageHarness.syncState === 'local' && window.storageHarness.data.tasks.some(row => row.id === id), localIds.task)

  console.log('Passed cross-client reads, offline replay, rapid offline count changes and reopening from another device, failed-request recovery, conflict handling, sign-out isolation, and repeat-safe local workspace copy.')
} finally {
  await browser?.close()
  await vite?.close()
  await new Promise(resolve => {
    api.close(resolve)
    api.closeAllConnections()
  })
  await db.close()
}

