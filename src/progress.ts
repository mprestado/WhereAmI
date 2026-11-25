import type { ChecklistItem, Milestone, Objective, Phase, Task, Workspace } from './model'
import { hasCountTarget, isCountableComplete } from './counting'

export interface ObjectiveProgress {
  objective: Objective
  tasks: Task[]
  checklistItems: ChecklistItem[]
  completed: number
  total: number
  isComplete: boolean
  sideObjectives: ObjectiveProgress[]
}

export function objectiveCompletion(objective: Objective, tasks: Task[], checklistItems: ChecklistItem[]) {
  const isTracked = hasCountTarget(objective)
  const total = tasks.length + checklistItems.length + Number(isTracked)
  const completed = tasks.filter(isCountableComplete).length + checklistItems.filter(isCountableComplete).length
    + Number(isTracked && isCountableComplete(objective))
  return { total, completed, isComplete: total ? completed === total : objective.completed }
}

export interface PhaseProgress {
  phase: Phase
  status: 'completed' | 'active' | 'upcoming'
  mainObjectives: ObjectiveProgress[]
  completed: number
  total: number
}

export interface RoadmapProgress {
  requiredTasks: { completed: number; total: number }
  phases: PhaseProgress[]
  currentPhase: Phase | null
  nextMilestone: Milestone | null
  completedMilestones: Milestone[]
  milestones: Milestone[]
  directTasks: Task[]
  isComplete: boolean
}

export function byPosition<T extends { position: number; id: string }>(first: T, second: T) {
  return first.position - second.position || first.id.localeCompare(second.id)
}

function byMilestoneDate(first: Milestone, second: Milestone) {
  if (first.targetDate && second.targetDate) {
    return first.targetDate.localeCompare(second.targetDate) || byPosition(first, second)
  }
  if (first.targetDate) return -1
  if (second.targetDate) return 1
  return byPosition(first, second)
}

function groupBy<T>(rows: T[], keyOf: (row: T) => string | null) {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const key = keyOf(row)
    if (key === null) continue
    const group = groups.get(key)
    if (group) group.push(row)
    else groups.set(key, [row])
  }
  return groups
}

export function deriveRoadmapProgress(data: Workspace, roadmapId: string): RoadmapProgress {
  const phases = data.phases.filter((phase) => phase.roadmapId === roadmapId).sort(byPosition)
  const phaseIds = new Set(phases.map((phase) => phase.id))
  const objectives = data.objectives.filter((objective) => phaseIds.has(objective.phaseId))
  const mainObjectives = objectives.filter((objective) => objective.parentId === null)
  const mainIds = new Set(mainObjectives.map((objective) => objective.id))
  const mainByPhase = groupBy(mainObjectives, (objective) => objective.phaseId)
  const sideByParent = groupBy(objectives, (objective) => objective.parentId)
  const tasks = data.tasks.filter((task) => task.roadmapId === roadmapId && task.status !== 'archived')
  const tasksByObjective = groupBy(tasks, (task) => task.objectiveId)
  const checklistByObjective = groupBy(data.checklistItems, (item) => item.objectiveId)
  const directTasks = tasks.filter((task) => task.objectiveId === null)
  const required = tasks.filter((task) => task.objectiveId === null || mainIds.has(task.objectiveId))
  const requiredTasks = {
    completed: required.filter(isCountableComplete).length,
    total: required.length,
  }

  function summarizeObjective(objective: Objective, sideObjectives: ObjectiveProgress[]): ObjectiveProgress {
    const objectiveTasks = tasksByObjective.get(objective.id) ?? []
    const checklistItems = (checklistByObjective.get(objective.id) ?? []).sort(byPosition)
    return {
      objective,
      tasks: objectiveTasks,
      checklistItems,
      ...objectiveCompletion(objective, objectiveTasks, checklistItems),
      sideObjectives,
    }
  }

  let currentPhase: Phase | null = null
  const phaseProgress = phases.map((phase): PhaseProgress => {
    const phaseObjectives = (mainByPhase.get(phase.id) ?? []).sort(byPosition).map((objective) => {
      const sideObjectives = (sideByParent.get(objective.id) ?? []).sort(byPosition)
        .map((sideObjective) => summarizeObjective(sideObjective, []))
      return summarizeObjective(objective, sideObjectives)
    })
    const completed = phaseObjectives.filter((objective) => objective.isComplete).length
    const total = phaseObjectives.length
    let status: PhaseProgress['status'] = 'upcoming'
    if (total > 0 && completed === total) status = 'completed'
    else if (!currentPhase) {
      currentPhase = phase
      status = 'active'
    }
    return { phase, status, mainObjectives: phaseObjectives, completed, total }
  })

  const milestones = data.milestones.filter((milestone) => milestone.roadmapId === roadmapId).sort(byPosition)
  const nextMilestone = milestones.filter((milestone) => !milestone.completedAt).sort(byMilestoneDate)[0] ?? null
  return {
    requiredTasks,
    phases: phaseProgress,
    currentPhase,
    nextMilestone,
    completedMilestones: milestones.filter((milestone) => milestone.completedAt),
    milestones,
    directTasks,
    isComplete: (phases.length > 0 || requiredTasks.total > 0)
      && currentPhase === null && requiredTasks.completed === requiredTasks.total,
  }
}
