import type { Priority, Task, Workspace } from './model'

export type TaskView = 'inbox' | 'today' | 'upcoming' | 'active' | 'completed' | 'archived'
export type TaskSort = 'relevant' | 'newest' | 'deadline' | 'priority' | 'title'

export const priorityLabels: Record<Priority, string> = {
  none: 'No priority', low: 'Low', medium: 'Medium', high: 'High',
}

const priorityOrder: Record<Priority, number> = { none: 0, low: 1, medium: 2, high: 3 }

export function tasksForView(tasks: Task[], view: TaskView, today: string): Task[] {
  if (view === 'completed' || view === 'archived') return tasks.filter(task => task.status === view)
  const active = tasks.filter(task => task.status === 'active')
  if (view === 'inbox') return active.filter(task => task.inbox)
  if (view === 'today') return active.filter(task => task.plannedDate === today || task.dueDate === today)
  if (view === 'upcoming') return active.filter(task =>
    (task.plannedDate !== null && task.plannedDate > today)
    || (task.dueDate !== null && task.dueDate > today),
  )
  return active
}

export function sortTasks(tasks: Task[], sort: TaskSort, today: string, view: TaskView = 'active'): Task[] {
  return [...tasks].sort((first, second) => {
    if (sort === 'title') return first.title.localeCompare(second.title)
    if (sort === 'newest') return second.createdAt.localeCompare(first.createdAt)
    if (sort === 'priority') {
      const byPriority = priorityOrder[second.priority] - priorityOrder[first.priority]
      if (byPriority) return byPriority
    }
    if (sort === 'deadline') return (first.dueDate ?? '9999').localeCompare(second.dueDate ?? '9999')
    if (view === 'completed') return (second.completedAt ?? '').localeCompare(first.completedAt ?? '')
    if (view === 'inbox' || view === 'archived') return second.updatedAt.localeCompare(first.updatedAt)
    const relevantDate = (task: Task) => {
      const dates = [task.plannedDate, task.dueDate].filter((date): date is string => date !== null)
      return (view === 'upcoming' ? dates.filter(date => date > today) : dates).sort()[0] ?? '9999'
    }
    return relevantDate(first).localeCompare(relevantDate(second)) || first.createdAt.localeCompare(second.createdAt)
  })
}

export type SearchKind = 'task' | 'goal' | 'objective'
export interface SearchResult { kind: SearchKind; id: string; title: string; label: string; context: string; goalId?: string }

export function searchWorkspace(data: Workspace, query: string): SearchResult[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  const goals = new Map(data.roadmaps.map(goal => [goal.id, goal.title]))
  const phases = new Map(data.phases.map(phase => [phase.id, phase]))
  const objectives = new Map(data.objectives.map(objective => [objective.id, objective]))
  const candidates: (SearchResult & { note: string })[] = [
    ...data.tasks.map(task => ({
      kind: 'task' as const, id: task.id, title: task.title, note: task.description,
      label: task.objectiveId ? 'Sub-objective' : 'Task',
      context: (task.objectiveId && objectives.get(task.objectiveId)?.title)
        || (task.roadmapId && goals.get(task.roadmapId)) || (task.inbox ? 'Inbox' : 'Tasks'),
    })),
    ...data.roadmaps.map(goal => ({
      kind: 'goal' as const, id: goal.id, title: goal.title,
      note: [goal.purpose, goal.startingPoint, goal.outcome].join(' '),
      label: goal.archived ? 'Archived goal' : 'Goal',
      context: goal.presentation === 'list' ? 'Task list' : 'Journey', goalId: goal.id,
    })),
    ...data.objectives.map(objective => {
      const phase = phases.get(objective.phaseId)
      const goalId = phase?.roadmapId
      return {
        kind: 'objective' as const, id: objective.id, title: objective.title,
        label: objective.parentId || objective.optional ? 'Optional objective' : 'Objective',
        note: [objective.description, phase?.title, phase?.description].filter(Boolean).join(' '),
        context: (goalId && goals.get(goalId)) ?? '', goalId,
      }
    }),
  ]
  return candidates
    .filter(row => terms.every(term => [row.title, row.note, row.context].join(' ').toLowerCase().includes(term)))
    .sort((first, second) => Number(second.title.toLowerCase().startsWith(terms[0])) - Number(first.title.toLowerCase().startsWith(terms[0])))
    .map(({ kind, id, title, label, context, goalId }) => ({ kind, id, title, label, context, goalId }))
}
