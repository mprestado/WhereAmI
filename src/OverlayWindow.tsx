import { useEffect, useRef, useState } from 'react'
import TaskOverlay from './TaskOverlay'
import { closeTaskOverlay, dragTaskOverlay, readTaskOverlay, setTaskOverlay, showMainWindow } from './desktopOverlay'
import { emptyWorkspace, type Change } from './model'
import { useOverlaySubscriber } from './overlayWorkspace'

const empty = emptyWorkspace()

export default function OverlayWindow() {
  const { workspace, update } = useOverlaySubscriber()
  const [collapsed, setCollapsed] = useState(false)
  const [changingMode, setChangingMode] = useState(false)
  const [error, setError] = useState('')
  const transition = useRef(false)

  useEffect(() => {
    let active = true
    void readTaskOverlay().then(mode => {
      if (active && !transition.current) setCollapsed(mode === 'collapsed')
    }).catch(() => {})
    return () => { active = false }
  }, [])

  useEffect(() => {
    document.title = 'Task overlay · WhereAmI'
    document.documentElement.dataset.theme = workspace?.theme ?? 'system'
  }, [workspace?.theme])

  async function toggle() {
    if (transition.current) return
    transition.current = true
    setChangingMode(true)
    setError('')
    try {
      await setTaskOverlay(collapsed ? 'expanded' : 'collapsed')
      setCollapsed(!collapsed)
    } catch {
      setError('Windows could not resize the overlay.')
    } finally {
      transition.current = false
      setChangingMode(false)
    }
  }

  async function commit(changes: Change[]) {
    for (const change of changes) {
      if (!('record' in change)) throw new Error('The task overlay can only update completion.')
      const { table, record } = change
      if (table === 'tasks') await update({ kind: 'completion', table, id: record.id, completed: record.status === 'completed' })
      else if (table === 'objectives' || table === 'checklistItems') {
        await update({ kind: 'completion', table, id: record.id, completed: record.completed })
      } else throw new Error('The task overlay can only update completion.')
    }
  }

  return <TaskOverlay key={JSON.stringify([workspace?.scope, workspace?.objectiveId])}
    data={workspace?.data ?? empty} goal={workspace?.goal} objectiveId={workspace?.objectiveId}
    tasks={workspace?.tasks ?? []} taskViewTitle={workspace?.taskViewTitle ?? 'Tasks'} commit={commit}
    onAdjustCount={(table, id, delta) => update({ kind: 'count', table, id, delta })}
    collapsed={collapsed} changingMode={changingMode} windowError={error} syncState={workspace?.syncState ?? 'loading'}
    onToggleCollapsed={() => void toggle()}
    onRestore={() => void showMainWindow().catch(() => setError('Windows could not show WhereAmI.'))}
    onClose={() => void closeTaskOverlay().catch(() => setError('Windows could not close the overlay.'))}
    onDrag={() => void dragTaskOverlay().catch(() => setError('Windows could not move the overlay.'))} />
}
