import { newTask, put, recordBase, touch, type Change, type ChecklistItem, type Objective, type Task, type Workspace } from './model'
import { hasCountTarget, setCountTarget } from './counting'
import { byPosition, deriveRoadmapProgress, objectiveCompletion, type ObjectiveProgress } from './progress'

export type ObjectiveWork = { kind: 'task'; item: Task } | { kind: 'checklist'; item: ChecklistItem }

function requiredProgress(item: ObjectiveProgress): ObjectiveProgress {
  const tasks = item.tasks.filter(task => !task.optional)
  const checks = item.checklistItems.filter(check => !check.optional)
  return {
    ...item,
    ...objectiveCompletion(item.objective, tasks, checks),
    sideObjectives: item.sideObjectives.map(requiredProgress),
  }
}

function positioned(first?: number | null, second?: number | null) {
  return (first ?? Infinity) - (second ?? Infinity) || 0
}

export function deriveJourney(data: Workspace, goalId: string) {
  const progress = deriveRoadmapProgress(data, goalId)
  const ordered = progress.phases.flatMap(phase => phase.mainObjectives)
    .sort((left, right) => positioned(left.objective.goalPosition, right.objective.goalPosition))
    .map(requiredProgress)
  const optional = ordered.filter(item => item.objective.optional)
  const required = ordered.filter(item => !item.objective.optional)
  const past = required.filter(item => item.isComplete)
  const [current = null, ...future] = required.filter(item => !item.isComplete)
  const total = required.reduce((sum, item) => sum + Math.max(item.total, 1), 0)
  const completed = required.reduce((sum, item) => sum + (item.total ? item.completed : Number(item.isComplete)), 0)
  return { past, current, future, optional, ordered, directTasks: progress.directTasks, completed, total,
    percent: total ? Math.floor(100 * completed / total) : 0 }
}

function nextPosition(rows: { position?: number | null }[]) {
  return rows.reduce((next, row) => Math.max(next, (row.position ?? -1) + 1), 0)
}

function inGoal(data: Workspace, goalId: string, objectiveId: string) {
  const objective = data.objectives.find(row => row.id === objectiveId)
  return objective && data.phases.some(phase => phase.id === objective.phaseId && phase.roadmapId === goalId)
    ? objective
    : undefined
}

export function appendObjective(data: Workspace, goalId: string, title: string, optional = false, countTarget?: number | null): Change[] {
  const phases = data.phases.filter(phase => phase.roadmapId === goalId).sort(byPosition)
  const existing = phases.at(-1)
  const phase = existing ?? { ...recordBase(), roadmapId: goalId, title: 'Objectives', description: '', position: 0 }
  const objectives = data.objectives.filter(item => item.phaseId === phase.id && item.parentId === null)
  const objective: Objective = {
    ...recordBase(), phaseId: phase.id, parentId: null, title, description: '', optional,
    position: nextPosition(objectives), completed: false,
  }
  return [...(existing ? [] : [put('phases', phase)]), put('objectives', setCountTarget(objective, countTarget ?? null))]
}

function swap<T>(rows: T[], index: number, other: number): T[] {
  if (index < 0 || other < 0 || other >= rows.length) return []
  const reordered = [...rows]
  reordered[index] = rows[other]
  reordered[other] = rows[index]
  return reordered
}

export function moveObjective(data: Workspace, goalId: string, objectiveId: string, direction: -1 | 1): Change[] {
  const objective = inGoal(data, goalId, objectiveId)
  if (!objective) return []
  const siblings = objective.parentId
    ? data.objectives.filter(row => row.parentId === objective.parentId).sort(byPosition)
    : deriveJourney(data, goalId).ordered.map(row => row.objective)
  const other = siblings[siblings.findIndex(row => row.id === objectiveId) + direction]
  if (!other) return []
  const reordered = swap(siblings, siblings.indexOf(objective), siblings.indexOf(other))
  return reordered.flatMap((row, position) => {
    if (row.parentId) return row.position === position ? [] : [put('objectives', touch({ ...row, position }))]
    return row.goalPosition === position ? [] : [put('objectives', touch({ ...row, goalPosition: position }))]
  })
}

export function workForObjective(data: Workspace, objectiveId: string): ObjectiveWork[] {
  const tasks = data.tasks.filter(task => task.objectiveId === objectiveId && task.status !== 'archived')
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    .map((item): ObjectiveWork => ({ kind: 'task', item }))
  const checks = data.checklistItems.filter(item => item.objectiveId === objectiveId).sort(byPosition)
    .map((item): ObjectiveWork => ({ kind: 'checklist', item }))
  return [...checks, ...tasks].sort((left, right) => positioned(left.item.position, right.item.position))
}

function positionWork(row: ObjectiveWork, position: number) {
  if (row.item.position === position) return []
  return [row.kind === 'task'
    ? put('tasks', touch({ ...row.item, position }))
    : put('checklistItems', touch({ ...row.item, position }))]
}

export function moveSubObjective(data: Workspace, objectiveId: string, itemId: string, direction: -1 | 1): Change[] {
  const work = workForObjective(data, objectiveId)
  const index = work.findIndex(row => row.item.id === itemId)
  return swap(work, index, index + direction).flatMap(positionWork)
}

function appendWork(data: Workspace, objectiveId: string) {
  const work = workForObjective(data, objectiveId)
  const withoutPosition = work.filter(row => row.item.position == null)
  let position = nextPosition(work.map(row => row.item))
  const changes = withoutPosition.flatMap(row => positionWork(row, position++))
  return { position, changes }
}

function clearManualCompletion(objective: Objective, optional?: boolean): Change[] {
  return optional || !objective.completed || hasCountTarget(objective) ? [] : [put('objectives', touch({ ...objective, completed: false }))]
}

export function newSubObjective(data: Workspace, goalId: string, objectiveId: string, title: string, optional = false, countTarget?: number | null): Change[] {
  const objective = inGoal(data, goalId, objectiveId)
  if (!objective) return []
  const { position, changes } = appendWork(data, objectiveId)
  const task = newTask(title, { inbox: false, roadmapId: goalId, objectiveId, position, optional })
  return [...clearManualCompletion(objective, optional), ...changes, put('tasks', setCountTarget(task, countTarget ?? null))]
}

export function setSubObjectiveOptional(data: Workspace, row: ObjectiveWork, optional: boolean): Change[] {
  const parent = data.objectives.find(objective => objective.id === row.item.objectiveId)
  const change = row.kind === 'task' ? put('tasks', touch({ ...row.item, optional }))
    : put('checklistItems', touch({ ...row.item, optional }))
  return [...(parent ? clearManualCompletion(parent, optional) : []), change]
}

export function moveSubObjectiveTo(data: Workspace, goalId: string, row: ObjectiveWork, objectiveId: string): Change[] {
  const destination = inGoal(data, goalId, objectiveId)
  if (!destination || destination.parentId || row.item.objectiveId === objectiveId) return []
  const sourceGoal = row.kind === 'task' ? row.item.roadmapId
    : inGoal(data, goalId, row.item.objectiveId ?? '') && goalId
  if (sourceGoal !== goalId) return []
  const { position, changes } = appendWork(data, objectiveId)
  const change = row.kind === 'task' ? put('tasks', touch({ ...row.item, objectiveId, position }))
    : put('checklistItems', touch({ ...row.item, objectiveId, position }))
  return [...clearManualCompletion(destination, row.item.optional), ...changes, change]
}
