import { useState, type FormEvent } from 'react'
import { Archive, CalendarDays, CalendarRange, Check, CheckCircle2, ChevronDown, ChevronUp, Circle, Flag, Hash, ListChecks, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import CountControl from './CountControl'
import { DraftCountTarget, parseCountTarget } from './CountTargetField'
import { adjustCount, hasCountTarget, setCountTarget, type CountableRecord } from './counting'
import Dialog from './Dialog'
import {
  changeTaskStatus, formatDate, newTask, put, recordBase, remove, touch,
  type Change, type ChecklistItem, type Priority, type Task, type Workspace,
} from './model'
import { priorityLabels, sortTasks, tasksForView, type TaskSort, type TaskView } from './taskViews'

export const taskTitles: Record<TaskView, string> = {
  inbox: 'Inbox', today: 'Today', upcoming: 'Upcoming', active: 'All active', completed: 'Completed', archived: 'Archived',
}

const descriptions: Record<TaskView, string> = {
  inbox: 'A place for everything you’ve captured and want to sort later.',
  today: 'Tasks planned for today and deadlines that fall today.',
  upcoming: 'A look at future work dates and deadlines.',
  active: 'Every task you have left to do.',
  completed: 'Work you’ve finished. Reopen any task if plans change.',
  archived: 'Stored tasks that have been set aside.',
}

const emptyText: Record<TaskView, string> = {
  inbox: 'New captures will land here.',
  today: 'Give a task today’s planned date to add it here.',
  upcoming: 'Tasks with a future planned date or deadline will appear here.',
  active: 'Capture a task to get it out of your head.',
  completed: 'Completed tasks will appear here.',
  archived: 'Archived tasks will appear here.',
}

interface TaskRowProps {
  task: Task
  data: Workspace
  today: string
  onOpen: (id: string) => void
  onToggle: (task: Task) => void
  onAdjustCount: (taskId: string, delta: number) => Promise<void>
}

function TaskRow({ task, data, today, onOpen, onToggle, onAdjustCount }: TaskRowProps) {
  const roadmap = data.roadmaps.find(row => row.id === task.roadmapId)
  const checklist = data.checklistItems.filter(row => row.taskId === task.id)
  const complete = task.status === 'completed'
  const counted = task.status !== 'archived' && Boolean(task.countTarget)
  return (
    <li className={'task-row' + (counted ? ' task-row-counted' : '')}>
      {counted ? <CountControl record={task} onChange={delta => onAdjustCount(task.id, delta)}
      /> : task.status === 'archived'
        ? <Archive size={19} className="muted" aria-label="Archived" />
        : <button type="button" role="checkbox" aria-checked={complete} aria-label={'Complete ' + task.title} className={'task-check' + (complete ? ' checked' : '')} onClick={() => onToggle(task)}>{complete && <Check size={14} strokeWidth={2.7} />}</button>}
      <button type="button" className={'task-title' + (complete ? ' task-complete' : '')} onClick={() => onOpen(task.id)}>{task.title}</button>
      <div className="task-meta">
        {task.status === 'archived' && task.countTarget && <span aria-label="Saved count">{task.countValue ?? 0}/{task.countTarget}</span>}
        {roadmap && <span className="task-roadmap">{roadmap.title}</span>}
        {checklist.length > 0 && <span aria-label={checklist.filter(row => row.completed).length + ' of ' + checklist.length + ' checklist items complete'}><ListChecks size={15} /> {checklist.filter(row => row.completed).length}/{checklist.length}</span>}
        {task.plannedDate && <span><CalendarDays size={14} /> <span className="visually-hidden">Planned </span>{task.plannedDate === today ? 'Today' : formatDate(task.plannedDate)}</span>}
        {task.dueDate && <span className="task-deadline"><CalendarRange size={14} /> {task.dueDate === today ? 'Due today' : 'Due ' + formatDate(task.dueDate)}</span>}
        {task.priority !== 'none' && <span className={'priority-' + task.priority} title={priorityLabels[task.priority] + ' priority'}><Flag size={14} /> <span className="visually-hidden">{priorityLabels[task.priority]} priority</span></span>}
      </div>
    </li>
  )
}

interface TaskListProps {
  view: TaskView
  data: Workspace
  today: string
  onOpen: (id: string) => void
  onToggle: (task: Task) => void
  onAdjustCount: TaskRowProps['onAdjustCount']
  onNew: () => void
}

export function TaskList({ view, data, today, onOpen, onToggle, onAdjustCount, onNew }: TaskListProps) {
  const [sort, setSort] = useState<TaskSort>('relevant')
  const [priority, setPriority] = useState<Priority | 'any'>('any')
  const [goal, setGoal] = useState('any')
  const tasks = tasksForView(data.tasks, view, today)
  const filtered = sortTasks(tasks.filter(task =>
    (priority === 'any' || task.priority === priority) && (goal === 'any' || (task.roadmapId ?? '') === goal),
  ), sort, today, view)

  return <>
    <div className="page-heading">
      <div><h1>{taskTitles[view]}</h1><p>{descriptions[view]}</p></div>
      {view !== 'completed' && view !== 'archived' && <button className="btn btn-primary" onClick={onNew}><Plus size={17} /> Add task</button>}
    </div>
    <section className="panel task-list-panel" aria-label={taskTitles[view] + ' tasks'}>
      <div className="list-toolbar">
        <strong>{filtered.length} {filtered.length === 1 ? 'task' : 'tasks'}</strong>
        <div className="list-filters">
          <label><span className="visually-hidden">Filter by priority</span><select value={priority} onChange={event => setPriority(event.target.value as Priority | 'any')}>
            <option value="any">Any priority</option>{Object.entries(priorityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          <label><span className="visually-hidden">Filter by goal</span><select value={goal} onChange={event => setGoal(event.target.value)}>
            <option value="any">Any goal</option><option value="">No goal</option>{data.roadmaps.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}
          </select></label>
          <label><span className="visually-hidden">Sort tasks</span><select value={sort} onChange={event => setSort(event.target.value as TaskSort)}>
            <option value="relevant">Sort by relevance</option><option value="newest">Newest first</option><option value="deadline">Deadline first</option>
            <option value="priority">Priority first</option><option value="title">Title A–Z</option>
          </select></label>
        </div>
      </div>
      {filtered.length ? <ul className="task-list">{filtered.map(task => <TaskRow key={task.id} task={task} data={data} today={today} onOpen={onOpen} onToggle={onToggle} onAdjustCount={onAdjustCount} />)}</ul>
        : <div className="list-empty"><div className="section-icon"><CheckCircle2 size={20} /></div><strong>{tasks.length ? 'No matching tasks' : 'Nothing here yet'}</strong><p>{tasks.length ? 'Try a different filter.' : emptyText[view]}</p></div>}
    </section>
  </>
}

export type TaskDefaults = Partial<Pick<Task, 'roadmapId' | 'objectiveId' | 'plannedDate' | 'inbox'>>

interface EditorProps {
  existing: Task | null
  defaults?: TaskDefaults
  data: Workspace
  onClose: () => void
  commit: (changes: Change[]) => Promise<void>
}

function previewCount<T extends CountableRecord>(record: T, draft: string | undefined): T | null {
  if (draft === undefined) return null
  try { return setCountTarget(record, parseCountTarget(draft)) }
  catch { return null }
}

export function TaskEditor({ existing, defaults, data, onClose, commit }: EditorProps) {
  const [initial] = useState(existing)
  const [task, setTask] = useState(() => existing ?? newTask('', defaults))
  const [original] = useState(() => data.checklistItems.filter(item => item.taskId === task.id))
  const [items, setItems] = useState(() => [...original].sort((a, b) => a.position - b.position))
  const [taskTarget, setTaskTarget] = useState(() => hasCountTarget(task) ? String(task.countTarget) : undefined)
  const [itemTargets, setItemTargets] = useState<Record<string, string | undefined>>(() =>
    Object.fromEntries(original.filter(hasCountTarget).map(item => [item.id, String(item.countTarget)])))
  const [line, setLine] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const taskCount = task.status !== 'archived' ? previewCount(task, taskTarget) : null
  const roadmaps = data.roadmaps.filter(row => !row.archived || row.id === task.roadmapId)
  const selectedGoal = roadmaps.find(row => row.id === task.roadmapId)
  const objectives = data.objectives.filter(row => row.parentId === null
    && data.phases.some(phase => phase.id === row.phaseId && phase.roadmapId === task.roadmapId))
  const addItem = () => {
    if (!line.trim()) return
    setItems(previous => [...previous, { ...recordBase(), taskId: task.id, objectiveId: null, title: line.trim(), completed: false, optional: false, position: previous.length }])
    setLine('')
  }

  function moveItem(index: number, direction: -1 | 1) {
    const destination = index + direction
    if (destination < 0 || destination >= items.length) return
    const moved = [...items]
    ;[moved[index], moved[destination]] = [moved[destination], moved[index]]
    setItems(moved)
  }

  function updateItem(id: string, update: (item: ChecklistItem) => ChecklistItem) {
    setItems(previous => previous.map(item => item.id === id ? update(item) : item))
  }

  async function persist(changes: Change[]) {
    const current = data.checklistItems.filter(item => item.taskId === task.id)
    const checklistChanged = current.length !== original.length || current.some(item => !original.some(row => row.id === item.id && row.updatedAt === item.updatedAt))
    if (initial && (existing?.updatedAt !== initial.updatedAt || checklistChanged)) {
      setError('This task changed while you were editing. Copy any notes you want to keep, then reopen the task to see the latest version.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await commit(changes)
      onClose()
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'This change could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  function save(event: FormEvent) {
    event.preventDefault()
    if (!task.title.trim()) { setError('Enter a task title.'); return }
    const pendingItem: ChecklistItem[] = line.trim()
      ? [{ ...recordBase(), taskId: task.id, objectiveId: null, title: line.trim(), completed: false, optional: false, position: items.length }]
      : []
    const kept = [...items, ...pendingItem]
    if (kept.some(item => !item.title.trim())) { setError('Enter a title for each checklist item.'); return }
    try {
      const nextTask = setCountTarget(task, parseCountTarget(taskTarget))
      const changes = [put('tasks', touch({ ...nextTask, title: task.title.trim(), description: task.description.trim() }))]
      for (const item of original) if (!kept.some(row => row.id === item.id)) changes.push(remove('checklistItems', item.id))
      kept.forEach((item, position) => {
        const before = original.find(row => row.id === item.id)
        const next = { ...setCountTarget(item, parseCountTarget(itemTargets[item.id])), title: item.title.trim(), position }
        if (!before || before.title !== next.title || before.completed !== next.completed || before.optional !== next.optional
          || before.position !== position || before.countTarget !== next.countTarget || before.countValue !== next.countValue) {
          changes.push(put('checklistItems', touch(next)))
        }
      })
      void persist(changes)
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Check the count target and try again.')
    }
  }

  return <Dialog title={existing ? 'Task details' : 'New task'} onClose={onClose}>
    <form className="editor-form" onSubmit={save}>
      <label className="field">Title<input autoFocus value={task.title} onChange={event => setTask({ ...task, title: event.target.value })} placeholder="What needs to happen?" required maxLength={240} /></label>
      {selectedGoal && <label className="check-option"><input type="checkbox" checked={!!task.optional} onChange={event => setTask({ ...task, optional: event.target.checked })} /> Optional in goal progress</label>}
      <div className="count-target-draft">
        <DraftCountTarget itemLabel="task" value={taskTarget} onChange={setTaskTarget} disabled={busy} />
        {taskCount && <CountControl record={{ ...taskCount, title: taskCount.title || 'task' }}
          onChange={delta => setTask(current => adjustCount(setCountTarget(current, parseCountTarget(taskTarget)), delta))} />}
      </div>
      <label className="field">Notes<textarea value={task.description} onChange={event => setTask({ ...task, description: event.target.value })} placeholder="Add details if they’ll help later" rows={3} maxLength={10000} /></label>
      <div className="form-grid">
        <label className="field">Planned date<input type="date" value={task.plannedDate ?? ''} onChange={event => setTask({ ...task, plannedDate: event.target.value || null })} /><small>When you plan to work on it</small></label>
        <label className="field">Deadline<input type="date" value={task.dueDate ?? ''} onChange={event => setTask({ ...task, dueDate: event.target.value || null })} /><small>When it needs to be done</small></label>
        <label className="field">Priority<select value={task.priority} onChange={event => setTask({ ...task, priority: event.target.value as Priority })}>
          {Object.entries(priorityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        <label className="field">Goal<select value={task.roadmapId ?? (task.inbox ? 'inbox' : 'unassigned')} onChange={event => {
          const value = event.target.value
          setTask({ ...task, roadmapId: value === 'inbox' || value === 'unassigned' ? null : value, inbox: value === 'inbox', objectiveId: null })
        }}>
          <option value="inbox">Inbox</option><option value="unassigned">Unassigned</option>
          {roadmaps.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}
        </select></label>
      </div>
      {task.roadmapId && objectives.length > 0 && <label className="field">Objective<select value={task.objectiveId ?? ''} onChange={event => setTask({ ...task, objectiveId: event.target.value || null })}>
        <option value="">No objective</option>
        {objectives.map(row => <option key={row.id} value={row.id}>{row.title}{row.optional ? ' · Optional' : ''}</option>)}
      </select></label>}
      <fieldset className="checklist-editor">
        <legend>Checklist</legend>
        {items.map((item, index) => {
          const itemLabel = 'checklist item ' + (index + 1)
          const target = itemTargets[item.id]
          const counter = previewCount(item, target)
          const setTarget = (value: string | undefined) => setItemTargets(previous => ({ ...previous, [item.id]: value }))
          return <div className="count-checklist-entry" key={item.id}>
            <div className="checklist-line">
              {target !== undefined ? <Hash size={15} className="muted" aria-hidden="true" /> : <input type="checkbox" checked={item.completed}
                aria-label={'Complete ' + itemLabel} onChange={event => updateItem(item.id, row => ({ ...row, completed: event.target.checked }))} />}
              <input type="text" value={item.title} aria-label={'Checklist item ' + (index + 1)} maxLength={240} onChange={event => updateItem(item.id, row => ({ ...row, title: event.target.value }))} />
              <label className="checklist-optional"><input type="checkbox" checked={!!item.optional} aria-label={'Optional ' + itemLabel} onChange={event => updateItem(item.id, row => ({ ...row, optional: event.target.checked }))} /><span>Optional</span></label>
              <span className="checklist-reorder"><button className="icon-btn" type="button" disabled={index === 0} aria-label={'Move ' + itemLabel + ' up'} onClick={() => moveItem(index, -1)}><ChevronUp size={15} /></button><button className="icon-btn" type="button" disabled={index === items.length - 1} aria-label={'Move ' + itemLabel + ' down'} onClick={() => moveItem(index, 1)}><ChevronDown size={15} /></button></span>
              {target === undefined && <button className="icon-btn" type="button" title="Set count target"
                aria-label={'Set count target for ' + itemLabel} disabled={busy} onClick={() => setTarget('')}><Hash size={16} /></button>}
              <button className="icon-btn" type="button" aria-label={'Remove ' + itemLabel} onClick={() => setItems(items.filter(row => row.id !== item.id))}><X size={16} /></button>
            </div>
            {target !== undefined && <div className="count-target-draft count-checklist-target">
              <DraftCountTarget itemLabel={itemLabel} value={target} onChange={setTarget} disabled={busy} autoFocus={target === ''} />
              {counter && <CountControl record={{ ...counter, title: counter.title || itemLabel }}
                onChange={delta => updateItem(item.id, row => adjustCount(setCountTarget(row, parseCountTarget(target)), delta))} />}
            </div>}
          </div>
        })}
        <div className="checklist-line"><input value={line} aria-label="New checklist item" placeholder="Add a checklist item" maxLength={240} onChange={event => setLine(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addItem() } }} /><button type="button" className="btn btn-secondary" onClick={addItem} disabled={!line.trim()}><Plus size={16} /> Add</button></div>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      {deleting && <div className="inline-confirm"><span>Delete this task and its checklist permanently?</span><button type="button" className="btn btn-secondary" onClick={() => setDeleting(false)}>Keep task</button><button type="button" className="btn btn-danger" disabled={busy} onClick={() => void persist([remove('tasks', task.id)])}>Delete task</button></div>}
      <div className="editor-actions">
        {existing && !deleting && <div className="editor-tools">
          <button type="button" className="icon-btn" title="Delete task" aria-label="Delete task" onClick={() => setDeleting(true)}><Trash2 size={17} /></button>
          <button type="button" className="icon-btn" title={task.status === 'archived' ? 'Restore task' : 'Archive task'} aria-label={task.status === 'archived' ? 'Restore task' : 'Archive task'} onClick={() => setTask(changeTaskStatus(task, task.status === 'archived' ? (task.completedAt ? 'completed' : 'active') : 'archived'))}><Archive size={17} /></button>
          {task.status !== 'archived' && taskTarget === undefined && <button type="button" className="btn btn-quiet" onClick={() => setTask(changeTaskStatus(task, task.status === 'completed' ? 'active' : 'completed'))}>
            {task.status === 'completed' ? <RotateCcw size={15} /> : <Circle size={15} />}{task.status === 'completed' ? 'Reopen' : 'Complete'}
          </button>}
        </div>}
        <div className="editor-save"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} type="submit">{busy ? 'Saving…' : existing ? 'Save changes' : 'Create task'}</button></div>
      </div>
      {existing && task.status !== existing.status && <p className="muted small-text">Save changes to {task.status === 'active' ? 'reopen' : task.status === 'completed' ? 'complete' : 'archive'} this task.</p>}
    </form>
  </Dialog>
}
