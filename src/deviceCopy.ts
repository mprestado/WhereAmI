import { put, type Change, type Entity, type EntityKey, type Workspace } from './model'

export interface DeviceCopyResult {
  recordKeys: string[]
  unavailable: number
}

export function deviceRecordKey(table: EntityKey, id: string) {
  return table + '/' + id
}

export function countDeviceRecords(workspace: Workspace) {
  return workspace.roadmaps.length + workspace.tasks.length + workspace.phases.length
    + workspace.objectives.length + workspace.checklistItems.length + workspace.milestones.length
}

// Build an insert-only copy in foreign key order. Previously copied IDs are
// remembered on this device so a retry cannot restore work deleted in the account.
export function planDeviceCopy(source: Workspace, destination: Workspace, copiedKeys: string[]) {
  const copied = new Set(copiedKeys)
  const available = new Set<string>()
  const changes: Change[] = []
  const recordKeys: string[] = []
  let unavailable = 0
  const tables = ['roadmaps', 'phases', 'objectives', 'tasks', 'milestones', 'checklistItems'] as const
  for (const table of tables) {
    for (const row of destination[table]) available.add(deviceRecordKey(table, row.id))
  }

  function linked(table: EntityKey, id: string | null) {
    return id === null || available.has(deviceRecordKey(table, id))
  }

  function add<K extends EntityKey>(table: K, rows: Entity<K>[], canInsert: (row: Entity<K>) => boolean = () => true) {
    for (const row of rows) {
      const key = deviceRecordKey(table, row.id)
      if (available.has(key)) {
        copied.add(key)
      } else if (!copied.has(key)) {
        if (!canInsert(row)) {
          unavailable++
          continue
        }
        changes.push(put(table, row))
        recordKeys.push(key)
        available.add(key)
      }
    }
  }

  add('roadmaps', source.roadmaps)
  add('phases', source.phases, phase => linked('roadmaps', phase.roadmapId))
  add('objectives', source.objectives.filter(objective => !objective.parentId), objective => linked('phases', objective.phaseId))
  add('objectives', source.objectives.filter(objective => objective.parentId),
    objective => linked('phases', objective.phaseId) && linked('objectives', objective.parentId))
  add('tasks', source.tasks, task => linked('roadmaps', task.roadmapId) && linked('objectives', task.objectiveId))
  add('milestones', source.milestones, milestone => linked('roadmaps', milestone.roadmapId) && linked('phases', milestone.phaseId))
  add('checklistItems', source.checklistItems, item => linked('tasks', item.taskId) && linked('objectives', item.objectiveId))

  return { changes, recordKeys, unavailable, copiedKeys: [...copied] }
}
