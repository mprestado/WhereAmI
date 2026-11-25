import { useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, ChevronUp, Ellipsis, Hash, Plus } from 'lucide-react'
import { CountTargetField, parseCountTarget } from './CountTargetField'
import { setCountTarget } from './counting'
import { localDate, newTask, put, recordBase, type Change, type GoalPresentation, type Roadmap } from './model'
import './goal-setup.css'

interface DraftTask {
  id: string
  title: string
  completed: boolean
  optional: boolean
  countTarget?: string
}

interface DraftObjective {
  id: string
  title: string
  optional: boolean
  countTarget?: string
  tasks: DraftTask[]
}

interface Props {
  commit: (changes: Change[]) => Promise<void>
  onCreated: (id: string) => void
  onCancel: () => void
}

function objectiveDraft(): DraftObjective {
  return { id: crypto.randomUUID(), title: '', optional: false, tasks: [] }
}

function objectiveField(id: string) { return 'setup-objective-' + id }
function taskField(id: string) { return 'setup-task-' + id }

function focusAfterChange(id: string, fallbackId?: string) {
  requestAnimationFrame(() => {
    const target = document.getElementById(id)
    if (target && !target.matches(':disabled')) target.focus()
    else if (fallbackId) document.getElementById(fallbackId)?.focus()
  })
}

type Direction = -1 | 1

function reorder<T>(items: T[], index: number, direction: Direction): T[] {
  const target = index + direction
  if (target < 0 || target >= items.length) return items
  const moved = [...items]
  moved.splice(target, 0, ...moved.splice(index, 1))
  return moved
}

function changesForGoal(goal: Roadmap, drafts: DraftObjective[]): Change[] {
  const phase = { ...recordBase(), roadmapId: goal.id, title: 'Objectives', description: '', position: 0 }
  const changes = [put('roadmaps', goal), put('phases', phase)]
  let nextTaskTime = Date.now()

  drafts.forEach((draft, position) => {
    const objective = {
      ...recordBase(), phaseId: phase.id, parentId: null,
      title: draft.title.trim(), description: '', position, goalPosition: position, completed: false, optional: draft.optional,
    }
    const objectiveTarget = parseCountTarget(draft.countTarget)
    changes.push(put('objectives', objectiveTarget === null ? objective : setCountTarget(objective, objectiveTarget)))
    for (const [position, row] of draft.tasks.filter(row => row.title.trim()).entries()) {
      const title = row.title.trim()
      // Preserve the draft order in older clients that still sort by creation time.
      const timestamp = new Date(nextTaskTime++).toISOString()
      const task = newTask(title, {
        roadmapId: goal.id, objectiveId: objective.id, inbox: false,
        optional: row.optional, position,
        status: row.completed ? 'completed' : 'active', completedAt: row.completed ? timestamp : null,
        createdAt: timestamp, updatedAt: timestamp,
      })
      const taskTarget = parseCountTarget(row.countTarget)
      changes.push(put('tasks', taskTarget === null ? task : setCountTarget(task, taskTarget)))
    }
  })
  return changes
}

interface FieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  variant?: 'goal' | 'objective' | 'task'
  describedBy?: string
}

function GrowingField({ id, label, value, onChange, placeholder, variant = 'objective', describedBy }: FieldProps) {
  const field = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const input = field.current
    if (!input || CSS.supports('field-sizing', 'content')) return

    function resize() {
      if (!input) return
      input.style.height = 'auto'
      input.style.height = `${input.scrollHeight + 2}px`
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [value])

  return <>
    <label htmlFor={id} className="visually-hidden">{label}</label>
    <textarea ref={field} id={id} className={'setup-input setup-input-' + variant} rows={1} maxLength={240} aria-describedby={describedBy}
      value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} />
  </>
}

const layouts: { value: GoalPresentation; name: string; description: string }[] = [
  { value: 'journey', name: 'Journey', description: 'Past → Present → Future' },
  { value: 'list', name: 'Task list', description: 'Work in any order' },
]

function LayoutChoice({ value, onChange }: { value: GoalPresentation; onChange: (value: GoalPresentation) => void }) {
  const id = useId()
  return <fieldset className="setup-layout">
    <legend>Goal layout</legend>
    <div className="setup-layout-choices">
      {layouts.map(layout => {
        const nameId = id + layout.value
        const helpId = nameId + '-help'
        return <label className="setup-layout-choice" key={layout.value}>
          <input type="radio" name={id} value={layout.value} checked={value === layout.value}
            aria-labelledby={nameId} aria-describedby={helpId} onChange={() => onChange(layout.value)} />
          <span><strong id={nameId}>{layout.name}</strong><small id={helpId}>{layout.description}</small></span>
        </label>
      })}
    </div>
  </fieldset>
}

interface ReorderProps {
  index: number
  count: number
  label: string
  fieldId: string
  onMove: (direction: Direction) => void
}

function ReorderButtons({ index, count, label, fieldId, onMove }: ReorderProps) {
  if (count < 2) return null

  function move(direction: Direction, id: string) {
    onMove(direction)
    focusAfterChange(id, fieldId)
  }

  const upId = fieldId + '-up'
  const downId = fieldId + '-down'
  return <>
    <button type="button" id={upId} className="icon-btn setup-order" title={'Move ' + label + ' up'}
      aria-label={'Move ' + label + ' up'} disabled={index === 0} onClick={() => move(-1, upId)}>
      <ChevronUp size={16} aria-hidden="true" />
    </button>
    <button type="button" id={downId} className="icon-btn setup-order" title={'Move ' + label + ' down'}
      aria-label={'Move ' + label + ' down'} disabled={index + 1 === count} onClick={() => move(1, downId)}>
      <ChevronDown size={16} aria-hidden="true" />
    </button>
  </>
}

interface ItemOptionsProps {
  label: string
  optional: boolean
  onOptional: () => void
  countEnabled: boolean
  onToggleCount: () => void
  onRemove: () => void
  removeLabel: string
  destinations?: { id: string; title: string }[]
  onReparent?: (id: string) => void
}

function ItemOptions({ label, optional, onOptional, countEnabled, onToggleCount, onRemove, removeLabel, destinations, onReparent }: ItemOptionsProps) {
  const options = useRef<HTMLDetailsElement>(null)
  const toggle = useRef<HTMLElement>(null)

  function toggleOptional() {
    onOptional()
    if (options.current) options.current.open = false
    toggle.current?.focus()
  }

  function toggleCount() {
    if (options.current) options.current.open = false
    onToggleCount()
    if (countEnabled) toggle.current?.focus()
  }

  return <details className="setup-options" ref={options} name="setup-item-options">
    <summary ref={toggle} className="icon-btn" aria-label={'Actions for ' + label}><Ellipsis size={19} aria-hidden="true" /></summary>
    <div className="setup-options-list">
      <button type="button" onClick={toggleOptional}>{optional ? 'Make required' : 'Mark optional'}</button>
      <button type="button" onClick={toggleCount}>{countEnabled ? 'Use checkbox' : 'Set count target'}</button>
      {destinations && destinations.length > 0 && onReparent && <label className="setup-reparent">
        Move to objective
        <select value="" onChange={event => {
          if (options.current) options.current.open = false
          onReparent(event.target.value)
        }}>
          <option value="" disabled>Choose objective</option>
          {destinations.map(target => <option value={target.id} key={target.id}>{target.title}</option>)}
        </select>
      </label>}
      <button type="button" onClick={onRemove}>{removeLabel}</button>
    </div>
  </details>
}

interface ObjectiveProps {
  draft: DraftObjective
  index: number
  count: number
  onChange: (draft: DraftObjective) => void
  onMove: (direction: Direction) => void
  onRemove: () => void
  destinations: { id: string; title: string }[]
  onReparent: (task: DraftTask, targetId: string) => void
}

function ObjectiveDraft({ draft, index, count, onChange, onMove, onRemove, destinations, onReparent }: ObjectiveProps) {
  const addTaskId = 'setup-add-task-' + draft.id
  const number = index + 1
  const fieldId = objectiveField(draft.id)
  const targetId = fieldId + '-count-target'
  const hasTarget = draft.countTarget !== undefined

  function addTask() {
    const row = { id: crypto.randomUUID(), title: '', completed: false, optional: false }
    onChange({ ...draft, tasks: [...draft.tasks, row] })
    focusAfterChange(taskField(row.id))
  }

  function removeTask(index: number) {
    const tasks = draft.tasks.filter((_, current) => current !== index)
    onChange({ ...draft, tasks })
    const adjacent = tasks[index] ?? tasks[index - 1]
    focusAfterChange(adjacent ? taskField(adjacent.id) : addTaskId)
  }

  function updateTask(id: string, fields: Partial<DraftTask>) {
    onChange({ ...draft, tasks: draft.tasks.map(task => task.id === id ? { ...task, ...fields } : task) })
  }

  return <li className="setup-objective">
    <div className="setup-objective-heading">
      <span className="setup-objective-number" aria-hidden="true">{number}.</span>
      <div className="setup-item-field">
        <GrowingField id={fieldId} label={'Objective ' + number} value={draft.title} describedBy={draft.optional ? fieldId + '-optional' : undefined}
          placeholder="What needs to happen?" onChange={title => onChange({ ...draft, title })} />
        {draft.optional && <span id={fieldId + '-optional'} className="setup-optional">Optional</span>}
        {draft.countTarget !== undefined && <CountTargetField id={targetId} itemLabel={'objective ' + number} value={draft.countTarget}
          onChange={countTarget => onChange({ ...draft, countTarget })} />}
      </div>
      <div className="setup-item-actions">
        <ReorderButtons index={index} count={count} label={'objective ' + number} fieldId={fieldId} onMove={onMove} />
        <ItemOptions label={'objective ' + number} optional={draft.optional} removeLabel="Remove objective"
          onOptional={() => onChange({ ...draft, optional: !draft.optional })} onRemove={onRemove}
          countEnabled={hasTarget} onToggleCount={() => {
            onChange({ ...draft, countTarget: hasTarget ? undefined : '' })
            if (!hasTarget) focusAfterChange(targetId)
          }} />
      </div>
    </div>
    <div className="setup-sub-objectives">
      {draft.tasks.length > 0 && <ul>
        {draft.tasks.map((task, taskIndex) => {
          const label = 'sub-objective ' + (taskIndex + 1) + ' for objective ' + number
          const subFieldId = taskField(task.id)
          const subTargetId = subFieldId + '-count-target'
          const hasTaskTarget = task.countTarget !== undefined
          return <li className="setup-task" key={task.id}>
            {hasTaskTarget ? <span className="setup-task-toggle setup-count-mark" aria-hidden="true"><Hash size={15} /></span>
              : <label className="setup-task-toggle">
              <input type="checkbox" checked={task.completed} disabled={!task.title.trim()} aria-label={'Complete ' + label}
                onChange={event => updateTask(task.id, { completed: event.target.checked })} />
            </label>}
            <div className="setup-item-field">
              <GrowingField id={subFieldId} label={label[0].toUpperCase() + label.slice(1)} variant="task"
                describedBy={task.optional ? subFieldId + '-optional' : undefined}
                placeholder="Sub-objective" value={task.title} onChange={title => updateTask(task.id, { title })} />
              {task.optional && <span id={subFieldId + '-optional'} className="setup-optional">Optional</span>}
              {task.countTarget !== undefined && <CountTargetField id={subTargetId} itemLabel={label} value={task.countTarget}
                onChange={countTarget => updateTask(task.id, { countTarget })} />}
            </div>
            <div className="setup-item-actions">
              <ReorderButtons index={taskIndex} count={draft.tasks.length} label={label} fieldId={subFieldId}
                onMove={direction => onChange({ ...draft, tasks: reorder(draft.tasks, taskIndex, direction) })} />
              <ItemOptions label={label} optional={task.optional} removeLabel="Remove sub-objective" onOptional={() => updateTask(task.id, { optional: !task.optional })}
                countEnabled={hasTaskTarget} onToggleCount={() => {
                  updateTask(task.id, { countTarget: hasTaskTarget ? undefined : '' })
                  if (!hasTaskTarget) focusAfterChange(subTargetId)
                }}
                onRemove={() => removeTask(taskIndex)} destinations={destinations} onReparent={id => onReparent(task, id)} />
            </div>
          </li>
        })}
      </ul>}
      <button type="button" id={addTaskId} className="btn btn-quiet setup-add-task" onClick={addTask}>
        <Plus size={15} /> Add sub-objective
      </button>
    </div>
  </li>
}

export default function GoalSetup({ commit, onCreated, onCancel }: Props) {
  const [step, setStep] = useState<'goal' | 'objectives'>('goal')
  const [goal, setGoal] = useState('')
  const [presentation, setPresentation] = useState<GoalPresentation>('journey')
  const [objectives, setObjectives] = useState<DraftObjective[]>([])
  const [discard, setDiscard] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const questionId = useId()
  const goalId = useId()
  const addId = useId()
  const cancelId = useId()
  const editId = useId()

  useLayoutEffect(() => { document.getElementById(goalId)?.focus() }, [goalId])

  function cancel() {
    const hasDraft = goal.trim() || objectives.some(row => row.title.trim() || row.tasks.some(task => task.title.trim()))
    if (!hasDraft) {
      onCancel()
      return
    }
    setDiscard(true)
    focusAfterChange(editId)
  }

  function addObjective() {
    const draft = objectiveDraft()
    setObjectives(rows => [...rows, draft])
    focusAfterChange(objectiveField(draft.id))
  }

  function continueSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!goal.trim()) return
    setStep('objectives')
    setError('')
    if (objectives.length === 0) addObjective()
    else focusAfterChange(objectiveField(objectives[0].id))
  }

  function removeObjective(index: number) {
    const remaining = objectives.filter((_, current) => current !== index)
    setObjectives(remaining)
    const adjacent = remaining[index] ?? remaining[index - 1]
    focusAfterChange(adjacent ? objectiveField(adjacent.id) : addId)
  }

  function reparentTask(task: DraftTask, sourceId: string, targetId: string) {
    setObjectives(rows => rows.map(row => {
      if (row.id === sourceId) return { ...row, tasks: row.tasks.filter(item => item.id !== task.id) }
      if (row.id === targetId) return { ...row, tasks: [...row.tasks, task] }
      return row
    }))
    focusAfterChange(taskField(task.id))
  }

  function back() {
    setStep('goal')
    setError('')
    focusAfterChange(goalId)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || discard || !goal.trim()) return
    const unnamed = objectives.find(row => !row.title.trim() && row.tasks.some(task => task.title.trim()))
    if (unnamed) {
      setError('Name this objective before adding sub-objectives.')
      document.getElementById(objectiveField(unnamed.id))?.focus()
      return
    }
    const unnamedObjective = objectives.find(row => !row.title.trim() && row.countTarget !== undefined)
    const unnamedTask = objectives.flatMap(row => row.tasks).find(task => !task.title.trim() && task.countTarget !== undefined)
    const unnamedTrackerField = unnamedObjective ? objectiveField(unnamedObjective.id) : unnamedTask && taskField(unnamedTask.id)
    if (unnamedTrackerField) {
      setError('Give each count tracker a name.')
      document.getElementById(unnamedTrackerField)?.focus()
      return
    }

    const roadmap: Roadmap = {
      ...recordBase(), title: goal.trim(), purpose: '', startingPoint: '', outcome: '',
      startDate: localDate(), targetDate: null, archived: false, presentation,
    }
    setSaving(true)
    setError('')
    try {
      await commit(changesForGoal(roadmap, objectives.filter(row => row.title.trim())))
      onCreated(roadmap.id)
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Could not save your goal.')
      setSaving(false)
    }
  }

  const cancelActions = discard ? <div className="setup-discard" role="group" aria-label="Discard goal draft">
    <p>Discard this goal draft?</p>
    <button type="button" id={editId} className="btn btn-quiet" onClick={() => { setDiscard(false); focusAfterChange(cancelId) }}>Keep editing</button>
    <button type="button" className="btn btn-danger" onClick={onCancel}>Discard</button>
  </div> : null

  if (step === 'goal') return <section className="goal-setup setup-question" aria-labelledby={questionId}>
    <form onSubmit={continueSetup}>
      <h1 id={questionId}>What is your goal?</h1>
      <GrowingField id={goalId} label="Your goal" variant="goal" placeholder="Write your goal" value={goal} onChange={setGoal} />
      <LayoutChoice value={presentation} onChange={setPresentation} />
      {cancelActions ?? <div className="setup-actions">
        <button type="button" id={cancelId} className="btn btn-quiet" onClick={cancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={!goal.trim()}>Continue</button>
      </div>}
    </form>
  </section>

  return <section className="goal-setup setup-document" aria-labelledby={questionId}>
    <form onSubmit={save} aria-busy={saving}>
      <fieldset className="setup-fields" disabled={saving}>
        <GrowingField id={goalId} label="Goal title" variant="goal" placeholder="Write your goal" value={goal} onChange={setGoal} />
        <h1 id={questionId}>Objectives</h1>
        <ol className="setup-objectives">
          {objectives.map((row, index) => <ObjectiveDraft key={row.id} draft={row} index={index} count={objectives.length}
            onChange={draft => setObjectives(current => current.map(item => item.id === draft.id ? draft : item))}
            onMove={direction => setObjectives(rows => reorder(rows, index, direction))} onRemove={() => removeObjective(index)}
            destinations={objectives.flatMap((item, position) => item.id === row.id ? [] : [{ id: item.id, title: item.title.trim() || 'Objective ' + (position + 1) }])}
            onReparent={(task, id) => reparentTask(task, row.id, id)} />)}
        </ol>
        <button type="button" id={addId} className="btn btn-quiet setup-add-objective" onClick={addObjective}><Plus size={17} /> Add objective</button>
        {error && <p className="form-error" role="alert">{error}</p>}
        {cancelActions ?? <div className="setup-actions">
          <button type="button" id={cancelId} className="btn btn-quiet" onClick={cancel}>Cancel</button>
          <button type="button" className="btn btn-quiet setup-back" onClick={back}>Back</button>
          <button type="submit" className="btn btn-primary" disabled={!goal.trim()}>{saving ? 'Saving…' : 'Create goal'}</button>
        </div>}
      </fieldset>
    </form>
  </section>
}
