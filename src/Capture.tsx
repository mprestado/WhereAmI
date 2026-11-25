import { useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'

export default function CaptureField({ onCapture }: { onCapture: (title: string) => Promise<void> }) {
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!title.trim() || busy) return
    setBusy(true)
    setError('')
    setStatus('')
    try {
      await onCapture(title.trim())
      setTitle('')
      setStatus('Added to Inbox.')
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'The task could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return <>
    <form className="capture-form capture-compact" onSubmit={submit}>
      <label className="visually-hidden" htmlFor="capture-modal">Quick capture task title</label>
      <span className="capture-plus" aria-hidden="true"><Plus size={20} /></span>
      <input id="capture-modal" autoFocus placeholder="What’s on your mind?" value={title} maxLength={240} onChange={event => setTitle(event.target.value)} required />
      <button className="btn btn-primary capture-submit" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add to Inbox'} <span className="enter-key" aria-hidden="true">↵</span></button>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className={status ? 'capture-message' : 'visually-hidden'} role="status">{status}</div>
  </>
}


