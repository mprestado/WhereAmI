import { useEffect, useState } from 'react'
import {
  Archive, ArchiveRestore, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronUp, Circle,
  Compass, Flag, GitCommitHorizontal, List, MapPin, Pencil, Plus, Route, Target,
} from 'lucide-react'
import { changeTaskStatus, formatDate, put, touch } from './model'
import type { Change, Roadmap, Task, Workspace } from './model'
import { deriveRoadmapProgress } from './progress'
import type { ObjectiveProgress, PhaseProgress, RoadmapProgress } from './progress'
import RoadmapEditor from './RoadmapEditor'
import type { RoadmapEdit } from './RoadmapEditor'
import './roadmaps.css'

interface RoadmapsProps {
  data: Workspace
  roadmapId: string | null
  focusId?: string | null
  onOpen: (id: string | null) => void
  commit: (changes: Change[]) => Promise<void>
  onTask: (taskId: string | null, defaults?: { roadmapId: string; objectiveId?: string }) => void
}

interface DetailProps extends RoadmapsProps {
  roadmap: Roadmap
}

interface DetailActions {
  roadmap: Roadmap
  onEdit: (editor: RoadmapEdit) => void
  onTask: RoadmapsProps['onTask']
  onChange: (changes: Change[]) => void
}

const phaseLabels: Record<PhaseProgress['status'], string> = {
  completed: 'Completed',
  active: 'Current phase',
  upcoming: 'Upcoming',
}

const roadmapDateFormat = { year: 'numeric', month: 'short', day: 'numeric' } as const

function goToRoadmapItem(id: string) {
  const target = document.getElementById(`roadmap-item-${id}`)
  if (!target) return
  const details = target.closest('details')
  if (details) details.open = true
  target.focus({ preventScroll: true })
  target.scrollIntoView({ block: 'nearest' })
}

export default function Roadmaps(props: RoadmapsProps) {
  const roadmap = props.data.roadmaps.find((row) => row.id === props.roadmapId)
  if (roadmap) return <RoadmapDetail key={roadmap.id} {...props} roadmap={roadmap} />
  return <RoadmapIndex {...props} />
}

function RequiredProgress({ progress }: { progress: RoadmapProgress }) {
  const { completed, total } = progress.requiredTasks
  if (total === 0) return <span className="rm-progress-label muted">No required tasks yet</span>
  return (
    <div className="rm-required-progress">
      <progress aria-label="Required task completion" value={completed} max={total} />
      <span className="rm-progress-label">{completed} of {total} required tasks completed</span>
    </div>
  )
}

function RoadmapIndex({ data, onOpen, commit }: RoadmapsProps) {
  const [editing, setEditing] = useState(false)
  const ordered = [...data.roadmaps].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const rows = ordered.map((roadmap) => ({ roadmap, progress: deriveRoadmapProgress(data, roadmap.id) }))
  const groups = [
    { title: 'Active roadmaps', rows: rows.filter(({ roadmap, progress }) => !roadmap.archived && !progress.isComplete) },
    { title: 'Completed roadmaps', rows: rows.filter(({ roadmap, progress }) => !roadmap.archived && progress.isComplete) },
    { title: 'Archived roadmaps', rows: rows.filter(({ roadmap }) => roadmap.archived) },
  ]
  return (
    <div className="rm-page">
      <header className="rm-page-heading">
        <div>
          <h1>Roadmaps</h1>
          <p>Plan the steps toward a larger goal.</p>
        </div>
        <button className="btn btn-primary" type="button" onClick={() => setEditing(true)}>
          <Plus size={18} aria-hidden="true" /> New roadmap
        </button>
      </header>
      {rows.length === 0 && (
        <div className="rm-empty rm-panel">
          <span className="rm-empty-icon"><Route size={25} aria-hidden="true" /></span>
          <h2>No roadmaps yet</h2>
          <p>Add a roadmap when a goal needs several steps.</p>
        </div>
      )}
      {groups.map((group) => group.rows.length > 0 && (
        <section key={group.title} className="rm-index-group" aria-label={group.title}>
          <h2>{group.title}</h2>
          <div className="rm-index-grid">
            {group.rows.map(({ roadmap, progress }) => (
              <article key={roadmap.id} className="rm-card rm-panel">
                <div className="rm-card-heading">
                  <span className="rm-card-icon"><Route size={20} aria-hidden="true" /></span>
                  {roadmap.targetDate && (
                    <span className="rm-meta"><CalendarDays size={15} aria-hidden="true" /> {formatDate(roadmap.targetDate, roadmapDateFormat)}</span>
                  )}
                </div>
                <h3><button type="button" className="rm-title-button" onClick={() => onOpen(roadmap.id)}>{roadmap.title}</button></h3>
                {(roadmap.purpose || roadmap.outcome) && <p>{roadmap.purpose || roadmap.outcome}</p>}
                <RequiredProgress progress={progress} />
                {progress.currentPhase && (
                  <div className="rm-card-current"><MapPin size={15} aria-hidden="true" /> {progress.currentPhase.title}</div>
                )}
              </article>
            ))}
          </div>
        </section>
      ))}
      {editing && (
        <RoadmapEditor
          data={data}
          editor={{ kind: 'roadmap' }}
          commit={commit}
          onClose={() => setEditing(false)}
          onSaved={(id) => { setEditing(false); onOpen(id) }}
        />
      )}
    </div>
  )
}

function RoadmapDetail({ roadmap, data, focusId, onOpen, commit, onTask }: DetailProps) {
  const [editor, setEditor] = useState<RoadmapEdit | null>(null)
  const [view, setView] = useState<'timeline' | 'list'>('timeline')
  const [error, setError] = useState('')
  const progress = deriveRoadmapProgress(data, roadmap.id)
  const { currentPhase, nextMilestone } = progress

  useEffect(() => {
    if (focusId) goToRoadmapItem(focusId)
  }, [focusId])

  function change(changes: Change[]) {
    setError('')
    void commit(changes).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'The change could not be saved. Try again.')
    })
  }

  function movePhase(index: number, direction: -1 | 1) {
    const phases = progress.phases.map(({ phase }) => phase)
    const destination = index + direction
    if (destination < 0 || destination >= phases.length) return
    const moved = phases[index]
    phases[index] = phases[destination]
    phases[destination] = moved
    const changes = phases.flatMap((phase, position) => phase.position === position
      ? []
      : [put('phases', touch({ ...phase, position }))])
    change(changes)
  }

  const actions: DetailActions = { roadmap, onEdit: setEditor, onTask, onChange: change }

  return (
    <div className="rm-page">
      <button className="rm-back" type="button" onClick={() => onOpen(null)}>
        <ChevronLeft size={19} aria-hidden="true" /> Roadmaps
      </button>
      <header className="rm-page-heading rm-detail-heading">
        <div>
          <div className="rm-heading-title">
            <span className="rm-card-icon"><Route size={23} aria-hidden="true" /></span>
            <h1>{roadmap.title}</h1>
          </div>
          {roadmap.purpose && <p>{roadmap.purpose}</p>}
        </div>
        <div className="rm-heading-actions">
          <button className="btn btn-secondary" type="button" onClick={() => setEditor({ kind: 'roadmap', row: roadmap })}>
            <Pencil size={16} aria-hidden="true" /> Edit roadmap
          </button>
          <button
            className="icon-btn"
            type="button"
            aria-label={roadmap.archived ? 'Restore roadmap' : 'Archive roadmap'}
            title={roadmap.archived ? 'Restore roadmap' : 'Archive roadmap'}
            onClick={() => change([put('roadmaps', touch({ ...roadmap, archived: !roadmap.archived }))])}
          >
            {roadmap.archived ? <ArchiveRestore size={19} aria-hidden="true" /> : <Archive size={19} aria-hidden="true" />}
          </button>
        </div>
      </header>
      {error && <p className="rm-error" role="alert">{error}</p>}
      <div className="rm-overview rm-panel">
        <div className="rm-overview-main">
          <div className="rm-overview-heading">
            <h2>Progress</h2>
            {roadmap.archived && <span className="rm-pill">Archived</span>}
            {!roadmap.archived && progress.isComplete && <span className="rm-pill rm-pill-completed">Completed</span>}
          </div>
          <RequiredProgress progress={progress} />
          {progress.requiredTasks.total > 0 && !progress.isComplete && (
            <span className="rm-meta">
              {progress.requiredTasks.total - progress.requiredTasks.completed} required tasks remaining
            </span>
          )}
          <div className="rm-plan-dates">
            <span className="rm-meta"><CalendarDays size={16} aria-hidden="true" /> Start {formatDate(roadmap.startDate, roadmapDateFormat)}</span>
            {roadmap.targetDate && <span className="rm-meta"><Target size={16} aria-hidden="true" /> Target {formatDate(roadmap.targetDate, roadmapDateFormat)}</span>}
          </div>
        </div>
        <dl className="rm-goals">
          {roadmap.startingPoint && (
            <div><dt><MapPin size={16} aria-hidden="true" /> Starting point</dt><dd>{roadmap.startingPoint}</dd></div>
          )}
          {roadmap.outcome && (
            <div><dt><Flag size={16} aria-hidden="true" /> Desired outcome</dt><dd>{roadmap.outcome}</dd></div>
          )}
          {currentPhase && (
            <div>
              <dt><Compass size={16} aria-hidden="true" /> Current phase</dt>
              <dd><button type="button" className="rm-title-button" onClick={() => goToRoadmapItem(currentPhase.id)}>{currentPhase.title}</button></dd>
            </div>
          )}
          {nextMilestone && (
            <div>
              <dt><Flag size={16} aria-hidden="true" /> Next milestone</dt>
              <dd>
                <button type="button" className="rm-title-button" onClick={() => goToRoadmapItem(nextMilestone.id)}>
                  {nextMilestone.title}
                </button>
                {nextMilestone.targetDate && <span> · {formatDate(nextMilestone.targetDate, roadmapDateFormat)}</span>}
              </dd>
            </div>
          )}
        </dl>
      </div>

      <section className="rm-section" aria-labelledby="roadmap-phases-heading">
        <div className="rm-section-heading">
          <h2 id="roadmap-phases-heading">Phases</h2>
          <div className="rm-heading-actions">
            {progress.phases.length > 0 && (
              <div className="rm-segmented" role="group" aria-label="Phase view">
                <button type="button" aria-pressed={view === 'timeline'} onClick={() => setView('timeline')}>
                  <GitCommitHorizontal size={17} aria-hidden="true" /> Timeline
                </button>
                <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>
                  <List size={17} aria-hidden="true" /> List
                </button>
              </div>
            )}
            <button className="btn btn-secondary" type="button" onClick={() => setEditor({ kind: 'phase', roadmapId: roadmap.id })}>
              <Plus size={17} aria-hidden="true" /> Add phase
            </button>
          </div>
        </div>
        {view === 'timeline' && progress.phases.length > 0 && (
          <ol className="rm-timeline rm-panel" aria-label="Roadmap timeline">
            {progress.phases.map(({ phase, status }) => (
              <li key={phase.id} className={`rm-timeline-step rm-step-${status}`}>
                <button type="button" onClick={() => goToRoadmapItem(phase.id)}>
                  <span className="rm-step-marker">
                    {status === 'completed' ? <Check size={15} aria-hidden="true" /> : status === 'active'
                      ? <MapPin size={15} aria-hidden="true" /> : <Circle size={10} aria-hidden="true" />}
                  </span>
                  <span className="rm-step-label">{phaseLabels[status]}</span>
                  <strong>{phase.title}</strong>
                </button>
              </li>
            ))}
          </ol>
        )}
        <div className="rm-phase-list">
          {progress.phases.length === 0 && <p className="rm-inline-empty">Add the first phase to break this roadmap into steps.</p>}
          {progress.phases.map((phaseProgress, index) => (
            <PhaseGroup
              key={phaseProgress.phase.id}
              progress={phaseProgress}
              index={index}
              count={progress.phases.length}
              onMove={movePhase}
              actions={actions}
            />
          ))}
        </div>
      </section>

      <section className="rm-section" aria-labelledby="roadmap-milestones-heading">
        <div className="rm-section-heading">
          <h2 id="roadmap-milestones-heading">Milestones</h2>
          <button className="btn btn-secondary" type="button" onClick={() => setEditor({ kind: 'milestone', roadmapId: roadmap.id })}>
            <Plus size={17} aria-hidden="true" /> Add milestone
          </button>
        </div>
        {progress.milestones.length === 0
          ? <p className="rm-inline-empty">Add a checkpoint to make the next milestone visible.</p>
          : (
            <ul className="rm-panel rm-row-list">
              {progress.milestones.map((milestone) => {
                const phase = progress.phases.find(({ phase }) => phase.id === milestone.phaseId)?.phase
                const done = !!milestone.completedAt
                return (
                  <li className="rm-row" key={milestone.id} id={`roadmap-item-${milestone.id}`} tabIndex={-1}>
                    <input
                      className="rm-checkbox"
                      type="checkbox"
                      checked={done}
                      aria-label={`${done ? 'Reopen' : 'Complete'} milestone ${milestone.title}`}
                      onChange={() => change([put('milestones', touch({ ...milestone, completedAt: done ? null : new Date().toISOString() }))])}
                    />
                    <div className="rm-row-content">
                      <button type="button" className="rm-title-button" onClick={() => setEditor({ kind: 'milestone', roadmapId: roadmap.id, row: milestone })}>
                        <span className={done ? 'rm-done' : ''}>{milestone.title}</span>
                      </button>
                      <div className="rm-row-meta">
                        {phase && <span>{phase.title}</span>}
                        {milestone.targetDate && <span>Target {formatDate(milestone.targetDate, roadmapDateFormat)}</span>}
                        {milestone.completedAt && <span>Completed {formatDate(milestone.completedAt, roadmapDateFormat)}</span>}
                      </div>
                    </div>
                    {progress.nextMilestone?.id === milestone.id && <span className="rm-pill rm-pill-active">Next milestone</span>}
                  </li>
                )
              })}
            </ul>
          )}
      </section>

      <section className="rm-section" aria-labelledby="roadmap-tasks-heading">
        <div className="rm-section-heading">
          <h2 id="roadmap-tasks-heading">Roadmap tasks</h2>
          <button className="btn btn-secondary" type="button" onClick={() => onTask(null, { roadmapId: roadmap.id })}>
            <Plus size={17} aria-hidden="true" /> Add task
          </button>
        </div>
        {progress.directTasks.length > 0
          ? <TaskRows tasks={progress.directTasks} actions={actions} />
          : <p className="rm-inline-empty">Tasks assigned directly to this roadmap appear here.</p>}
      </section>
      {editor && (
        <RoadmapEditor
          data={data}
          editor={editor}
          commit={commit}
          onClose={() => setEditor(null)}
          onSaved={() => setEditor(null)}
        />
      )}
    </div>
  )
}

function PhaseGroup({ progress, index, count, actions, onMove }: {
  progress: PhaseProgress
  index: number
  count: number
  actions: DetailActions
  onMove: (index: number, direction: -1 | 1) => void
}) {
  const { phase, status, mainObjectives, completed, total } = progress
  const [open, setOpen] = useState(status === 'active')
  return (
    <details
      className="rm-phase rm-panel"
      id={`roadmap-item-${phase.id}`}
      tabIndex={-1}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <ChevronDown size={19} className="rm-disclosure" aria-hidden="true" />
        <span className="rm-phase-label">
          <strong>{phase.title}</strong>
          <span className="rm-meta">{completed} of {total} main objectives complete</span>
        </span>
        <span className={`rm-pill rm-pill-${status}`}>{phaseLabels[status]}</span>
      </summary>
      <div className="rm-phase-content">
        {phase.description && <p className="rm-phase-description">{phase.description}</p>}
        <div className="rm-phase-actions">
          <button className="btn btn-secondary" type="button" onClick={() => actions.onEdit({ kind: 'objective', phaseId: phase.id, parentId: null })}>
            <Plus size={16} aria-hidden="true" /> Add main objective
          </button>
          <button
            className="icon-btn"
            type="button"
            aria-label={`Edit phase ${phase.title}`}
            title="Edit phase"
            onClick={() => actions.onEdit({ kind: 'phase', roadmapId: phase.roadmapId, row: phase })}
          >
            <Pencil size={17} aria-hidden="true" />
          </button>
          {count > 1 && (
            <>
              <button
                className="icon-btn"
                type="button"
                aria-label={`Move ${phase.title} earlier`}
                title="Move phase earlier"
                disabled={index === 0}
                onClick={() => onMove(index, -1)}
              >
                <ChevronUp size={19} aria-hidden="true" />
              </button>
              <button
                className="icon-btn"
                type="button"
                aria-label={`Move ${phase.title} later`}
                title="Move phase later"
                disabled={index === count - 1}
                onClick={() => onMove(index, 1)}
              >
                <ChevronDown size={19} aria-hidden="true" />
              </button>
            </>
          )}
        </div>
        {mainObjectives.length > 0 && (
          <div className="rm-objectives">
            {mainObjectives.map((objective) => <ObjectiveCard key={objective.objective.id} progress={objective} actions={actions} />)}
          </div>
        )}
      </div>
    </details>
  )
}

function ObjectiveCard({ actions, progress }: { actions: DetailActions; progress: ObjectiveProgress }) {
  const { objective, tasks, checklistItems, total, completed, isComplete, sideObjectives } = progress
  const side = !!objective.parentId
  const icon = side ? <Circle size={16} aria-hidden="true" /> : <Target size={18} aria-hidden="true" />
  const heading = (
    <button
      className="rm-title-button"
      type="button"
      onClick={() => actions.onEdit({ kind: 'objective', phaseId: objective.phaseId, parentId: objective.parentId, row: objective })}
    >
      {objective.title}
    </button>
  )
  return (
    <article
      className={`rm-objective${side ? ' rm-side-objective' : ''}`}
      id={`roadmap-item-${objective.id}`}
      tabIndex={-1}
    >
      <div className="rm-objective-heading">
        <span className="rm-objective-icon">{isComplete ? <Check size={18} aria-hidden="true" /> : icon}</span>
        <div>
          {side ? <h4>{heading}</h4> : <h3>{heading}</h3>}
          <span className="rm-meta">{side ? 'Side objective · Optional' : 'Main objective'}</span>
        </div>
        <span className={`rm-pill${isComplete ? ' rm-pill-completed' : ''}`}>
          {isComplete ? 'Completed' : total > 0 ? `${completed} of ${total} complete` : 'Open'}
        </span>
      </div>
      {objective.description && <p className="rm-objective-description">{objective.description}</p>}
      {checklistItems.length > 0 && (
        <ul className="rm-checklist">
          {checklistItems.map((item) => (
            <li key={item.id}>
              <label>
                <input
                  className="rm-checkbox"
                  type="checkbox"
                  checked={item.completed}
                  onChange={() => actions.onChange([put('checklistItems', touch({ ...item, completed: !item.completed }))])}
                />
                <span className={item.completed ? 'rm-done' : ''}>{item.title}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {tasks.length > 0 && <TaskRows tasks={tasks} actions={actions} />}
      <div className="rm-objective-actions">
        <button className="btn btn-secondary" type="button" onClick={() => actions.onTask(null, { roadmapId: actions.roadmap.id, objectiveId: objective.id })}>
          <Plus size={16} aria-hidden="true" /> Add task
        </button>
        {!side && (
          <button
            className="btn btn-secondary"
            type="button"
            onClick={() => actions.onEdit({ kind: 'objective', phaseId: objective.phaseId, parentId: objective.id })}
          >
            <Plus size={16} aria-hidden="true" /> Add side objective
          </button>
        )}
        {total === 0 && (
          <button
            className="btn btn-secondary"
            type="button"
            onClick={() => actions.onChange([put('objectives', touch({ ...objective, completed: !objective.completed }))])}
          >
            {isComplete ? 'Reopen objective' : 'Complete objective'}
          </button>
        )}
      </div>
      {sideObjectives.length > 0 && (
        <div className="rm-side-objectives">
          {sideObjectives.map((sideProgress) => (
            <ObjectiveCard key={sideProgress.objective.id} actions={actions} progress={sideProgress} />
          ))}
        </div>
      )}
    </article>
  )
}

function TaskRows({ tasks, actions }: { tasks: Task[]; actions: DetailActions }) {
  return (
    <ul className="rm-row-list rm-panel">
      {tasks.map((task) => {
        const done = task.status === 'completed'
        return (
          <li className="rm-row" key={task.id}>
            <input
              className="rm-checkbox"
              type="checkbox"
              checked={done}
              aria-label={`${done ? 'Reopen' : 'Complete'} task ${task.title}`}
              onChange={() => actions.onChange([put('tasks', changeTaskStatus(task, done ? 'active' : 'completed'))])}
            />
            <div className="rm-row-content">
              <button type="button" className="rm-title-button" onClick={() => actions.onTask(task.id)}>
                <span className={done ? 'rm-done' : ''}>{task.title}</span>
              </button>
              {task.dueDate && <div className="rm-row-meta">Due {formatDate(task.dueDate)}</div>}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
