import { useState, type FormEvent } from 'react'
import { Archive, ArchiveRestore, Check, ListTodo } from 'lucide-react'
import Dialog from './Dialog'
import GoalObjectiveSettings from './GoalObjectiveSettings'
import { formatDate, put, touch, type Change, type Milestone, type Roadmap, type Workspace } from './model'

interface Props {
  data: Workspace
  goal: Roadmap
  milestones: Milestone[]
  commit: (changes: Change[]) => Promise<void>
  onClose: () => void
  onArchiveChange: (goal: Roadmap, archived: boolean) => void
}

export default function GoalSettings({ data, goal, milestones, commit, onClose, onArchiveChange }: Props) {
  const [original] = useState(goal)
  const [editingObjectives, setEditingObjectives] = useState(false)
  const [title, setTitle] = useState(goal.title)
  const [purpose, setPurpose] = useState(goal.purpose)
  const [startingPoint, setStartingPoint] = useState(goal.startingPoint)
  const [outcome, setOutcome] = useState(goal.outcome)
  const [startDate, setStartDate] = useState(goal.startDate)
  const [targetDate, setTargetDate] = useState(goal.targetDate ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function apply(changes: Change[], after?: () => void) {
    setBusy(true)
    setError('')
    try {
      await commit(changes)
      after?.()
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'The change could not be saved.')
    } finally { setBusy(false) }
  }

  function save(event: FormEvent) {
    event.preventDefault()
    if (goal.updatedAt !== original.updatedAt) {
      setError('This goal changed while settings were open. Reopen settings to see the latest version.')
      return
    }
    if (targetDate && targetDate < startDate) {
      setError('Choose a target date on or after the start date.')
      return
    }
    void apply([put('roadmaps', touch({
      ...goal, title: title.trim(), purpose: purpose.trim(), startingPoint: startingPoint.trim(),
      outcome: outcome.trim(), startDate, targetDate: targetDate || null,
    }))], onClose)
  }

  function changeArchive() {
    void apply([put('roadmaps', touch({ ...goal, archived: !goal.archived }))], () => onArchiveChange(goal, !goal.archived))
  }

  if (editingObjectives) return <GoalObjectiveSettings data={data} goal={goal} commit={commit} onClose={() => setEditingObjectives(false)} />

  return <Dialog title="Goal settings" description={goal.title} onClose={onClose}>
    <form className="editor-form" onSubmit={save}>
      <label className="field">Goal title<input value={title} onChange={event => setTitle(event.target.value)} required maxLength={240} /></label>
      <button type="button" className="goal-edit-objectives" onClick={() => setEditingObjectives(true)}><ListTodo size={17} /> Edit objectives</button>
      <details className="goal-setting-details">
        <summary>Notes and dates</summary>
        <div className="editor-form">
          <label className="field">Purpose<textarea value={purpose} onChange={event => setPurpose(event.target.value)} rows={2} /></label>
          <label className="field">Starting point<textarea value={startingPoint} onChange={event => setStartingPoint(event.target.value)} rows={2} /></label>
          <label className="field">Desired outcome<textarea value={outcome} onChange={event => setOutcome(event.target.value)} rows={2} /></label>
          <div className="form-grid">
            <label className="field">Start date<input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} required /></label>
            <label className="field">Target date<input type="date" value={targetDate} onChange={event => setTargetDate(event.target.value)} /></label>
          </div>
        </div>
      </details>
      {milestones.length > 0 && <details className="goal-setting-details">
        <summary>Checkpoints</summary>
        <ul className="goal-saved-milestones">{milestones.map(item => <li key={item.id}>
          <label><input type="checkbox" checked={!!item.completedAt} disabled={busy} onChange={event => {
            void apply([put('milestones', touch({ ...item, completedAt: event.target.checked ? new Date().toISOString() : null }))])
          }} />{item.title}</label>
          {item.targetDate && <time dateTime={item.targetDate}>{formatDate(item.targetDate)}</time>}
        </li>)}</ul>
      </details>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="editor-actions">
        <button type="button" className="btn btn-quiet" onClick={changeArchive} disabled={busy}>{goal.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}{goal.archived ? 'Restore goal' : 'Archive goal'}</button>
        <div className="editor-save">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}><Check size={16} /> Save changes</button>
        </div>
      </div>
    </form>
  </Dialog>
}
