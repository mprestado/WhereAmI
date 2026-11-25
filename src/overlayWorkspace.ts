import { useEffect, useRef, useState } from 'react'
import type { CountTable } from './counting'
import { emptyWorkspace, type Roadmap, type Task, type Theme, type Workspace } from './model'
import type { SyncState } from './Settings'

const channelName = 'whereami-desktop-task-overlay'

export interface OverlayWorkspace {
  scope: string
  data: Workspace
  goal?: Roadmap
  objectiveId?: string
  tasks: Task[]
  taskViewTitle: string
  theme: Theme
  syncState: SyncState
}

type OverlayChange = { table: CountTable; id: string } & (
  { kind: 'count'; delta: number } | { kind: 'completion'; completed: boolean }
)

type OverlayRequest =
  | { type: 'subscribe' | 'unsubscribe' }
  | { type: 'change'; requestId: string; scope: string; change: OverlayChange }

type WorkspaceMessage =
  | { type: 'workspace'; workspace: OverlayWorkspace }
  | { type: 'result'; requestId: string; error?: string }

export function goalOverlayData(data: Workspace, goal: Roadmap): Workspace {
  const phases = data.phases.filter(phase => phase.roadmapId === goal.id)
  const phaseIds = new Set(phases.map(phase => phase.id))
  const objectives = data.objectives.filter(objective => phaseIds.has(objective.phaseId))
  const objectiveIds = new Set(objectives.map(objective => objective.id))
  return {
    ...emptyWorkspace(),
    roadmaps: [goal],
    phases,
    objectives,
    tasks: data.tasks.filter(task => task.roadmapId === goal.id),
    checklistItems: data.checklistItems.filter(item => item.objectiveId && objectiveIds.has(item.objectiveId)),
  }
}

export function useOverlayPublisher(enabled: boolean, workspace: OverlayWorkspace, save: (change: OverlayChange) => Promise<void>, onOpen: () => void) {
  const current = useRef({ workspace, save, onOpen })
  current.current = { workspace, save, onOpen }
  const connection = useRef<BroadcastChannel | null>(null)
  const subscribed = useRef(false)

  useEffect(() => {
    if (!enabled) return
    const channel = new BroadcastChannel(channelName)
    connection.current = channel
    const sendWorkspace = () => channel.postMessage({ type: 'workspace', workspace: current.current.workspace } satisfies WorkspaceMessage)

    channel.onmessage = (event: MessageEvent<OverlayRequest>) => {
      const message = event.data
      if (message.type === 'subscribe') {
        subscribed.current = true
        current.current.onOpen()
        sendWorkspace()
      } else if (message.type === 'unsubscribe') {
        subscribed.current = false
      } else if (message.type === 'change') {
        void (async () => {
          const { workspace, save } = current.current
          let error: string | undefined
          try {
            if (message.scope !== workspace.scope) throw new Error('The overlay workspace changed. Try again.')
            const { table, id } = message.change
            const records = workspace.goal ? workspace.data[table] : table === 'tasks' ? workspace.tasks : []
            if (!records?.some(record => record.id === id)) throw new Error('This item is no longer available in the overlay.')
            await save(message.change)
          } catch (reason) {
            error = reason instanceof Error ? reason.message : 'This change could not be saved.'
          }
          if (connection.current === channel) channel.postMessage({ type: 'result', requestId: message.requestId, error } satisfies WorkspaceMessage)
        })()
      }
    }
    sendWorkspace()
    return () => {
      connection.current = null
      subscribed.current = false
      channel.close()
    }
  }, [enabled])

  useEffect(() => {
    if (subscribed.current) connection.current?.postMessage({ type: 'workspace', workspace } satisfies WorkspaceMessage)
  }, [workspace])
}

export function useOverlaySubscriber() {
  const [workspace, setWorkspace] = useState<OverlayWorkspace>()
  const channel = useRef<BroadcastChannel | null>(null)
  const pending = useRef(new Map<string, { accept: () => void; reject: (reason: Error) => void }>())

  useEffect(() => {
    const next = new BroadcastChannel(channelName)
    channel.current = next
    next.onmessage = (event: MessageEvent<WorkspaceMessage>) => {
      const message = event.data
      if (message.type === 'workspace') {
        setWorkspace(message.workspace)
      } else if (message.type === 'result') {
        const request = pending.current.get(message.requestId)
        if (message.error) request?.reject(new Error(message.error))
        else request?.accept()
      }
    }
    next.postMessage({ type: 'subscribe' } satisfies OverlayRequest)
    const unsubscribe = () => next.postMessage({ type: 'unsubscribe' } satisfies OverlayRequest)
    window.addEventListener('pagehide', unsubscribe)
    return () => {
      window.removeEventListener('pagehide', unsubscribe)
      unsubscribe()
      next.close()
      channel.current = null
      for (const request of pending.current.values()) request.reject(new Error('The overlay closed before the save was confirmed.'))
    }
  }, [])

  function update(change: OverlayChange): Promise<void> {
    const connection = channel.current
    if (!connection || !workspace) return Promise.reject(new Error('The workspace is still opening.'))
    const requestId = crypto.randomUUID()
    const scope = workspace.scope
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timeout)
        pending.current.delete(requestId)
        if (error) reject(error)
        else resolve()
      }
      const timeout = window.setTimeout(() => finish(new Error('The workspace has not confirmed the change yet.')), 10_000)
      pending.current.set(requestId, { accept: () => finish(), reject: finish })
      connection.postMessage({ type: 'change', requestId, scope, change } satisfies OverlayRequest)
    })
  }

  return { workspace, update }
}
