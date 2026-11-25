import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CloudOff, GripVertical, Maximize2, Minus, Plus, TriangleAlert, X } from 'lucide-react'
import CountControl from './CountControl'
import { hasCountTarget } from './counting'
import { resizeTaskOverlay } from './desktopOverlay'
import { deriveJourney, workForObjective, type ObjectiveWork } from './journey'
import { changeTaskStatus, put, touch, type Change, type Roadmap, type Task, type Workspace } from './model'
import type { ObjectiveProgress } from './progress'
import { syncLabels, type SyncState } from './Settings'
import './task-overlay.css'

interface Props {
  data: Workspace
  goal?: Roadmap
  objectiveId?: string
  tasks: Task[]
  taskViewTitle: string
  commit: (changes: Change[]) => Promise<void>
  onAdjustCount: (table: 'objectives' | 'tasks' | 'checklistItems', id: string, delta: number) => Promise<void>
  collapsed: boolean
  changingMode: boolean
  windowError: string
  syncState: SyncState
  onToggleCollapsed: () => void
  onRestore: () => void
  onClose: () => void
  onDrag: () => void
  onObjectiveChange?: (id: string) => void
}

type OverlayContent = {
  id: string
  title: string
  context?: string
  objective?: ObjectiveProgress
  tasks: Task[]
  summary: string
}

const ZOOM_KEY = 'whereami:overlay-text-zoom'
const DEFAULT_ZOOM = 100
const MIN_ZOOM = 80
const MAX_ZOOM = 130
const ZOOM_STEP = 10

function overlayZoom(value: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(value / ZOOM_STEP) * ZOOM_STEP))
}

function useOverlayZoom() {
  const [zoom, setZoom] = useState(() => {
    try {
      const saved = Number(window.localStorage.getItem(ZOOM_KEY))
      if (Number.isFinite(saved) && saved >= MIN_ZOOM && saved <= MAX_ZOOM) return overlayZoom(saved)
    } catch { /* Zoom remains available when local preferences are blocked. */ }
    return DEFAULT_ZOOM
  })
  useEffect(() => {
    try { window.localStorage.setItem(ZOOM_KEY, String(zoom)) }
    catch { /* Keep the in-memory preference for the current overlay. */ }
  }, [zoom])
  useEffect(() => {
    function handleZoomKey(event: KeyboardEvent) {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.isComposing || event.defaultPrevented) return
      const minus = event.key === '-' || event.code === 'NumpadSubtract'
      const plus = event.key === '+' || event.key === '=' || event.code === 'NumpadAdd'
      const reset = event.key === '0'
      if (!minus && !plus && !reset) return
      event.preventDefault()
      setZoom(value => reset ? DEFAULT_ZOOM : overlayZoom(value + (plus ? ZOOM_STEP : -ZOOM_STEP)))
    }
    window.addEventListener('keydown', handleZoomKey)
    return () => window.removeEventListener('keydown', handleZoomKey)
  }, [])
  return { zoom, setZoom }
}

function taskContent(id: string, title: string, candidates: Task[], context?: string): OverlayContent {
  const tasks = candidates.filter(task => task.status !== 'archived')
  const completed = tasks.filter(task => task.status === 'completed').length
  let summary = 'No tasks'
  if (completed) summary = completed + ' of ' + tasks.length + ' complete'
  else if (tasks.length) summary = tasks.length + ' ' + (tasks.length === 1 ? 'task' : 'tasks')
  return { id, title, tasks, context, summary }
}

function objectiveContent(objective: ObjectiveProgress, context: string): OverlayContent {
  const summary = objective.total
    ? objective.completed + ' of ' + objective.total + ' required complete'
    : objective.isComplete ? 'Complete' : '1 step left'
  return { id: objective.objective.id, title: objective.objective.title, context, objective, summary, tasks: [] }
}

function overlayContents({ data, goal, tasks, taskViewTitle }: Pick<Props, 'data' | 'goal' | 'tasks' | 'taskViewTitle'>) {
  if (!goal) {
    const current = taskContent(taskViewTitle, taskViewTitle, tasks)
    return { pages: [current], current, goalPercent: undefined }
  }

  const journey = deriveJourney(data, goal.id)
  const pages = journey.ordered.map(objective => objectiveContent(objective, goal.title))
  const otherTasks = journey.directTasks.length
    ? taskContent(goal.id + '-other-tasks', 'Other tasks', journey.directTasks, goal.title)
    : undefined
  if (otherTasks) pages.push(otherTasks)

  const next = journey.current ?? journey.optional.find(item => !item.isComplete)
  const nextId = next?.objective.id
  const nextPage = pages.find(page => page.id === nextId)
  const activeOtherTasks = otherTasks?.tasks.some(task => task.status === 'active') ? otherTasks : undefined
  const current = nextPage ?? activeOtherTasks ?? pages.at(-1) ?? taskContent(goal.id, goal.title, [])
  return { pages, current, goalPercent: journey.percent }
}

export default function TaskOverlay({
  data, goal, objectiveId, tasks, taskViewTitle, commit, onAdjustCount, collapsed, changingMode, windowError, syncState,
  onToggleCollapsed, onRestore, onClose, onDrag, onObjectiveChange,
}: Props) {
  const contentId = useId()
  const scroll = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const [actionError, setActionError] = useState('')
  const { zoom, setZoom } = useOverlayZoom()
  const { pages, current, goalPercent } = useMemo(() => overlayContents({ data, goal, tasks, taskViewTitle }),
    [data, goal, tasks, taskViewTitle])
  const isTaskList = goal?.presentation === 'list'
  const [viewingId, setViewingId] = useState(() => isTaskList ? objectiveId ?? current.id : undefined)
  const content = pages.find(page => page.id === viewingId) ?? current
  const position = pages.indexOf(content)
  const previous = pages[position - 1]
  const next = position >= 0 ? pages[position + 1] : undefined
  const error = windowError || actionError
  const hasSyncNotice = syncState === 'failed' || syncState === 'offline' || syncState === 'saving'
  const title = collapsed ? content.title : goal?.title ?? 'WhereAmI'
  const goalInTitle = title === goal?.title
  const compactCaption = error || (hasSyncNotice ? syncLabels[syncState] : content.summary)

  useLayoutEffect(() => {
    if (!collapsed && scroll.current) {
      scroll.current.scrollTop = 0
      if (document.activeElement === document.body) heading.current?.focus({ preventScroll: true })
    }
  }, [content.id, collapsed])

  async function saveAction(action: () => Promise<void>) {
    setActionError('')
    try { await action() }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : 'This change could not be saved.') }
  }

  function save(change: Change) {
    return saveAction(() => commit([change]))
  }

  function adjust(table: CountTable, id: string, delta: number) {
    return saveAction(() => onAdjustCount(table, id, delta))
  }

  function showObjective(page: OverlayContent | undefined) {
    if (!page) return
    // Returning to the current Journey objective resumes automatic progression.
    setViewingId(isTaskList || page.id !== current.id ? page.id : undefined)
    onObjectiveChange?.(page.id)
  }

  return <main className="task-overlay" data-collapsed={collapsed} aria-label="Task overlay"
    style={{ '--task-overlay-scale': zoom / 100 } as CSSProperties}>
    <header className="task-overlay-header">
      <div className="task-overlay-grip" title="Drag to move the task overlay"
        onMouseDown={event => {
          if (event.button === 0 && !changingMode) {
            event.preventDefault()
            onDrag()
          }
        }}>
        <GripVertical size={15} aria-hidden="true" />
        <div className="task-overlay-header-label" title={collapsed ? compactCaption : undefined}>
          <div className="task-overlay-name-line">
            <span className="task-overlay-header-title">{title}</span>
            {goalInTitle && goalPercent !== undefined && <GoalPercentage percent={goalPercent} />}
          </div>
          {collapsed && (!goalInTitle && goal && !error && !hasSyncNotice
            ? <div className="task-overlay-name-line">
              <span className="task-overlay-caption">{goal.title}</span>
              {goalPercent !== undefined && <GoalPercentage percent={goalPercent} />}
              <span className="visually-hidden">{compactCaption}</span>
            </div>
            : <span className="task-overlay-caption">{compactCaption}</span>)}
        </div>
      </div>
      {!collapsed && <OverlayZoom zoom={zoom} onZoom={setZoom} />}
      <button type="button" className="task-overlay-button" aria-label={collapsed ? 'Expand task overlay' : 'Collapse task overlay'}
        title={collapsed ? 'Expand task overlay' : 'Collapse task overlay'} aria-expanded={!collapsed} aria-controls={contentId}
        aria-disabled={changingMode} onClick={() => { if (!changingMode) onToggleCollapsed() }}>
        {collapsed ? <ChevronDown size={17} aria-hidden="true" /> : <ChevronUp size={17} aria-hidden="true" />}
      </button>
      <button type="button" className="task-overlay-button" aria-label="Open full app" title="Open full app"
        aria-disabled={changingMode} onClick={() => { if (!changingMode) onRestore() }}>
        <Maximize2 size={15} aria-hidden="true" />
      </button>
      <button type="button" className="task-overlay-button" aria-label="Close task overlay" title="Close task overlay"
        aria-disabled={changingMode} onClick={() => { if (!changingMode) onClose() }}>
        <X size={16} aria-hidden="true" />
      </button>
    </header>

    <div id={contentId} ref={scroll} className="task-overlay-content" hidden={collapsed}>
      {!collapsed && <div key={content.id}>
        <div className="task-overlay-heading">
          <h1 ref={heading} tabIndex={-1}>{content.title}</h1>
          <p role="status">{content.summary}</p>
        </div>
        {content.objective
          ? <>
            <ObjectiveChecks data={data} progress={content.objective} save={save} adjust={adjust} />
            {content.objective.sideObjectives.map(side => <details className="task-overlay-side" key={side.objective.id}>
              <summary>
                <span>{side.objective.title}</span>
                <small>Optional</small>
                <ChevronDown size={14} aria-hidden="true" />
              </summary>
              <ObjectiveChecks data={data} progress={side} save={save} adjust={adjust} />
            </details>)}
          </>
          : content.tasks.length > 0
            ? <WorkChecks work={content.tasks.map(item => ({ kind: 'task', item }))} save={save} adjust={adjust} />
            : syncState === 'loading' && <p className="task-overlay-caption">Opening workspace…</p>}
      </div>}
    </div>
    <div role="alert" className={collapsed ? 'visually-hidden' : 'task-overlay-error'}>
      {error && <><TriangleAlert size={14} aria-hidden="true" /><span>{error}</span></>}
    </div>
    {hasSyncNotice && <p role="status" className={collapsed ? 'visually-hidden' : 'task-overlay-sync'}>
      {syncState !== 'saving' && <CloudOff size={14} aria-hidden="true" />}{syncLabels[syncState]}
    </p>}
    {!collapsed && pages.length > 1 && <nav className="task-overlay-navigation" aria-label="Overlay objectives">
      <button type="button" className="task-overlay-button" aria-label="Previous objective" title="Previous objective"
        aria-controls={contentId} aria-disabled={!previous} onClick={() => showObjective(previous)}>
        <ChevronLeft size={20} aria-hidden="true" />
      </button>
      <p className="task-overlay-position" role="status" aria-atomic="true">
        <span aria-hidden="true">{position + 1} of {pages.length}</span>
        <span className="visually-hidden">Objective {position + 1} of {pages.length}: {content.title}</span>
      </p>
      <button type="button" className="task-overlay-button" aria-label="Next objective" title="Next objective"
        aria-controls={contentId} aria-disabled={!next} onClick={() => showObjective(next)}>
        <ChevronRight size={20} aria-hidden="true" />
      </button>
    </nav>}
    {!collapsed && <div className="task-overlay-resize-grip" title="Drag to change the overlay width and height" aria-hidden="true"
      onPointerDown={event => {
        if (event.button !== 0 || changingMode) return
        event.preventDefault()
        void resizeTaskOverlay().catch(() => setActionError('Windows could not start resizing the overlay.'))
      }}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2 7L7 2M2 11L11 2M6 11L11 6" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      </svg>
    </div>}
  </main>
}

function GoalPercentage({ percent }: { percent: number }) {
  return <output className="task-overlay-goal-percent" aria-label="Goal progress">{percent}%</output>
}

function OverlayZoom({ zoom, onZoom }: { zoom: number; onZoom: (zoom: number) => void }) {
  const menu = useRef<HTMLDetailsElement>(null)
  const trigger = useRef<HTMLElement>(null)
  return <details className="task-overlay-zoom" ref={menu}
    onBlur={event => {
      if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) return
      event.currentTarget.open = false
    }}
    onKeyDown={event => {
      if (event.key !== 'Escape' || !menu.current?.open) return
      event.stopPropagation()
      menu.current.open = false
      trigger.current?.focus()
    }}>
    <summary ref={trigger} className="task-overlay-button task-overlay-zoom-trigger"
      aria-label="Text size" title="Text size (Ctrl + or Ctrl −)">Aa</summary>
    <div className="task-overlay-zoom-options" aria-label="Overlay text size" role="group">
      <button type="button" className="task-overlay-button" aria-label="Decrease text size" aria-disabled={zoom <= MIN_ZOOM}
        onClick={() => { if (zoom > MIN_ZOOM) onZoom(zoom - ZOOM_STEP) }}>
        <Minus size={16} aria-hidden="true" />
      </button>
      <button type="button" className="task-overlay-zoom-reset" aria-label={`Text size ${zoom}%, reset to 100%`}
        title="Reset text size (Ctrl 0)" onClick={() => onZoom(DEFAULT_ZOOM)}>{zoom}%</button>
      <button type="button" className="task-overlay-button" aria-label="Increase text size" aria-disabled={zoom >= MAX_ZOOM}
        onClick={() => { if (zoom < MAX_ZOOM) onZoom(zoom + ZOOM_STEP) }}>
        <Plus size={16} aria-hidden="true" />
      </button>
    </div>
  </details>
}

type Save = (change: Change) => Promise<void>
type CountTable = 'objectives' | 'tasks' | 'checklistItems'
type Adjust = (table: CountTable, id: string, delta: number) => Promise<void>

function ObjectiveChecks({ data, progress, save, adjust }: { data: Workspace; progress: ObjectiveProgress; save: Save; adjust: Adjust }) {
  const { objective } = progress
  const work = workForObjective(data, objective.id)
  return <>
    {hasCountTarget(objective)
      ? <div className="task-overlay-objective-count">
        <CountControl record={objective} onChange={delta => adjust('objectives', objective.id, delta)} />
      </div>
      : progress.total === 0 && <OverlayCheck
      title={objective.title} label="Complete objective" checked={progress.isComplete}
      onChange={checked => save(put('objectives', touch({ ...objective, completed: checked })))} />}
    <WorkChecks work={work} save={save} adjust={adjust} />
  </>
}

function WorkChecks({ work, save, adjust }: { work: ObjectiveWork[]; save: Save; adjust: Adjust }) {
  return <div className="task-overlay-checks">{work.map(row => {
    const checked = row.kind === 'task' ? row.item.status === 'completed' : row.item.completed
    if (hasCountTarget(row.item)) return <div key={row.kind + '/' + row.item.id}
      className="task-overlay-check task-overlay-count" data-checked={checked}>
      <div>
        <span className="task-overlay-check-title">{row.item.title}</span>
        {row.item.optional && <small>Optional</small>}
      </div>
      <CountControl record={row.item} onChange={delta => adjust(row.kind === 'task' ? 'tasks' : 'checklistItems', row.item.id, delta)} />
    </div>
    return <OverlayCheck key={row.kind + '/' + row.item.id} title={row.item.title} checked={checked} optional={row.item.optional}
      onChange={next => save(row.kind === 'task'
        ? put('tasks', changeTaskStatus(row.item, next ? 'completed' : 'active'))
        : put('checklistItems', touch({ ...row.item, completed: next })))} />
  })}</div>
}

function OverlayCheck({ title, label = title, checked, optional, onChange }: {
  title: string
  label?: string
  checked: boolean
  optional?: boolean
  onChange: (next: boolean) => Promise<void>
}) {
  const [pending, setPending] = useState(false)
  const inFlight = useRef(false)

  async function toggle(next: boolean) {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    try { await onChange(next) }
    finally { inFlight.current = false; setPending(false) }
  }

  return <label className="task-overlay-check" data-checked={checked}>
    <input type="checkbox" aria-label={'Complete ' + title} checked={checked} aria-disabled={pending}
      onChange={event => void toggle(event.currentTarget.checked)} />
    <span className="task-overlay-check-title">{label}</span>
    {optional && <small>Optional</small>}
  </label>
}
