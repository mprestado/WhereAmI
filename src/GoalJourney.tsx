import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Check, ChevronDown, ChevronLeft, ChevronRight, Circle, Plus } from 'lucide-react'
import CountControl from './CountControl'
import { hasCountTarget } from './counting'
import { deriveJourney, workForObjective } from './journey'
import { changeTaskStatus, put, touch, type Change, type ChecklistItem, type Task, type Workspace, type Roadmap } from './model'
import type { ObjectiveProgress } from './progress'
import { useObjectiveCarousel } from './useObjectiveCarousel'
import './goal-journey.css'

interface JourneyProps {
  data: Workspace
  goal: Roadmap
  commit: (changes: Change[]) => Promise<void>
  onAdjustCount: (table: 'objectives' | 'tasks' | 'checklistItems', id: string, delta: number) => Promise<void>
  focusId?: string
  startObjectiveId?: string
  onObjectiveChange?: (id: string) => void
  onGoalSettings: () => void
}

type WorkItem = { kind: 'task'; item: Task } | { kind: 'checklist'; item: ChecklistItem }

function itemId(id: string) {
  return 'goal-item-' + id
}

export default function GoalJourney({ data, goal, commit, onAdjustCount, focusId, startObjectiveId, onObjectiveChange, onGoalSettings }: JourneyProps) {
  const progress = deriveJourney(data, goal.id)
  const objectives = progress.ordered
  const directId = goal.id + '-other-tasks'
  const tiles = objectives.map(item => ({ id: item.objective.id, title: item.objective.title }))
  if (progress.directTasks.length) tiles.push({ id: directId, title: 'Other tasks' })
  const currentId = progress.current?.objective.id ?? null
  const followsSequence = goal.presentation !== 'list'
  const restoredId = tiles.find(tile => tile.id === startObjectiveId)?.id
  const initialId = followsSequence
    ? currentId ?? objectives.at(-1)?.objective.id ?? tiles[0]?.id
    : restoredId ?? tiles[0]?.id
  const idSequence = tiles.map(tile => tile.id).join('|')
  const carousel = useObjectiveCarousel(initialId ?? null, idSequence)
  const { track, selectedId, announcedId, goTo, step } = carousel
  const [error, setError] = useState('')
  const previousCurrentId = useRef(currentId)
  const dots = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (selectedId) onObjectiveChange?.(selectedId)
  }, [selectedId, onObjectiveChange])

  useLayoutEffect(() => {
    if (currentId === previousCurrentId.current) return
    previousCurrentId.current = currentId
    if (!followsSequence || !currentId) return
    const hadTrackFocus = track.current?.contains(document.activeElement)
    goTo(currentId)
    if (hadTrackFocus) {
      document.getElementById(itemId(currentId))?.querySelector('summary')?.focus({ preventScroll: true })
    }
  }, [currentId, followsSequence])

  useLayoutEffect(() => {
    const rail = dots.current
    const dot = rail?.querySelector('[aria-current="step"]')
    if (!rail || !dot) return
    const viewport = rail.getBoundingClientRect()
    const bounds = dot.getBoundingClientRect()
    const left = bounds.left - viewport.left - 4
    const right = bounds.right - viewport.right + 4
    if (left < 0) rail.scrollBy({ left })
    else if (right > 0) rail.scrollBy({ left: right })
  }, [selectedId, idSequence])

  useLayoutEffect(() => {
    if (!focusId) return
    const element = document.getElementById(itemId(focusId))
    if (!element) return
    const slide = element.closest<HTMLElement>('[data-objective-id]')
    const id = slide?.dataset.objectiveId
    if (!id || !slide) return
    goTo(id, true)
    const frame = requestAnimationFrame(() => {
      for (let node = element.parentElement; node && node !== slide; node = node.parentElement) {
        if (node instanceof HTMLDetailsElement) node.open = true
      }
      if (element === slide) slide.querySelector('summary')?.focus({ preventScroll: true })
      else element.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [focusId, idSequence])

  async function save(changes: Change[]) {
    setError('')
    try { await commit(changes) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'This change could not be saved. Try again.') }
  }

  const announcedIndex = tiles.findIndex(tile => tile.id === announcedId)
  const selectedIndex = tiles.findIndex(tile => tile.id === selectedId)

  return <div className={'goal-journey' + (tiles.length ? ' has-carousel' : '')}>
    <header className="journey-goal">
      <h1 className="journey-goal-title">{goal.title}</h1>
      <div className="journey-progress">
        <progress aria-label="Goal progress" aria-valuetext={progress.completed + ' of ' + progress.total + ' required steps complete'} value={progress.percent} max={100} />
        <span>{progress.percent}% complete</span>
      </div>
      {error && <p role="alert" className="form-error journey-error">{error}</p>}
    </header>

    {tiles.length > 0
      ? <section className="journey-carousel" aria-roledescription="carousel" aria-label="Goal objectives">
        <div className="journey-track" ref={track} role="region" aria-label="Objective slides" tabIndex={0}
          onKeyDown={event => {
            if (event.target !== event.currentTarget || event.altKey || event.metaKey || event.ctrlKey) return
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            step(event.key === 'ArrowLeft' ? -1 : 1)
          }}
          onPointerDown={carousel.startDrag} onPointerMove={carousel.moveDrag}
          onPointerUp={carousel.endDrag} onPointerCancel={carousel.endDrag} onPointerLeave={carousel.endDrag}
          onLostPointerCapture={carousel.endDrag} onClickCapture={event => {
            if (event.detail && carousel.suppressClick.current) {
              event.preventDefault()
              event.stopPropagation()
              carousel.suppressClick.current = false
            }
          }}>
          {objectives.map((item, index) => <ObjectiveSlide key={item.objective.id} data={data} progress={item}
            position={index + 1} total={tiles.length} selected={item.objective.id === selectedId}
            onSelect={() => goTo(item.objective.id)} save={save} onAdjustCount={onAdjustCount} />)}
          {progress.directTasks.length > 0 && <article
            className={'journey-slide' + (selectedId === directId ? ' is-selected' : '')} data-objective-id={directId}
            role="group" aria-roledescription="slide" aria-label={tiles.length + ' of ' + tiles.length + ': Other tasks'}>
            <h2 className="journey-slide-title journey-direct-title">Other tasks</h2>
            <div className="journey-slide-content">
              <ul className="journey-checklist">
                {progress.directTasks.map(item => <WorkRow key={item.id} row={{ kind: 'task', item }} save={save} onAdjustCount={onAdjustCount} />)}
              </ul>
            </div>
          </article>}
        </div>
        <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
          {announcedIndex >= 0 ? (announcedIndex + 1) + ' of ' + tiles.length + ': ' + tiles[announcedIndex].title : ''}
        </p>
        <nav className="journey-navigation" aria-label="Choose an objective">
          <JourneyArrow direction={-1} unavailable={selectedIndex <= 0} onStep={step} />
          <div className="journey-dots" ref={dots}>
            {tiles.map((tile, index) => <button key={tile.id} type="button"
              aria-label={tile.id === directId ? 'Show other tasks' : 'Show objective ' + (index + 1) + ': ' + tile.title}
              aria-current={tile.id === selectedId ? 'step' : undefined}
              onClick={() => goTo(tile.id)}><span /></button>)}
          </div>
          <JourneyArrow direction={1} unavailable={selectedIndex >= tiles.length - 1} onStep={step} />
        </nav>
      </section>
      : <section className="journey-empty-objectives" aria-label="No objectives">
        <p>No objectives yet</p>
        <button className="journey-manage-link" type="button" onClick={onGoalSettings}><Plus size={16} /> Add objectives</button>
      </section>}

  </div>
}

function JourneyArrow({ direction, unavailable, onStep }: {
  direction: -1 | 1
  unavailable: boolean
  onStep: (direction: -1 | 1, instant?: boolean) => void
}) {
  const timer = useRef(0)
  const repeated = useRef(false)
  const step = useRef(onStep)
  step.current = onStep

  function stop() {
    window.clearTimeout(timer.current)
  }

  useEffect(() => {
    if (unavailable) stop()
  }, [unavailable])
  useEffect(() => stop, [])

  function hold(event: ReactPointerEvent<HTMLButtonElement>) {
    if (unavailable || event.button !== 0) return
    repeated.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
    function repeat() {
      repeated.current = true
      step.current(direction)
      timer.current = window.setTimeout(repeat, 270)
    }
    timer.current = window.setTimeout(repeat, 380)
  }

  const Icon = direction < 0 ? ChevronLeft : ChevronRight
  return <button className="journey-arrow" type="button" aria-disabled={unavailable}
    aria-label={direction < 0 ? 'Previous objective' : 'Next objective'}
    onPointerDown={hold} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} onBlur={stop}
    onClick={event => {
      if (!unavailable && (!event.detail || !repeated.current)) onStep(direction)
      repeated.current = false
    }}><Icon size={20} aria-hidden="true" /></button>
}

function ObjectiveSlide({ data, progress, position, total, selected, onSelect, save, onAdjustCount }: {
  data: Workspace
  progress: ObjectiveProgress
  position: number
  total: number
  selected: boolean
  onSelect: () => void
  save: (changes: Change[]) => Promise<void>
  onAdjustCount: JourneyProps['onAdjustCount']
}) {
  const work = workForObjective(data, progress.objective.id)
  const isComplete = progress.isComplete
  const counted = hasCountTarget(progress.objective)
  const canCompleteManually = !counted && progress.total === 0
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState(true)

  async function act(changes: Change[]) {
    setSaving(true)
    try { await save(changes) }
    finally { setSaving(false) }
  }

  return <article id={itemId(progress.objective.id)} className={'journey-slide' + (selected ? ' is-selected' : '')}
    data-objective-id={progress.objective.id} role="group" aria-roledescription="slide"
    aria-label={position + ' of ' + total + ': ' + progress.objective.title}>
    <details className="journey-objective-details" open={selected && expanded}
      onToggle={event => {
        if (event.target === event.currentTarget && selected) setExpanded(event.currentTarget.open)
      }}>
      <summary aria-label={'Collapse or expand sub-objectives for ' + progress.objective.title}
        onClick={event => {
          if (selected) return
          event.preventDefault()
          onSelect()
        }}>
        {isComplete ? <Check className="journey-objective-status is-done" size={18} aria-hidden="true" />
          : <Circle className="journey-objective-status" size={15} aria-hidden="true" />}
        <span className="journey-slide-heading">
          <span className={'journey-slide-title' + (isComplete ? ' is-done' : '')}>{progress.objective.title}</span>
          {progress.objective.optional && <span className="journey-optional">Optional</span>}
        </span>
        <span className="journey-objective-progress">{progress.total > 0 && progress.completed + ' of ' + progress.total}</span>
        <ChevronDown className="journey-collapse-icon" size={17} aria-hidden="true" />
      </summary>
      <div className="journey-slide-content">
        {counted && <ObjectiveCounter objective={progress.objective} onAdjustCount={onAdjustCount} />}
        {canCompleteManually && <label className="journey-manual-completion">
          <span className="journey-item-check"><input type="checkbox" aria-label={'Complete ' + progress.objective.title} checked={isComplete} disabled={saving}
            onChange={event => void act([put('objectives', touch({ ...progress.objective, completed: event.target.checked }))])} /></span>
          <span>Complete objective</span>
        </label>}
        {work.length > 0 && <ul className="journey-checklist" aria-label={'Sub-objectives for ' + progress.objective.title}>
          {work.map(row => <WorkRow key={row.item.id} row={row} save={save} onAdjustCount={onAdjustCount} />)}
        </ul>}
        {progress.sideObjectives.map(side => <SideObjective key={side.objective.id} data={data} progress={side} save={save} selected={selected} onAdjustCount={onAdjustCount} />)}
        {!counted && work.length === 0 && progress.sideObjectives.length === 0 && <p className="journey-no-subobjectives">No sub-objectives</p>}
      </div>
    </details>
  </article>
}

function SideObjective({ data, progress, save, selected, onAdjustCount }: {
  data: Workspace
  progress: ObjectiveProgress
  save: (changes: Change[]) => Promise<void>
  selected: boolean
  onAdjustCount: JourneyProps['onAdjustCount']
}) {
  const work = workForObjective(data, progress.objective.id)
  const counted = hasCountTarget(progress.objective)
  const canCompleteManually = !counted && progress.total === 0
  const [saving, setSaving] = useState(false)

  async function act(changes: Change[]) {
    setSaving(true)
    try { await save(changes) }
    finally { setSaving(false) }
  }

  return <details className="journey-side-objective" open={selected}>
    <summary aria-label={'Collapse or expand optional objective ' + progress.objective.title}>
      {progress.isComplete ? <Check size={15} className="journey-objective-status is-done" aria-hidden="true" />
        : <Circle size={13} className="journey-objective-status" aria-hidden="true" />}
      <span className={'journey-side-objective-title' + (progress.isComplete ? ' is-done' : '')}>{progress.objective.title}</span>
      <span className="journey-optional">Optional</span>
      <ChevronDown className="journey-collapse-icon" size={15} aria-hidden="true" />
    </summary>
    <div className="journey-side-content">
      {counted && <ObjectiveCounter objective={progress.objective} onAdjustCount={onAdjustCount} />}
      {canCompleteManually && <label className="journey-manual-completion">
        <span className="journey-item-check"><input type="checkbox" aria-label={'Complete ' + progress.objective.title} checked={progress.isComplete} disabled={saving}
          onChange={event => void act([put('objectives', touch({ ...progress.objective, completed: event.target.checked }))])} /></span>
        <span>Complete optional objective</span>
      </label>}
      {progress.total > 0 && <p className="journey-objective-progress">{progress.completed} of {progress.total}</p>}
      {work.length > 0 && <ul className="journey-checklist" aria-label={'Sub-objectives for ' + progress.objective.title}>
        {work.map(row => <WorkRow key={row.item.id} row={row} save={save} onAdjustCount={onAdjustCount} />)}
      </ul>}
      {!counted && work.length === 0 && <p className="journey-no-subobjectives">No sub-objectives</p>}
    </div>
  </details>
}

function ObjectiveCounter({ objective, onAdjustCount }: {
  objective: ObjectiveProgress['objective']
  onAdjustCount: JourneyProps['onAdjustCount']
}) {
  return <div className="journey-objective-counter">
    <span>Count</span>
    <CountControl record={objective} onChange={delta => onAdjustCount('objectives', objective.id, delta)} />
  </div>
}

function WorkRow({ row, save, onAdjustCount }: {
  row: WorkItem
  save: (changes: Change[]) => Promise<void>
  onAdjustCount: JourneyProps['onAdjustCount']
}) {
  const completed = row.kind === 'task' ? row.item.status === 'completed' : row.item.completed
  const counted = hasCountTarget(row.item)
  const [saving, setSaving] = useState(false)

  async function toggle() {
    setSaving(true)
    const change = row.kind === 'task'
      ? put('tasks', changeTaskStatus(row.item, completed ? 'active' : 'completed'))
      : put('checklistItems', touch({ ...row.item, completed: !completed }))
    try { await save([change]) }
    finally { setSaving(false) }
  }

  if (counted) return <li id={itemId(row.item.id)} tabIndex={-1} className={'journey-work-row is-counted' + (completed ? ' is-done' : '')}>
    <div className="journey-count-title">
      <span className="journey-item-title">{row.item.title}</span>
      {row.item.optional && <span className="journey-optional">Optional</span>}
    </div>
    <CountControl record={row.item} onChange={delta => onAdjustCount(row.kind === 'task' ? 'tasks' : 'checklistItems', row.item.id, delta)} />
  </li>

  return <li id={itemId(row.item.id)} tabIndex={-1} className={'journey-work-row' + (completed ? ' is-done' : '')}>
    <label className="journey-item-check">
      <input type="checkbox" aria-label={'Complete ' + row.item.title} checked={completed} disabled={saving} onChange={() => void toggle()} />
    </label>
    <span className="journey-item-title">{row.item.title}</span>
    {row.item.optional && <span className="journey-optional">Optional</span>}
  </li>
}
