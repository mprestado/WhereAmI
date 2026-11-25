import { useRef, useState, type FormEvent } from 'react'
import { ArrowDown, ArrowLeft, ArrowUp, Hash, Plus, Trash2 } from 'lucide-react'
import { CountTargetField, DraftCountTarget, parseCountTarget } from './CountTargetField'
import { hasCountTarget, setCountTarget, type CountableRecord } from './counting'
import Dialog from './Dialog'
import { appendObjective, deriveJourney, moveObjective, moveSubObjective, newSubObjective, setSubObjectiveOptional, workForObjective } from './journey'
import { put, remove, touch, type Change, type ChecklistItem, type Objective, type Roadmap, type Task, type Workspace } from './model'
import type { ObjectiveProgress } from './progress'

interface Props {
  data: Workspace
  goal: Roadmap
  commit: (changes: Change[]) => Promise<void>
  onClose: () => void
}

type WorkItem = { kind: 'task'; item: Task } | { kind: 'checklist'; item: ChecklistItem }

export default function GoalObjectiveSettings({ data, goal, commit, onClose }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [removeTarget, setRemoveTarget] = useState<string | null>(null)
  const objectives = deriveJourney(data, goal.id).ordered

  async function apply(changes: Change[]) {
    if (!changes.length) return
    setBusy(true)
    setError('')
    try { await commit(changes) }
    catch (reason) {
      const message = reason instanceof Error ? reason.message : 'The change could not be saved. Try again.'
      setError(message)
      throw reason
    } finally { setBusy(false) }
  }

  function removeRecord(table: 'objectives' | 'tasks' | 'checklistItems', id: string) {
    void apply([remove(table, id)]).then(() => setRemoveTarget(null)).catch(() => undefined)
  }

  function addObjective(title: string, optional: boolean, countTarget: number | null) {
    return apply(appendObjective(data, goal.id, title, optional, countTarget ?? undefined))
  }

  return <Dialog title="Edit objectives" description="Changes save as you make them." onClose={onClose}>
    <div className="objective-settings">
      <button type="button" className="objective-settings-back" onClick={onClose}><ArrowLeft size={16} /> Goal settings</button>
      {objectives.length > 0
        ? <ol className="objective-settings-list">
          {objectives.map((item, index) => <li key={item.objective.id}>
            <ObjectiveEditor data={data} goal={goal} progress={item} index={index} total={objectives.length} busy={busy}
              apply={apply} confirmRemove={id => setRemoveTarget(id)} removeTarget={removeTarget} removeRecord={removeRecord} />
          </li>)}
        </ol>
        : <p className="objective-settings-empty">Add the steps that make up this goal.</p>}
      <AddObjective busy={busy} onAdd={addObjective} />
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  </Dialog>
}

function ObjectiveEditor({ data, goal, progress, index, total, busy, apply, confirmRemove, removeTarget, removeRecord }: {
  data: Workspace
  goal: Roadmap
  progress: ObjectiveProgress
  index: number
  total: number
  busy: boolean
  apply: (changes: Change[]) => Promise<void>
  confirmRemove: (id: string) => void
  removeTarget: string | null
  removeRecord: (table: 'objectives' | 'tasks' | 'checklistItems', id: string) => void
}) {
  const objective = progress.objective
  const work = workForObjective(data, objective.id)

  return <section className="objective-settings-entry" aria-label={'Objective ' + (index + 1)}>
    <div className="objective-settings-title-row">
      <TitleField label={'Objective ' + (index + 1)} value={objective.title} onSave={title => apply([put('objectives', touch({ ...objective, title }))])} />
      <div className="objective-settings-controls">
        <button type="button" className="icon-btn" aria-label="Move objective earlier" title="Move earlier" disabled={busy || index === 0}
          onClick={() => void apply(moveObjective(data, goal.id, objective.id, -1)).catch(() => undefined)}><ArrowUp size={16} /></button>
        <button type="button" className="icon-btn" aria-label="Move objective later" title="Move later" disabled={busy || index === total - 1}
          onClick={() => void apply(moveObjective(data, goal.id, objective.id, 1)).catch(() => undefined)}><ArrowDown size={16} /></button>
        <button type="button" className="icon-btn objective-remove" aria-label="Remove objective" title="Remove objective" disabled={busy}
          onClick={() => confirmRemove('objectives:' + objective.id)}><Trash2 size={16} /></button>
      </div>
    </div>
    {removeTarget === 'objectives:' + objective.id && <RemovePrompt label="objective" onCancel={() => confirmRemove('')} onConfirm={() => removeRecord('objectives', objective.id)} />}
    <label className="objective-settings-optional"><input type="checkbox" checked={!!objective.optional} disabled={busy}
      onChange={event => void apply([put('objectives', touch({ ...objective, optional: event.target.checked }))]).catch(() => undefined)} /> Optional objective</label>
    <CountTargetEditor record={objective} busy={busy}
      onSave={target => apply([put('objectives', setCountTarget(objective, target))])} />

    {progress.sideObjectives.map((side, sideIndex) => <SideObjectiveEditor key={side.objective.id} data={data} goal={goal} progress={side}
      index={sideIndex} total={progress.sideObjectives.length} busy={busy} apply={apply} confirmRemove={confirmRemove}
      removeTarget={removeTarget} removeRecord={removeRecord} />)}
    {work.length > 0 && <ol className="objective-settings-work">
      {work.map((row, rowIndex) => <WorkEditor key={row.item.id} data={data} goal={goal} row={row} index={rowIndex} total={work.length}
        busy={busy} apply={apply} confirmRemove={confirmRemove} removeTarget={removeTarget} removeRecord={removeRecord} />)}
    </ol>}
    <AddSubObjective busy={busy} onAdd={(title, optional, countTarget) => apply(newSubObjective(data, goal.id, objective.id, title, optional, countTarget ?? undefined))} />
  </section>
}

function SideObjectiveEditor({ data, goal, progress, index, total, busy, apply, confirmRemove, removeTarget, removeRecord }: {
  data: Workspace
  goal: Roadmap
  progress: ObjectiveProgress
  index: number
  total: number
  busy: boolean
  apply: (changes: Change[]) => Promise<void>
  confirmRemove: (id: string) => void
  removeTarget: string | null
  removeRecord: (table: 'objectives' | 'tasks' | 'checklistItems', id: string) => void
}) {
  const objective = progress.objective
  const work = workForObjective(data, objective.id)
  return <section className="objective-settings-side" aria-label={'Optional objective: ' + objective.title}>
    <div className="objective-settings-title-row">
      <TitleField label="Optional objective" value={objective.title} onSave={title => apply([put('objectives', touch({ ...objective, title }))])} />
      <div className="objective-settings-controls">
        <button type="button" className="icon-btn" aria-label="Move optional objective earlier" title="Move earlier" disabled={busy || index === 0}
          onClick={() => void apply(moveObjective(data, goal.id, objective.id, -1)).catch(() => undefined)}><ArrowUp size={15} /></button>
        <button type="button" className="icon-btn" aria-label="Move optional objective later" title="Move later" disabled={busy || index === total - 1}
          onClick={() => void apply(moveObjective(data, goal.id, objective.id, 1)).catch(() => undefined)}><ArrowDown size={15} /></button>
        <button type="button" className="icon-btn objective-remove" aria-label="Remove optional objective" title="Remove" disabled={busy}
          onClick={() => confirmRemove('objectives:' + objective.id)}><Trash2 size={15} /></button>
      </div>
    </div>
    {removeTarget === 'objectives:' + objective.id && <RemovePrompt label="optional objective" onCancel={() => confirmRemove('')} onConfirm={() => removeRecord('objectives', objective.id)} />}
    <CountTargetEditor record={objective} busy={busy}
      onSave={target => apply([put('objectives', setCountTarget(objective, target))])} />
    {work.length > 0 && <ol className="objective-settings-work">
      {work.map((row, rowIndex) => <WorkEditor key={row.item.id} data={data} goal={goal} row={row} index={rowIndex} total={work.length}
        busy={busy} apply={apply} confirmRemove={confirmRemove} removeTarget={removeTarget} removeRecord={removeRecord} />)}
    </ol>}
    <AddSubObjective busy={busy} onAdd={(title, optional, countTarget) => apply(newSubObjective(data, goal.id, objective.id, title, optional, countTarget ?? undefined))} />
  </section>
}

function WorkEditor({ data, goal, row, index, total, busy, apply, confirmRemove, removeTarget, removeRecord }: {
  data: Workspace
  goal: Roadmap
  row: WorkItem
  index: number
  total: number
  busy: boolean
  apply: (changes: Change[]) => Promise<void>
  confirmRemove: (id: string) => void
  removeTarget: string | null
  removeRecord: (table: 'objectives' | 'tasks' | 'checklistItems', id: string) => void
}) {
  const table = row.kind === 'task' ? 'tasks' : 'checklistItems'
  const item = row.item
  const saveTitle = (title: string) => apply([row.kind === 'task'
    ? put('tasks', touch({ ...row.item, title })) : put('checklistItems', touch({ ...row.item, title }))])
  const optional = <label className="objective-settings-optional"><input type="checkbox" checked={!!item.optional} disabled={busy}
    onChange={event => void apply(setSubObjectiveOptional(data, row, event.target.checked)).catch(() => undefined)} /> Optional sub-objective</label>

  return <li className="objective-settings-work-row">
    <div className="objective-settings-title-row">
      <TitleField label="Sub-objective" value={item.title} onSave={saveTitle} />
      <div className="objective-settings-controls">
        <button type="button" className="icon-btn" aria-label="Move sub-objective earlier" title="Move earlier" disabled={busy || index === 0}
          onClick={() => item.objectiveId && void apply(moveSubObjective(data, item.objectiveId, item.id, -1)).catch(() => undefined)}><ArrowUp size={14} /></button>
        <button type="button" className="icon-btn" aria-label="Move sub-objective later" title="Move later" disabled={busy || index === total - 1}
          onClick={() => item.objectiveId && void apply(moveSubObjective(data, item.objectiveId, item.id, 1)).catch(() => undefined)}><ArrowDown size={14} /></button>
        <button type="button" className="icon-btn objective-remove" aria-label="Remove sub-objective" title="Remove sub-objective" disabled={busy}
          onClick={() => confirmRemove(table + ':' + item.id)}><Trash2 size={14} /></button>
      </div>
    </div>
    {optional}
    <CountTargetEditor record={item} busy={busy} onSave={target => apply([row.kind === 'task'
      ? put('tasks', setCountTarget(row.item, target))
      : put('checklistItems', setCountTarget(row.item, target))])} />
    {removeTarget === table + ':' + item.id && <RemovePrompt label="sub-objective" onCancel={() => confirmRemove('')} onConfirm={() => removeRecord(table, item.id)} />}
  </li>
}

type AddObjectiveHandler = (title: string, optional: boolean, countTarget: number | null) => Promise<void>

function AddObjective({ busy, onAdd }: { busy: boolean; onAdd: AddObjectiveHandler }) {
  return <AddForm label="Add main objective" kind="objective" busy={busy} onAdd={onAdd} />
}

function AddSubObjective({ busy, onAdd }: { busy: boolean; onAdd: AddObjectiveHandler }) {
  return <AddForm label="Add sub-objective" kind="sub-objective" busy={busy} onAdd={onAdd} />
}

function AddForm({ label, kind, busy, onAdd }: {
  label: string
  kind: 'objective' | 'sub-objective'
  busy: boolean
  onAdd: AddObjectiveHandler
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [optional, setOptional] = useState(false)
  const [target, setTarget] = useState<string>()
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const value = title.trim().replace(/[\r\n]+/g, ' ')
    if (!value || saving || busy) return
    setSaving(true)
    try {
      await onAdd(value, optional, parseCountTarget(target))
      setTitle('')
      setOptional(false)
      setTarget(undefined)
      setOpen(false)
    }
    catch { /* The parent reports the save error. */ }
    finally { setSaving(false) }
  }

  return open
    ? <form className="objective-settings-add" onSubmit={event => void submit(event)}>
      <input autoFocus maxLength={240} aria-label={label} placeholder={label} value={title} disabled={saving || busy} onChange={event => setTitle(event.target.value)} />
      <label className="objective-settings-optional"><input type="checkbox" checked={optional} disabled={saving || busy} onChange={event => setOptional(event.target.checked)} /> Optional {kind}</label>
      <DraftCountTarget itemLabel={'new ' + kind} value={target} onChange={setTarget} disabled={saving || busy} />
      <div><button type="button" className="btn btn-quiet" disabled={saving} onClick={() => setOpen(false)}>Cancel</button>
        <button type="submit" className="btn btn-secondary" disabled={!title.trim() || saving || busy}>Add</button></div>
    </form>
    : <button type="button" className="objective-settings-add-trigger" disabled={busy} onClick={() => setOpen(true)}><Plus size={16} /> {label}</button>
}

function CountTargetEditor({ record, busy, onSave }: {
  record: CountableRecord
  busy: boolean
  onSave: (target: number | null) => Promise<void>
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const tracked = hasCountTarget(record)
  const label = tracked ? 'Edit count target' : 'Set count target'
  const disabled = busy || saving

  function close() {
    setDraft(null)
    requestAnimationFrame(() => trigger.current?.focus())
  }

  async function save(target: number | null) {
    if (disabled) return
    if (target === (record.countTarget ?? null)) { close(); return }
    setSaving(true)
    try { await onSave(target); close() }
    catch { /* The settings dialog reports save failures. */ }
    finally { setSaving(false) }
  }

  if (draft === null) return <button className="count-target-trigger" type="button" disabled={disabled}
    ref={trigger} aria-label={label + ' for ' + record.title}
    onClick={() => setDraft(tracked ? String(record.countTarget) : '')}>
    <Hash size={14} aria-hidden="true" /> {tracked ? (record.countValue ?? 0) + '/' + record.countTarget + ' · Edit count target' : label}
  </button>

  return <form className="count-target-editor" aria-label={'Count settings for ' + record.title}
    onSubmit={event => {
      event.preventDefault()
      void save(parseCountTarget(draft))
    }}>
    <CountTargetField itemLabel={record.title} value={draft} onChange={setDraft} disabled={disabled} autoFocus />
    <button type="submit" className="btn btn-secondary" disabled={disabled}>Save target</button>
    {tracked && <button type="button" className="btn btn-quiet" disabled={disabled} onClick={() => void save(null)}>Use checkbox</button>}
    <button type="button" className="btn btn-quiet" disabled={disabled} onClick={close}>Cancel</button>
  </form>
}

function TitleField({ label, value, onSave }: { label: string; value: string; onSave: (value: string) => Promise<void> }) {
  const [saving, setSaving] = useState(false)

  async function save(input: HTMLInputElement) {
    const title = input.value.trim().replace(/[\r\n]+/g, ' ')
    if (!title) { input.value = value; return }
    if (title === value) return
    setSaving(true)
    try { await onSave(title) }
    catch { input.value = value }
    finally { setSaving(false) }
  }

  return <input className="objective-settings-name" aria-label={label} defaultValue={value} key={value}
    maxLength={240} disabled={saving} onBlur={event => void save(event.currentTarget)}
    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }} />
}

function RemovePrompt({ label, onCancel, onConfirm }: { label: string; onCancel: () => void; onConfirm: () => void }) {
  return <div className="objective-settings-remove-prompt" role="group" aria-label={'Confirm removal of ' + label}>
    <span>Remove this {label}?</span><button type="button" className="btn btn-quiet" onClick={onCancel}>Keep</button>
    <button type="button" className="btn btn-danger" onClick={onConfirm}>Remove</button>
  </div>
}
