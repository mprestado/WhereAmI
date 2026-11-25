import { describe, expect, it } from 'vitest'
import { adjustCount, setCountTarget } from './counting'
import { appendObjective, deriveJourney, moveObjective, moveSubObjective, moveSubObjectiveTo, newSubObjective, workForObjective } from './journey'
import { applyChanges, changeTaskStatus, emptyWorkspace, newTask, put, recordBase, type Objective } from './model'

const goal = 'research'

function fixture() {
  const first = applyChanges(emptyWorkspace(), appendObjective(emptyWorkspace(), goal, 'Plan'))
  return applyChanges(first, appendObjective(first, goal, 'Build'))
}

describe('goal journey', () => {
  it('starts empty at zero and handles manual completion, advancement and reopening', () => {
    expect(deriveJourney(emptyWorkspace(), goal)).toMatchObject({ completed: 0, total: 0, percent: 0, current: null })
    const data = fixture()
    const first = data.objectives[0]
    const second = data.objectives[1]
    expect(deriveJourney(data, goal).current?.objective.id).toBe(first.id)
    const done = applyChanges(data, data.objectives.map(row => put('objectives', { ...row, completed: true })))
    expect(deriveJourney(done, goal)).toMatchObject({ percent: 100, current: null, future: [] })
    expect(deriveJourney(done, goal).past.map(row => row.objective.id)).toEqual([first.id, second.id])
    const reopened = applyChanges(done, [put('objectives', { ...first, completed: false })])
    expect(deriveJourney(reopened, goal).current?.objective.id).toBe(first.id)
    expect(deriveJourney(reopened, goal).percent).toBe(50)
  })

  it('counts required work once and skips optional and standalone work', () => {
    const fixtureData = fixture()
    const [first, second] = fixtureData.objectives
    const side: Objective = { ...recordBase(), title: 'Optional', parentId: first.id, position: 0, description: '', phaseId: first.phaseId, completed: false }
    const data = applyChanges(fixtureData, [
      ...newSubObjective(fixtureData, goal, first.id, 'Prepare files'),
      put('objectives', side),
      put('tasks', newTask('Optional task', { inbox: false, roadmapId: goal, objectiveId: side.id })),
      put('tasks', newTask('Standalone task', { inbox: false, roadmapId: goal })),
      put('checklistItems', { ...recordBase(), title: 'Legacy objective check', taskId: null, objectiveId: first.id, position: 0, completed: true }),
    ])
    const required = data.tasks.find(row => row.objectiveId === first.id)!
    const withTaskChecklist = applyChanges(data, [put('checklistItems', {
      ...recordBase(), title: 'Nested task check', taskId: required.id, objectiveId: null, position: 0, completed: true,
    })])
    expect(deriveJourney(withTaskChecklist, goal)).toMatchObject({ total: 3, completed: 1, percent: 33 })
    const done = applyChanges(withTaskChecklist, [put('tasks', changeTaskStatus(required, 'completed'))])
    expect(deriveJourney(done, goal)).toMatchObject({ total: 3, completed: 2, percent: 66 })
    expect(deriveJourney(done, goal).current?.objective.id).toBe(second.id)
  })

  it('reorders the active objective and preserves legacy phase relationships', () => {
    const data = fixture()
    const [first, second] = data.objectives
    const moved = applyChanges(data, moveObjective(data, goal, second.id, -1))
    expect(deriveJourney(moved, goal).ordered.map(row => row.objective.id)).toEqual([second.id, first.id])
    expect(moved.objectives.map(row => row.phaseId)).toEqual(data.objectives.map(row => row.phaseId))
    expect(moveObjective(moved, goal, second.id, -1)).toEqual([])
  })

  it('advances past required work without counting optional objectives or sub-objectives', () => {
    const initial = fixture()
    const [first, second] = initial.objectives
    const data = applyChanges(initial, [
      ...appendObjective(initial, goal, 'Stretch goal', true),
      ...newSubObjective(initial, goal, first.id, 'Required item'),
    ])
    const work = applyChanges(data, newSubObjective(data, goal, first.id, 'Optional item', true))
    const firstWork = work.tasks.find(task => task.title === 'Required item')!
    const finished = applyChanges(work, [put('tasks', changeTaskStatus(firstWork, 'completed'))])
    const view = deriveJourney(finished, goal)
    expect(view.past.map(item => item.objective.id)).toEqual([first.id])
    expect(view.current?.objective.id).toBe(second.id)
    expect(view.optional.map(item => item.objective.title)).toEqual(['Stretch goal'])
    expect(view).toMatchObject({ completed: 1, total: 2, percent: 50 })
  })

  it('treats a count target as one required step and reopens work after decrementing', () => {
    const empty = emptyWorkspace()
    const initial = applyChanges(empty, appendObjective(empty, goal, 'Collect certificates', false, 10))
    const id = initial.objectives[0].id
    const first = applyChanges(initial, newSubObjective(initial, goal, id, 'Verify records', false, 2))
    const work = applyChanges(first, newSubObjective(first, goal, id, 'Scan extras', true, 50))
    const objective = work.objectives[0]
    const required = work.tasks[0]
    expect(deriveJourney(work, goal)).toMatchObject({ total: 2, completed: 0, percent: 0 })

    const active = applyChanges(work, [
      put('objectives', adjustCount(objective, 99)),
      put('tasks', adjustCount(required, 1)),
    ])
    expect(active.objectives[0]).toMatchObject({ countValue: 10, completed: true })
    expect(deriveJourney(active, goal)).toMatchObject({ total: 2, completed: 1, percent: 50 })
    expect(deriveJourney(active, goal).current?.objective.id).toBe(id)
    const done = applyChanges(active, [put('tasks', adjustCount(active.tasks[0], 1))])
    expect(deriveJourney(done, goal)).toMatchObject({ total: 2, completed: 2, percent: 100, current: null })
    const reopened = applyChanges(done, [put('objectives', adjustCount(done.objectives[0], -1))])
    expect(deriveJourney(reopened, goal)).toMatchObject({ total: 2, completed: 1, percent: 50 })
    expect(deriveJourney(reopened, goal).current?.objective.id).toBe(id)
    expect(adjustCount(reopened.objectives[0], -99)).toMatchObject({ countValue: 0, completed: false })
  })

  it('preserves completed work when switching a checkbox into a count tracker', () => {
    const checked = changeTaskStatus(newTask('Collect certificates'), 'completed')
    const counter = setCountTarget(checked, 10)
    expect(counter).toMatchObject({ countTarget: 10, countValue: 10, status: 'completed', completedAt: checked.completedAt })
    const raised = setCountTarget(counter, 11)
    expect(raised).toMatchObject({ countTarget: 11, countValue: 10, status: 'active', completedAt: null })
    expect(setCountTarget(raised, null)).toMatchObject({ countTarget: null, countValue: 0, status: 'active' })
    expect(() => setCountTarget(checked, 10000)).toThrow('Enter a target from 1 to 9999.')
  })

  it('reorders across existing groups and appends legacy work without disturbing the previous order', () => {
    const initial = fixture()
    const [first, second] = initial.objectives
    const phase = { ...initial.phases[0], ...recordBase(), position: 1 }
    const data = applyChanges(initial, [
      put('phases', phase),
      put('objectives', { ...second, phaseId: phase.id, position: 0 }),
      put('tasks', newTask('Original task', { inbox: false, roadmapId: goal, objectiveId: first.id })),
      put('checklistItems', {
        ...recordBase(), title: 'Original checklist', taskId: null, objectiveId: first.id, position: 0, completed: false,
      }),
    ])
    const reordered = applyChanges(data, moveObjective(data, goal, second.id, -1))
    expect(deriveJourney(reordered, goal).ordered.map(item => item.objective.id)).toEqual([second.id, first.id])
    expect(reordered.objectives.find(row => row.id === second.id)?.phaseId).toBe(phase.id)
    const withAppended = applyChanges(reordered, appendObjective(reordered, goal, 'Last objective'))
    expect(deriveJourney(withAppended, goal).ordered.map(item => item.objective.title)).toEqual(['Build', 'Plan', 'Last objective'])

    const withTask = applyChanges(withAppended, newSubObjective(withAppended, goal, first.id, 'Appended task'))
    const originalWork = workForObjective(withTask, first.id)
    expect(originalWork.map(row => row.item.title)).toEqual(['Original checklist', 'Original task', 'Appended task'])
    const moved = applyChanges(withTask, moveSubObjective(withTask, first.id, originalWork[1].item.id, -1))
    expect(workForObjective(moved, first.id).map(row => row.item.title)).toEqual(['Original task', 'Original checklist', 'Appended task'])
    const reparented = applyChanges(moved, moveSubObjectiveTo(moved, goal, originalWork[0], second.id))
    expect(workForObjective(reparented, second.id).map(row => row.item.title)).toEqual(['Original checklist'])
    expect(workForObjective(reparented, first.id).map(row => row.item.title)).toEqual(['Original task', 'Appended task'])
  })
})
