import { useState } from 'react'
import type { FormEvent } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import Dialog from './Dialog'
import { localDate, put, recordBase, remove, touch } from './model'
import type { Change, ChecklistItem, Milestone, Objective, Phase, Roadmap, Workspace } from './model'

export type RoadmapEdit =
  | { kind: 'roadmap'; row?: Roadmap }
  | { kind: 'phase'; roadmapId: string; row?: Phase }
  | { kind: 'objective'; phaseId: string; parentId: string | null; row?: Objective }
  | { kind: 'milestone'; roadmapId: string; row?: Milestone }

interface Props {
  data: Workspace
  editor: RoadmapEdit
  commit: (changes: Change[]) => Promise<void>
  onClose: () => void
  onSaved: (id: string) => void
}

const editorTables = {
  roadmap: 'roadmaps',
  phase: 'phases',
  objective: 'objectives',
  milestone: 'milestones',
} as const

function nextPosition(rows: { position: number }[]) {
  return rows.reduce((next, row) => Math.max(next, row.position + 1), 0)
}

export default function RoadmapEditor({ data, editor, commit, onClose, onSaved }: Props) {
  const [base] = useState(() => editor.row ?? recordBase())
  const currentItems = editor.kind === 'objective' && editor.row
    ? data.checklistItems.filter((item) => item.objectiveId === editor.row?.id)
    : []
  const [originalItems] = useState(() => currentItems.sort((a, b) => a.position - b.position))
  const [items, setItems] = useState(originalItems)
  const [startDate, setStartDate] = useState(() => editor.kind === 'roadmap' ? editor.row?.startDate ?? localDate() : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const currentRow = data[editorTables[editor.kind]].find((row) => row.id === base.id)
  const hasStaleRecord = !!editor.row && currentRow?.updatedAt !== editor.row.updatedAt
  const kindLabel = editor.kind === 'objective'
    ? editor.parentId ? 'side objective' : 'main objective'
    : editor.kind
  const title = editor.row ? `Edit ${kindLabel}` : `New ${kindLabel}`
  const canDelete = editor.row && (
    editor.kind === 'milestone'
    || (editor.kind === 'phase'
      && !data.objectives.some((item) => item.phaseId === editor.row?.id)
      && !data.milestones.some((item) => item.phaseId === editor.row?.id))
    || (editor.kind === 'objective'
      && !data.objectives.some((item) => item.parentId === editor.row?.id)
      && !data.tasks.some((item) => item.objectiveId === editor.row?.id))
  )

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (hasStaleRecord) {
      setError('This item changed while it was open. Reopen it to see the latest version.')
      return
    }
    const formData = new FormData(event.currentTarget)
    const field = (name: string) => String(formData.get(name) ?? '').trim()
    const name = field('title')
    if (!name) {
      setError('Enter a title to continue.')
      return
    }
    const changes: Change[] = []
    const metadata = editor.row ? touch(editor.row) : base
    switch (editor.kind) {
      case 'roadmap': {
        if (!startDate) {
          setError('Choose a start date.')
          return
        }
        const targetDate = field('targetDate') || null
        if (targetDate && targetDate < startDate) {
          setError('Choose a target date on or after the start date.')
          return
        }
        changes.push(put('roadmaps', {
          ...metadata,
          title: name,
          purpose: field('purpose'),
          startingPoint: field('startingPoint'),
          outcome: field('outcome'),
          startDate,
          targetDate,
          archived: editor.row?.archived ?? false,
        }))
        break
      }
      case 'phase': {
        const phases = data.phases.filter((phase) => phase.roadmapId === editor.roadmapId)
        changes.push(put('phases', {
          ...metadata,
          title: name,
          description: field('description'),
          roadmapId: editor.roadmapId,
          position: editor.row?.position ?? nextPosition(phases),
        }))
        break
      }
      case 'objective': {
        const siblings = data.objectives.filter(
          (objective) => objective.phaseId === editor.phaseId && objective.parentId === editor.parentId,
        )
        if (items.some((item) => !item.title.trim())) {
          setError('Give each checklist item a name or remove the empty item.')
          return
        }
        changes.push(put('objectives', {
          ...metadata,
          title: name,
          description: field('description'),
          phaseId: editor.phaseId,
          parentId: editor.parentId,
          position: editor.row?.position ?? nextPosition(siblings),
          completed: editor.row?.completed ?? false,
        }))
        const itemsById = new Map(items.map((item) => [item.id, item]))
        const previousById = new Map(originalItems.map((item) => [item.id, item]))
        const currentById = new Map(currentItems.map((item) => [item.id, item]))
        for (const item of originalItems) {
          const draft = itemsById.get(item.id)
          if (draft?.title.trim() === item.title) continue
          const latest = currentById.get(item.id)
          if (!latest || latest.title !== item.title || (!draft && latest.updatedAt !== item.updatedAt)) {
            setError('A checklist item changed while it was open. Reopen the objective to see the latest version.')
            return
          }
          if (!draft) changes.push(remove('checklistItems', item.id))
        }
        let next = nextPosition(currentItems)
        for (const item of items) {
          const previous = previousById.get(item.id)
          const title = item.title.trim()
          if (previous?.title === title) continue
          changes.push(put('checklistItems', {
            ...touch(currentById.get(item.id) ?? item),
            position: previous?.position ?? next,
            title,
          }))
          if (!previous) next += 1
        }
        break
      }
      case 'milestone': {
        const siblings = data.milestones.filter((item) => item.roadmapId === editor.roadmapId)
        changes.push(put('milestones', {
          ...metadata,
          title: name,
          phaseId: field('phaseId') || null,
          roadmapId: editor.roadmapId,
          targetDate: field('targetDate') || null,
          completedAt: editor.row?.completedAt ?? null,
          position: editor.row?.position ?? nextPosition(siblings),
        }))
        break
      }
    }
    setBusy(true)
    setError('')
    try {
      await commit(changes)
      onSaved(base.id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The change could not be saved. Try again.')
      setBusy(false)
    }
  }

  async function deleteRow() {
    if (!canDelete || !editor.row) return
    if (hasStaleRecord) {
      setError('This item changed while it was open. Reopen it to see the latest version.')
      return
    }
    const originalVersions = new Map(originalItems.map((item) => [item.id, item.updatedAt]))
    if (currentItems.some((item) => originalVersions.get(item.id) !== item.updatedAt)) {
      setError('The checklist changed while it was open. Reopen the objective to see the latest version.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const changes = currentItems.map((item) => remove('checklistItems', item.id))
      changes.push(remove(editorTables[editor.kind], editor.row.id))
      await commit(changes)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The item could not be deleted. Try again.')
      setBusy(false)
    }
  }

  function addChecklistItem() {
    const item: ChecklistItem = {
      ...recordBase(), taskId: null, objectiveId: base.id, title: '', completed: false, position: items.length,
    }
    setItems([...items, item])
    requestAnimationFrame(() => document.getElementById(`objective-item-${item.id}`)?.focus())
  }

  return (
    <Dialog title={title} onClose={() => { if (!busy) onClose() }}>
      <form onSubmit={submit} className="editor-form rm-editor">
        <fieldset className="rm-editor-fields" disabled={busy}>
          <label className="field">
            Title
            <input name="title" required maxLength={240} defaultValue={editor.row?.title} autoFocus />
          </label>
          {editor.kind === 'roadmap' && (
            <>
              <label className="field">
                Purpose
                <textarea name="purpose" rows={2} defaultValue={editor.row?.purpose} placeholder="Why is this goal important?" />
              </label>
              <label className="field">
                Starting point
                <textarea name="startingPoint" rows={2} defaultValue={editor.row?.startingPoint} placeholder="Where are you now?" />
              </label>
              <label className="field">
                Desired outcome
                <textarea name="outcome" rows={2} defaultValue={editor.row?.outcome} placeholder="What will be true when you finish?" />
              </label>
              <div className="form-grid">
                <label className="field">
                  Start date
                  <input name="startDate" type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} />
                </label>
                <label className="field">
                  <span>Target date <span className="muted">(optional)</span></span>
                  <input name="targetDate" type="date" min={startDate} defaultValue={editor.row?.targetDate ?? ''} />
                </label>
              </div>
            </>
          )}
          {(editor.kind === 'phase' || editor.kind === 'objective') && (
            <label className="field">
              Description
              <textarea name="description" rows={3} defaultValue={editor.row?.description} />
            </label>
          )}
          {editor.kind === 'objective' && (
            <fieldset className="checklist-editor rm-checklist-fields">
              <legend>Checklist</legend>
              {items.map((item, index) => (
                <div className="checklist-line" key={item.id}>
                  <input
                    aria-label={`Checklist item ${index + 1}`}
                    id={`objective-item-${item.id}`}
                    maxLength={240}
                    required
                    value={item.title}
                    onChange={(event) => setItems(items.map(
                      (row) => row.id === item.id ? { ...row, title: event.target.value } : row,
                    ))}
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove checklist item ${index + 1}`}
                    onClick={() => setItems(items.filter((row) => row.id !== item.id))}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
              ))}
              <button type="button" className="btn btn-secondary" onClick={addChecklistItem}>
                <Plus size={16} aria-hidden="true" /> Add checklist item
              </button>
            </fieldset>
          )}
          {editor.kind === 'milestone' && (
            <div className="form-grid">
              <label className="field">
                <span>Target date <span className="muted">(optional)</span></span>
                <input name="targetDate" type="date" defaultValue={editor.row?.targetDate ?? ''} />
              </label>
              <label className="field">
                Phase
                <select name="phaseId" defaultValue={editor.row?.phaseId ?? ''}>
                  <option value="">Whole roadmap</option>
                  {data.phases.filter((phase) => phase.roadmapId === editor.roadmapId)
                    .sort((a, b) => a.position - b.position)
                    .map((phase) => <option value={phase.id} key={phase.id}>{phase.title}</option>)}
                </select>
              </label>
            </div>
          )}
        </fieldset>
        {error && <p className="rm-error" role="alert">{error}</p>}
        {confirmDelete && <p className="rm-error" role="alert">Permanently delete this {kindLabel}?</p>}
        <div className="rm-editor-footer">
          {canDelete && (
            <button
              className={confirmDelete ? 'btn btn-danger' : 'btn btn-quiet'}
              type="button"
              disabled={busy}
              onClick={() => confirmDelete ? void deleteRow() : setConfirmDelete(true)}
            >
              {confirmDelete ? 'Confirm delete' : 'Delete'}
            </button>
          )}
          <div className="rm-editor-actions">
            <button className="btn btn-secondary" type="button" disabled={busy} onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" type="submit" disabled={busy || confirmDelete}>
              {busy ? 'Saving…' : editor.row ? 'Save changes' : `Create ${kindLabel}`}
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  )
}
