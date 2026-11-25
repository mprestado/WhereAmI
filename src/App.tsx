import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, CheckCircle2, CloudOff, Plus, X } from 'lucide-react'
import CaptureField from './Capture'
import Dialog from './Dialog'
import GoalJourney from './GoalJourney'
import GoalSettings from './GoalSettings'
import GoalSetup from './GoalSetup'
import SearchDialog from './SearchDialog'
import Settings, { AccountDialog, syncLabels } from './Settings'
import { TaskEditor, TaskList, taskTitles, type TaskDefaults } from './Tasks'
import WorkspaceMenu, { closeWorkspaceMenu } from './WorkspaceMenu'
import { changeTaskStatus, emptyWorkspace, localDate, newTask, put, type Task } from './model'
import { hasTaskOverlay, openTaskOverlay } from './desktopOverlay'
import { goalOverlayData, useOverlayPublisher, type OverlayWorkspace } from './overlayWorkspace'
import { useWorkspace } from './storage'
import { sortTasks, tasksForView, type SearchResult, type TaskView } from './taskViews'
import './canvas.css'

type View = 'goal' | 'create' | 'settings' | TaskView
type Route = { view: View; goalId?: string; focusId?: string }
type OverlayFocus = { account: string; goalId?: string; objectiveId?: string; taskView: TaskView }
type Modal = { type: 'capture' | 'search' | 'account' }
  | { type: 'task'; taskId: string | null; defaults?: TaskDefaults }
  | { type: 'goal-settings'; goalId: string }

function readRoute(): Route {
  const [view, goalId, focusId] = window.location.hash.slice(1).split('/')
  if (view === 'roadmaps' || view === 'goal') return { view: 'goal', goalId, focusId }
  if (view === 'create' || view === 'settings' || Object.hasOwn(taskTitles, view)) return { view: view as View }
  return { view: 'goal' }
}

function selectedGoal(key: string, id?: string) {
  try {
    if (id) localStorage.setItem(key, id)
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function useToday() {
  const [today, setToday] = useState(localDate)
  useEffect(() => {
    const update = () => setToday(localDate())
    const interval = window.setInterval(update, 30000)
    window.addEventListener('focus', update)
    return () => { window.clearInterval(interval); window.removeEventListener('focus', update) }
  }, [])
  return today
}

export default function App() {
  const workspace = useWorkspace()
  const { data, commit, session, syncState, adjustWorkspaceCount, setWorkspaceCompletion } = workspace
  const today = useToday()
  const [route, setRoute] = useState(readRoute)
  const [modal, setModal] = useState<Modal | null>(null)
  const modalCloseTimer = useRef<number | null>(null)
  const [creatingGoalId, setCreatingGoalId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null)
  const [overlayFocus, setOverlayFocus] = useState<OverlayFocus>()
  const selectedObjective = useRef<{ key: string; id: string } | null>(null)
  const selectionKey = 'whereami:last-goal:' + (session?.id ?? 'device')
  const goals = data.roadmaps.filter(row => !row.archived)
    .sort((first, second) => first.createdAt.localeCompare(second.createdAt) || first.id.localeCompare(second.id))
  const explicit = route.view === 'goal' ? route.goalId : undefined
  const activeGoal = goals.find(row => row.id === explicit)
    ?? goals.find(row => row.id === selectedGoal(selectionKey))
    ?? goals[0]
  const objectiveKey = selectionKey + '/' + activeGoal?.id
  const objectiveId = selectedObjective.current?.key === objectiveKey ? selectedObjective.current.id : undefined
  const creationPending = creatingGoalId !== null && activeGoal?.id !== creatingGoalId && explicit === creatingGoalId
  const theme = data.settings[0]?.theme ?? 'system'
  const title = route.view === 'goal' ? activeGoal?.title
    : route.view === 'create' ? 'New goal'
      : route.view === 'settings' ? 'Settings' : taskTitles[route.view]
  const inboxCount = tasksForView(data.tasks, 'inbox', today).length
  const trayAvailable = hasTaskOverlay()
  const taskView = route.view === 'inbox' || route.view === 'active' || route.view === 'today' || route.view === 'upcoming'
    ? route.view : undefined
  const pinned = overlayFocus?.account === selectionKey ? overlayFocus : undefined
  const overlayGoal = pinned ? goals.find(goal => goal.id === pinned.goalId) : taskView ? undefined : activeGoal
  const overlayObjectiveId = pinned ? pinned.objectiveId : objectiveId
  const overlayTaskView = pinned?.taskView ?? taskView ?? 'inbox'
  function overlaySource(): OverlayFocus {
    return {
      account: selectionKey,
      goalId: taskView ? undefined : activeGoal?.id,
      objectiveId: !taskView && selectedObjective.current?.key === objectiveKey ? selectedObjective.current.id : undefined,
      taskView: taskView ?? 'inbox',
    }
  }
  const overlayWorkspace = useMemo<OverlayWorkspace>(() => ({
    scope: JSON.stringify([selectionKey, overlayGoal?.id ?? overlayTaskView]),
    data: trayAvailable && overlayGoal ? goalOverlayData(data, overlayGoal) : emptyWorkspace(),
    goal: overlayGoal,
    objectiveId: overlayObjectiveId,
    tasks: trayAvailable && !overlayGoal ? sortTasks(tasksForView(data.tasks, overlayTaskView, today), 'relevant', today, overlayTaskView) : [],
    taskViewTitle: taskTitles[overlayTaskView],
    theme,
    syncState,
  }), [data, overlayGoal, overlayObjectiveId, overlayTaskView, selectionKey, syncState, theme, today, trayAvailable])
  useOverlayPublisher(trayAvailable, overlayWorkspace, change => change.kind === 'count'
    ? adjustWorkspaceCount(change.table, change.id, change.delta)
    : setWorkspaceCompletion(change.table, change.id, change.completed), () => {
    if (!pinned && syncState !== 'loading') setOverlayFocus(previous => previous?.account === selectionKey ? previous : overlaySource())
  })

  useEffect(() => () => {
    if (modalCloseTimer.current !== null) window.clearTimeout(modalCloseTimer.current)
  }, [])
  useEffect(() => {
    const read = () => { closeWorkspaceMenu(); setRoute(readRoute()) }
    window.addEventListener('hashchange', read)
    window.addEventListener('popstate', read)
    return () => { window.removeEventListener('hashchange', read); window.removeEventListener('popstate', read) }
  }, [])
  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  useEffect(() => { document.title = title ? title + ' · WhereAmI' : 'WhereAmI' }, [title])
  useEffect(() => {
    if (route.view === 'goal' && activeGoal && !creationPending) selectedGoal(selectionKey, activeGoal.id)
  }, [activeGoal, creationPending, route.view, selectionKey])
  useEffect(() => {
    if (creatingGoalId && (activeGoal?.id === creatingGoalId || explicit !== creatingGoalId)) setCreatingGoalId(null)
  }, [activeGoal, creatingGoalId, explicit])

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey || event.repeat || document.querySelector('dialog[open]')) return
      if (event.code === 'Space' && event.shiftKey) {
        event.preventDefault()
        closeWorkspaceMenu()
        presentModal({ type: 'capture' })
      } else if (event.key.toLowerCase() === 'k' && !event.shiftKey && route.view !== 'create') {
        event.preventDefault()
        closeWorkspaceMenu()
        presentModal({ type: 'search' })
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [route.view])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), toast.error ? 8000 : 3500)
    return () => window.clearTimeout(timer)
  }, [toast])

  async function showOverlay() {
    closeWorkspaceMenu()
    setOverlayFocus(overlaySource())
    try {
      await openTaskOverlay()
    } catch {
      setToast({ text: 'Windows could not open the task overlay. Try again.', error: true })
    }
  }
  useEffect(() => {
    if (!trayAvailable || route.view === 'create') return
    function openFromKeyboard(event: KeyboardEvent) {
      if (event.ctrlKey && event.shiftKey && !event.altKey && !event.repeat && event.code === 'Period' && !document.querySelector('dialog[open]')) {
        event.preventDefault()
        void showOverlay()
      }
    }
    window.addEventListener('keydown', openFromKeyboard)
    return () => window.removeEventListener('keydown', openFromKeyboard)
  }, [activeGoal?.id, objectiveKey, route.view, selectionKey, taskView, trayAvailable])

  function visit(view: View, goalId?: string, focusId?: string, replace = false) {
    closeWorkspaceMenu()
    const hash = '#' + [view, goalId, focusId].filter(Boolean).join('/')
    if (window.location.hash !== hash) {
      if (replace) window.history.replaceState(null, '', hash)
      else window.history.pushState(null, '', hash)
    }
    setRoute({ view, goalId, focusId })
    window.scrollTo(0, 0)
  }

  function presentModal(next: Modal) {
    if (modalCloseTimer.current !== null) window.clearTimeout(modalCloseTimer.current)
    modalCloseTimer.current = null
    document.querySelector('dialog[open]')?.removeAttribute('data-closing')
    setModal(next)
  }
  function closeModal() {
    if (modalCloseTimer.current !== null) window.clearTimeout(modalCloseTimer.current)
    const dialog = document.querySelector<HTMLDialogElement>('dialog[open]')
    if (!dialog || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      modalCloseTimer.current = null
      setModal(null)
      return
    }
    dialog.dataset.closing = 'true'
    modalCloseTimer.current = window.setTimeout(() => {
      modalCloseTimer.current = null
      setModal(null)
    }, 170)
  }
  function openTask(taskId: string | null, defaults?: TaskDefaults) {
    presentModal({ type: 'task', taskId, defaults: defaults?.roadmapId ? { ...defaults, inbox: false } : defaults })
  }
  async function capture(title: string) {
    await commit([put('tasks', newTask(title))])
  }
  function toggle(task: Task) {
    if (task.status === 'archived') return
    const status = task.status === 'completed' ? 'active' : 'completed'
    void commit([put('tasks', changeTaskStatus(task, status))])
      .catch(issue => setToast({ text: issue instanceof Error ? issue.message : 'Could not update the task.', error: true }))
  }
  function searchResult(result: SearchResult) {
    if (result.kind === 'task') {
      openTask(result.id)
      return
    }
    const goal = data.roadmaps.find(row => row.id === result.goalId)
    if (!goal) { closeModal(); return }
    if (goal.archived) { presentModal({ type: 'goal-settings', goalId: goal.id }); return }
    closeModal()
    visit('goal', goal.id, result.kind === 'objective' ? result.id : undefined)
  }

  const selectedTask = modal?.type === 'task' ? data.tasks.find(task => task.id === modal.taskId) : undefined
  const goalSettings = modal?.type === 'goal-settings' ? data.roadmaps.find(goal => goal.id === modal.goalId) : undefined
  const showingUtility = route.view !== 'goal' && route.view !== 'create'
  const goalReady = !creationPending && (syncState !== 'loading' || !!activeGoal)
  let utility
  if (route.view === 'settings') {
    utility = <Settings key={session?.id ?? 'device'} {...workspace} setting={data.settings[0]} onSignIn={() => presentModal({ type: 'account' })} onSignOut={workspace.signOut} />
  } else if (route.view !== 'goal' && route.view !== 'create') {
    utility = <TaskList key={route.view} view={route.view} data={data} today={today} onOpen={openTask}
      onToggle={toggle} onAdjustCount={(id, delta) => adjustWorkspaceCount('tasks', id, delta)}
      onNew={() => openTask(null, route.view === 'today' ? { plannedDate: today, inbox: false } : undefined)} />
  }

  return <div className="canvas-shell">
    {route.view !== 'create' && <WorkspaceMenu goals={goals} archivedGoals={data.roadmaps.filter(goal => goal.archived)} activeGoal={activeGoal} inboxCount={inboxCount}
      syncState={syncState} pending={workspace.pending} session={session}
      onSelectGoal={id => visit('goal', id)} onCreateGoal={() => visit('create')}
      onGoalSettings={goalId => presentModal({ type: 'goal-settings', goalId })} onTasks={view => visit(view)}
      onOpenOverlay={trayAvailable ? () => void showOverlay() : undefined}
      onSettings={() => visit('settings')} onCapture={() => presentModal({ type: 'capture' })}
      onSearch={() => presentModal({ type: 'search' })} />}
    <div className="visually-hidden" role="status">{syncState === 'local' ? '' : syncLabels[syncState]}</div>
    <main id="main-content" tabIndex={-1} aria-busy={route.view === 'goal' && !goalReady}>
      {route.view === 'create' && <GoalSetup commit={commit} onCancel={() => visit('goal', activeGoal?.id, undefined, true)}
        onCreated={id => { setCreatingGoalId(id); visit('goal', id, undefined, true) }} />}
      {route.view === 'goal' && goalReady && (activeGoal
        ? <GoalJourney key={activeGoal.id} data={data} goal={activeGoal} commit={commit} onAdjustCount={adjustWorkspaceCount} focusId={route.focusId}
            startObjectiveId={objectiveId} onObjectiveChange={id => { selectedObjective.current = { key: objectiveKey, id } }}
            onGoalSettings={() => presentModal({ type: 'goal-settings', goalId: activeGoal.id })} />
        : <div className="canvas-center empty-canvas">
            <button type="button" className="canvas-start" aria-label="Create a goal" onClick={() => visit('create')}><Plus size={29} strokeWidth={1.4} /></button>
            <p>Start with a goal</p>
          </div>)}
      {showingUtility && <div className="canvas-utility">
        <button className="canvas-back" type="button" onClick={() => visit('goal', activeGoal?.id)}><ArrowLeft size={17} /> {activeGoal ? 'Back to goal' : 'Back to canvas'}</button>
        {utility}
      </div>}
    </main>
    {modal?.type === 'capture' && <Dialog title="Quick capture" onClose={closeModal}><CaptureField onCapture={capture} /></Dialog>}
    {modal?.type === 'task' && (modal.taskId && !selectedTask ? <Dialog title="Task unavailable" onClose={closeModal}><p>This task may have been deleted on another device.</p></Dialog> : <TaskEditor key={modal.taskId ?? 'new'} existing={selectedTask ?? null} defaults={modal.defaults} data={data} onClose={closeModal} commit={commit} />)}
    {modal?.type === 'search' && <SearchDialog data={data} onClose={closeModal} onSelect={searchResult} />}
    {modal?.type === 'account' && <AccountDialog onClose={closeModal} signIn={workspace.signIn} signUp={workspace.signUp} />}
    {goalSettings && <GoalSettings key={goalSettings.id} data={data} goal={goalSettings} commit={commit} onClose={closeModal}
      milestones={data.milestones.filter(item => item.roadmapId === goalSettings.id).sort((a, b) => a.position - b.position)}
      onArchiveChange={(goal, archived) => { closeModal(); visit('goal', archived ? undefined : goal.id) }} />}
    {toast && <div className={'toast' + (toast.error ? ' toast-error' : '')} role={toast.error ? 'alert' : 'status'}>{toast.error ? <CloudOff size={17} /> : <CheckCircle2 size={17} />}{toast.text}<button className="icon-btn" aria-label="Dismiss message" onClick={() => setToast(null)}><X size={16} /></button></div>}
  </div>
}
