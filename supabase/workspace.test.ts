import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const alice = randomUUID()
const bob = randomUUID()
const now = '2026-11-23T00:00:00.000Z'
const workspaceMigration = new URL('./migrations/202611230001_workspace.sql', import.meta.url)
const goalMigration = new URL('./migrations/202611230002_goal_presentation.sql', import.meta.url)
const countMigration = new URL('./migrations/202611240003_count_trackers.sql', import.meta.url)
const legacy = {
  roadmap: randomUUID(), phase: randomUUID(), objective: randomUUID(), task: randomUUID(),
  checklist: randomUUID(), revision: randomUUID(),
}

type Json = {
  owner_id: string
  version: number
  tasks: { id: string; title: string; revision: string; objective_id: string | null; optional: boolean; position: number | null }[]
  milestones: { id: string; phase_id: string | null; revision: string }[]
  objectives: { id: string; optional: boolean; goal_position: number | null; revision: string }[]
  roadmaps: { id: string; revision: string; presentation: 'journey' | 'list' }[]
  phases: { id: string }[]
  checklist_items: { id: string; optional: boolean; revision: string }[]
}

let db: PGlite
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    create publication supabase_realtime;
  `)
  await db.query('insert into auth.users (id) values ($1), ($2)', [alice, bob])
  await db.exec(await readFile(workspaceMigration, 'utf8'))
  await useAccount(alice)
  await commit(alice, [
    put('roadmaps', legacy.roadmap, roadmap()),
    put('phases', legacy.phase, { roadmap_id: legacy.roadmap, title: 'Build', description: '', position: 0 }),
    put('objectives', legacy.objective, legacyObjective()),
    put('tasks', legacy.task, legacyTask()),
    put('checklist_items', legacy.checklist, legacyChecklist()),
  ], legacy.revision, 1)
  await expect(commit(alice, [put('tasks', randomUUID(), task())])).rejects.toMatchObject({ code: '42883' })
  await db.exec('reset role')
  await db.exec(await readFile(goalMigration, 'utf8'))
  await db.exec(await readFile(countMigration, 'utf8'))
}, 30_000)

afterAll(async () => { await db?.close() })

async function useAccount(id: string) {
  await db.exec('reset role; set role authenticated;')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id])
}

function task(title = 'Plan the next step', fields = {}) {
  return {
    title, description: '', status: 'active', priority: 'none', inbox: true, due_date: null,
    planned_date: null, roadmap_id: null, objective_id: null, completed_at: null, ...fields,
  }
}

function roadmap() {
  return {
    title: 'Finish the app', purpose: 'Find the next step', starting_point: 'A plan', outcome: 'A usable app',
    start_date: '2026-11-23', target_date: '2027-01-12', archived: false,
  }
}

function legacyObjective() {
  return { phase_id: legacy.phase, parent_id: null, description: '', title: 'Objective', position: 0, completed: false }
}

function legacyTask() {
  return task('Old task', { roadmap_id: legacy.roadmap, objective_id: legacy.objective, inbox: false })
}

function legacyChecklist() {
  return { title: 'Old check', objective_id: legacy.objective, position: 0, completed: false }
}

function put(table: string, id: string, record: object, expected: string | null = null) {
  return { table, id, op: 'put', expected_revision: expected, record: { created_at: now, updated_at: now, ...record } }
}

function remove(table: string, id: string, expected: string) {
  return { table, id, op: 'delete', expected_revision: expected }
}

async function commit(owner: string, changes: object[], batch = randomUUID(), version: 1 | 2 | 3 = 2) {
  const rpc = version === 1 ? 'commit_workspace' : 'commit_workspace_v' + version
  const result = await db.query<{ workspace: Json }>(
    `select public.${rpc}($1,$2,$3::jsonb) as workspace`, [owner, batch, JSON.stringify(changes)],
  )
  return result.rows[0].workspace
}

async function getWorkspace() {
  const result = await db.query<{ workspace: Json }>('select public.get_workspace() as workspace')
  return result.rows[0].workspace
}

describe('workspace migration', () => {
  it('applies defaults to existing records and preserves new fields when a legacy client writes', async () => {
    await useAccount(alice)
    const previous = await getWorkspace()
    expect(previous.roadmaps.find(row => row.id === legacy.roadmap)).toMatchObject({
      presentation: 'journey', revision: legacy.revision,
    })
    expect(previous.objectives.find(row => row.id === legacy.objective)).toMatchObject({
      optional: false, goal_position: null, revision: legacy.revision, count_target: null, count_value: 0,
    })
    expect(previous.tasks.find(row => row.id === legacy.task)).toMatchObject({
      optional: false, position: null, revision: legacy.revision,
    })
    expect(previous.checklist_items.find(row => row.id === legacy.checklist)).toMatchObject({
      optional: false, revision: legacy.revision,
    })

    const edit = [
      put('roadmaps', legacy.roadmap, { ...roadmap(), presentation: 'list' }, legacy.revision),
      put('objectives', legacy.objective, { ...legacyObjective(), optional: true, goal_position: 2 }, legacy.revision),
      put('tasks', legacy.task, { ...legacyTask(), optional: true, position: 1 }, legacy.revision),
      put('checklist_items', legacy.checklist, { ...legacyChecklist(), optional: true }, legacy.revision),
    ]
    const revision = randomUUID()
    const updated = await commit(alice, edit, revision)
    expect(await commit(alice, edit, revision, 1)).toEqual(updated)
    const older = await commit(alice, [
      put('roadmaps', legacy.roadmap, { ...roadmap(), title: 'Legacy client renamed goal' }, revision),
      put('objectives', legacy.objective, { ...legacyObjective(), title: 'Legacy client renamed objective' }, revision),
      put('tasks', legacy.task, { ...legacyTask(), title: 'Legacy client renamed task' }, revision),
      put('checklist_items', legacy.checklist, { ...legacyChecklist(), title: 'Legacy client renamed check' }, revision),
    ], randomUUID(), 1)
    expect(older.roadmaps.find(row => row.id === legacy.roadmap)).toMatchObject({
      presentation: 'list', title: 'Legacy client renamed goal',
    })
    expect(older.objectives.find(row => row.id === legacy.objective)).toMatchObject({
      optional: true, goal_position: 2, title: 'Legacy client renamed objective',
    })
    expect(older.tasks.find(row => row.id === legacy.task)).toMatchObject({
      optional: true, position: 1, title: 'Legacy client renamed task',
    })
    expect(older.checklist_items.find(row => row.id === legacy.checklist)).toMatchObject({
      optional: true, title: 'Legacy client renamed check',
    })
  })

  it('rejects invalid presentations and positions and can clear an explicit task position', async () => {
    await useAccount(alice)
    await expect(commit(alice, [
      put('roadmaps', randomUUID(), { ...roadmap(), presentation: 'calendar' }),
    ])).rejects.toMatchObject({ code: '23514' })
    await expect(commit(alice, [
      put('tasks', randomUUID(), task('Invalid order', { position: -1 })),
    ])).rejects.toMatchObject({ code: '23514' })
    const id = randomUUID()
    const firstRevision = randomUUID()
    await commit(alice, [put('tasks', id, task('Explicit position', { position: 2 }))], firstRevision)
    const reset = await commit(alice, [put('tasks', id, task('Cleared position', { position: null }), firstRevision)])
    expect(reset.tasks.find(row => row.id === id)?.position).toBeNull()
  })

  it('persists an Inbox task, scopes reads and writes to the signed-in account, and deduplicates retries', async () => {
    const id = randomUUID()
    const batch = randomUUID()
    await useAccount(alice)
    const first = await commit(alice, [put('tasks', id, task())], batch)
    expect(first.tasks).toContainEqual(expect.objectContaining({ title: 'Plan the next step', id, revision: batch }))
    expect(await getWorkspace()).toEqual(first)
    expect(await commit(alice, [put('tasks', id, task())], batch)).toEqual(first)

    await useAccount(bob)
    expect((await getWorkspace()).tasks).toEqual([])
    expect((await db.query('select id from public.tasks where id = $1', [id])).rows).toEqual([])
    await expect(commit(alice, [remove('tasks', id, batch)])).rejects.toMatchObject({ code: '42501' })
    await expect(db.query('delete from public.tasks where id = $1', [id])).rejects.toMatchObject({ code: '42501' })
    await useAccount(alice)
    expect((await getWorkspace()).tasks.some(row => row.id === id)).toBe(true)
  })

  it('prevents cross-user parents and rolls back a multi-record batch on constraint failure', async () => {
    const roadmapId = randomUUID()
    const taskId = randomUUID()
    await useAccount(alice)
    await commit(alice, [put('roadmaps', roadmapId, roadmap())])

    await useAccount(bob)
    await expect(commit(bob, [
      put('tasks', taskId, task('Valid local task')),
      put('tasks', randomUUID(), task('Cross-account task', { inbox: false, roadmap_id: roadmapId })),
    ])).rejects.toMatchObject({ code: '23503' })
    expect((await getWorkspace()).tasks.find(row => row.id === taskId)).toBeUndefined()
  })

  it('rejects a competing stale edit and keeps the accepted version', async () => {
    const id = randomUUID()
    const firstRevision = randomUUID()
    await useAccount(alice)
    await commit(alice, [put('tasks', id, task('First edit'))], firstRevision)
    await commit(alice, [put('tasks', id, task('Second edit'), firstRevision)])
    await expect(commit(alice, [put('tasks', id, task('Stale edit'), firstRevision)]))
      .rejects.toMatchObject({ code: '40001' })
    expect((await getWorkspace()).tasks.find(row => row.id === id)?.title).toBe('Second edit')
  })

  it('persists counts, keeps old writers compatible, and derives the stored completion from the count', async () => {
    await useAccount(alice)
    const objective = randomUUID()
    const id = randomUUID()
    const item = randomUUID()
    const revision = randomUUID()
    const records = [
      put('objectives', objective, { ...legacyObjective(), count_target: 10, count_value: 9, completed: true }),
      put('tasks', id, task('Collect 10 certificates', { count_target: 10, count_value: 10 })),
      put('checklist_items', item, { ...legacyChecklist(), objective_id: objective, count_target: 2, count_value: 2 }),
    ]
    const saved = await commit(alice, records, revision, 3)
    expect(saved.objectives.find(row => row.id === objective))
      .toMatchObject({ count_target: 10, count_value: 9, completed: false })
    expect(saved.tasks.find(row => row.id === id))
      .toMatchObject({ count_target: 10, count_value: 10, status: 'completed', completed_at: expect.any(String) })
    expect(saved.checklist_items.find(row => row.id === item))
      .toMatchObject({ count_target: 2, count_value: 2, completed: true })
    expect(await commit(alice, records, revision, 3)).toEqual(saved)

    const legacyRevision = randomUUID()
    const renamed = await commit(alice, [put('tasks', id, task('Renamed by old client'), revision)], legacyRevision)
    expect(renamed.tasks.find(row => row.id === id))
      .toMatchObject({ title: 'Renamed by old client', count_target: 10, count_value: 10, status: 'completed' })
    await expect(commit(alice, [
      put('tasks', id, task('Invalid count', { count_target: 10, count_value: 11 }), legacyRevision),
    ], randomUUID(), 3)).rejects.toMatchObject({ code: '23514' })
    const decrementedRevision = randomUUID()
    const decremented = await commit(alice, [
      put('tasks', id, task('Renamed by old client', { count_target: 10, count_value: 9 }), legacyRevision),
    ], decrementedRevision, 3)
    expect(decremented.tasks.find(row => row.id === id))
      .toMatchObject({ count_target: 10, count_value: 9, status: 'active', completed_at: null })
    const cleared = await commit(alice, [
      put('tasks', id, task('Back to an ordinary task', { count_target: null, count_value: 0 }), decrementedRevision),
    ], randomUUID(), 3)
    expect(cleared.tasks.find(row => row.id === id))
      .toMatchObject({ count_target: null, count_value: 0, status: 'active' })
  })

  it('enforces one layer of side objectives and preserves tasks and milestones when disassociated', async () => {
    await useAccount(alice)
    const roadmapId = randomUUID()
    const phaseId = randomUUID()
    const mainId = randomUUID()
    const sideId = randomUUID()
    const taskId = randomUUID()
    const checklistId = randomUUID()
    const milestoneId = randomUUID()
    const firstRevision = randomUUID()
    const objective = (parent_id: string | null) =>
      ({ phase_id: phaseId, parent_id, description: '', title: 'Objective', position: 0, completed: false })
    const records = [
      put('roadmaps', roadmapId, roadmap()),
      put('phases', phaseId, { roadmap_id: roadmapId, title: 'Build', description: '', position: 0 }),
      put('objectives', mainId, objective(null)),
      put('objectives', sideId, objective(mainId)),
      put('tasks', taskId, task('One task', { roadmap_id: roadmapId, objective_id: sideId, inbox: false })),
      put('checklist_items', checklistId, { title: 'One check', task_id: taskId, position: 0, completed: false }),
      put('milestones', milestoneId, { title: 'Release', roadmap_id: roadmapId, phase_id: phaseId, position: 0 }),
    ]
    await commit(alice, records, firstRevision)
    await expect(commit(alice, [put('objectives', randomUUID(), objective(sideId))]))
      .rejects.toMatchObject({ code: '23503' })
    const phaseDeleteRevision = randomUUID()
    const afterDeletion = await commit(alice, [remove('phases', phaseId, firstRevision)], phaseDeleteRevision)
    expect(afterDeletion.objectives.some(row => row.id === mainId || row.id === sideId)).toBe(false)
    expect(afterDeletion.tasks.find(row => row.id === taskId))
      .toMatchObject({ objective_id: null, revision: phaseDeleteRevision })
    expect(afterDeletion.milestones.find(row => row.id === milestoneId))
      .toMatchObject({ phase_id: null, revision: phaseDeleteRevision })
    const afterRoadmap = await commit(alice, [remove('roadmaps', roadmapId, firstRevision)])
    expect(afterRoadmap.tasks.some(row => row.id === taskId)).toBe(false)
    expect(afterRoadmap.checklist_items.some(row => row.id === checklistId)).toBe(false)
  })

  it('grants no access to anonymous clients', async () => {
    await db.exec('reset role; set role anon;')
    await db.query("select set_config('request.jwt.claim.sub','',false)")
    await expect(getWorkspace()).rejects.toMatchObject({ code: '42501' })
    await expect(db.query('select * from public.tasks')).rejects.toMatchObject({ code: '42501' })
    await expect(commit(alice, [put('tasks', randomUUID(), task())])).rejects.toMatchObject({ code: '42501' })
    await expect(commit(alice, [put('tasks', randomUUID(), task())], randomUUID(), 3)).rejects.toMatchObject({ code: '42501' })
    expect((await db.query('select public.get_workspace_schema_version() as version')).rows).toEqual([{ version: 3 }])
  })
})
