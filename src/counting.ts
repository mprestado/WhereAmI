import { touch, type ChecklistItem, type CountFields, type Objective, type Task } from './model'

export const MAX_COUNT_TARGET = 9999
export type CountTable = 'objectives' | 'tasks' | 'checklistItems'
export type CountableRecord = Objective | Task | ChecklistItem

export function hasCountTarget<T extends CountFields>(record: T): record is T & { countTarget: number } {
  const target = record.countTarget
  return typeof target === 'number' && Number.isInteger(target) && target >= 1 && target <= MAX_COUNT_TARGET
}

export function isCountableComplete(record: CountableRecord): boolean {
  if (hasCountTarget(record)) return (record.countValue ?? 0) >= record.countTarget
  return 'status' in record ? record.status === 'completed' : record.completed
}

function countAt<T extends CountableRecord>(record: T, countTarget: number | null, countValue: number, completed: boolean): T {
  if ('status' in record) {
    const status = record.status === 'archived' ? 'archived' : completed ? 'completed' : 'active'
    const completedAt = completed ? record.completedAt ?? new Date().toISOString() : null
    return touch({ ...record, countTarget, countValue, status, completedAt })
  }
  return touch({ ...record, countTarget, countValue, completed })
}

export function setCountTarget<T extends CountableRecord>(record: T, target: number | null): T {
  if (target === record.countTarget || (target === null && record.countTarget === undefined)) return record
  if (target !== null && !hasCountTarget({ countTarget: target })) {
    throw new Error('Enter a target from 1 to ' + MAX_COUNT_TARGET + '.')
  }
  const complete = isCountableComplete(record) || ('status' in record && record.status === 'archived' && record.completedAt !== null)
  if (target === null) return countAt(record, null, 0, complete)
  const count = hasCountTarget(record) ? Math.min(record.countValue ?? 0, target) : complete ? target : 0
  return countAt(record, target, count, count === target)
}

export function adjustCount<T extends CountableRecord>(record: T, delta: number): T {
  if (!hasCountTarget(record) || !Number.isSafeInteger(delta) || ('status' in record && record.status === 'archived')) return record
  const previous = record.countValue ?? 0
  const next = Math.max(0, Math.min(record.countTarget, previous + delta))
  return next === previous ? record : countAt(record, record.countTarget, next, next === record.countTarget)
}
