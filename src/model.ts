export interface BaseRecord {
  id: string
  createdAt: string
  updatedAt: string
}

export type Priority = 'none' | 'low' | 'medium' | 'high'
export type TaskStatus = 'active' | 'completed' | 'archived'
export type Theme = 'system' | 'light' | 'dark'
export type GoalPresentation = 'journey' | 'list'

export interface CountFields {
  countTarget?: number | null
  countValue?: number
}

export interface Task extends BaseRecord, CountFields {
  title: string
  description: string
  dueDate: string | null
  plannedDate: string | null
  priority: Priority
  status: TaskStatus
  completedAt: string | null
  inbox: boolean
  roadmapId: string | null
  objectiveId: string | null
  optional?: boolean
  position?: number | null
}

export interface Roadmap extends BaseRecord {
  title: string
  purpose: string
  startingPoint: string
  outcome: string
  startDate: string
  targetDate: string | null
  archived: boolean
  presentation?: GoalPresentation
}

export interface Phase extends BaseRecord {
  roadmapId: string
  title: string
  description: string
  position: number
}

export interface Objective extends BaseRecord, CountFields {
  phaseId: string
  title: string
  description: string
  parentId: string | null
  position: number
  completed: boolean
  optional?: boolean
  goalPosition?: number | null
}

export interface Milestone extends BaseRecord {
  roadmapId: string
  title: string
  phaseId: string | null
  targetDate: string | null
  completedAt: string | null
  position: number
}

export interface ChecklistItem extends BaseRecord, CountFields {
  taskId: string | null
  objectiveId: string | null
  title: string
  completed: boolean
  position: number
  optional?: boolean
}

export interface Setting extends BaseRecord { theme: Theme }

export interface Workspace {
  tasks: Task[]
  roadmaps: Roadmap[]
  phases: Phase[]
  objectives: Objective[]
  milestones: Milestone[]
  checklistItems: ChecklistItem[]
  settings: Setting[]
}

export type EntityKey = keyof Workspace
export type Entity<K extends EntityKey> = Workspace[K][number]
export type Change = { [K in EntityKey]: { table: K; record: Entity<K> } }[EntityKey]
  | { table: EntityKey; deleteId: string }

export const entityKeys = ['roadmaps', 'phases', 'objectives', 'tasks', 'milestones', 'checklistItems', 'settings'] as const

export function emptyWorkspace(): Workspace {
  return { tasks: [], roadmaps: [], phases: [], objectives: [], milestones: [], checklistItems: [], settings: [] }
}

export function put<K extends EntityKey>(table: K, record: Entity<K>): Change {
  return { table, record } as Change
}

export function remove(table: EntityKey, deleteId: string): Change {
  return { table, deleteId }
}

export function recordBase(): BaseRecord {
  const now = new Date().toISOString()
  return { id: crypto.randomUUID(), createdAt: now, updatedAt: now }
}

export function touch<T extends BaseRecord>(record: T): T {
  return { ...record, updatedAt: new Date(Math.max(Date.now(), Date.parse(record.updatedAt) + 1)).toISOString() }
}

export function applyChanges(workspace: Workspace, changes: Change[]): Workspace {
  const data = { ...workspace }
  for (const change of changes) {
    const rows: BaseRecord[] = data[change.table]
    if ('record' in change) {
      const record = change.record
      const index = rows.findIndex(row => row.id === record.id)
      const updated = index === -1 ? [...rows, record] : rows.map(row => row.id === record.id ? record : row)
      Object.assign(data, { [change.table]: updated })
    } else {
      const id = change.deleteId
      if (change.table === 'roadmaps') {
        data.phases.filter(row => row.roadmapId === id).forEach(row => cascade(remove('phases', row.id)))
        data.tasks.filter(row => row.roadmapId === id).forEach(row => cascade(remove('tasks', row.id)))
        data.milestones = data.milestones.filter(row => row.roadmapId !== id)
      }
      if (change.table === 'phases') {
        data.objectives.filter(row => row.phaseId === id).forEach(row => cascade(remove('objectives', row.id)))
        data.milestones = data.milestones.map(row => row.phaseId === id ? { ...row, phaseId: null } : row)
      }
      if (change.table === 'objectives') {
        data.objectives.filter(row => row.parentId === id).forEach(row => cascade(remove('objectives', row.id)))
        data.tasks = data.tasks.map(row => row.objectiveId === id ? { ...row, objectiveId: null } : row)
        data.checklistItems = data.checklistItems.filter(row => row.objectiveId !== id)
      }
      if (change.table === 'tasks') data.checklistItems = data.checklistItems.filter(row => row.taskId !== id)
      Object.assign(data, { [change.table]: data[change.table].filter(row => row.id !== id) })
    }
  }
  return data

  function cascade(change: Change) {
    Object.assign(data, applyChanges(data, [change]))
  }
}

export function localDate(date = new Date()): string {
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  return [date.getFullYear(), month, day].join('-')
}

export function formatDate(date: string, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }): string {
  return new Intl.DateTimeFormat(undefined, options).format(new Date(date.length === 10 ? date + 'T12:00:00' : date))
}

export function newTask(title = '', defaults: Partial<Task> = {}): Task {
  return {
    ...recordBase(), title, description: '', dueDate: null, plannedDate: null, priority: 'none',
    status: 'active', completedAt: null, inbox: true, roadmapId: null, objectiveId: null, ...defaults,
  }
}

export function changeTaskStatus(task: Task, status: TaskStatus): Task {
  // Standard task views can still complete or reopen a tracked task. Treat
  // those explicit actions as setting its count to the corresponding boundary.
  const target = task.countTarget
  if (target != null && status !== 'archived') {
    if (task.status === 'archived') {
      status = (task.countValue ?? 0) >= target ? 'completed' : 'active'
    } else {
      task = { ...task, countValue: status === 'completed' ? target : Math.min(task.countValue ?? 0, target - 1) }
    }
  }
  return touch({
    ...task,
    status,
    completedAt: status === 'completed' ? task.completedAt ?? new Date().toISOString() : status === 'archived' ? task.completedAt : null,
  })
}
