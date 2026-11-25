import { useState, type FormEvent } from 'react'
import { Cloud, Download, Laptop, LogIn, LogOut, Moon, RefreshCw, Sun, Upload } from 'lucide-react'
import Dialog from './Dialog'
import type { DeviceCopyResult } from './deviceCopy'
import { put, recordBase, touch, type Change, type Setting, type Theme } from './model'

export type SyncState = 'local' | 'loading' | 'saving' | 'saved' | 'offline' | 'failed'

export const syncLabels: Record<SyncState, string> = {
  local: 'On this device', loading: 'Checking sync', saving: 'Pending sync', saved: 'Synced', offline: 'Offline', failed: 'Sync needs attention',
}

interface Props {
  setting?: Setting
  session: { id: string; email: string } | null
  cloudConfigured: boolean
  syncState: SyncState
  syncError: string | null
  pending: number
  deviceRecordCount: number
  copyDeviceWorkspace: () => Promise<DeviceCopyResult>
  isDeviceCopyConfirmed: (recordKeys: string[]) => boolean
  commit: (changes: Change[]) => Promise<void>
  onSignIn: () => void
  onSignOut: () => Promise<void>
  refresh: () => void
  getExport: () => unknown | Promise<unknown>
  discardPending?: () => Promise<void>
}

const themeOptions = [
  { id: 'system', name: 'System', icon: Laptop }, { id: 'light', name: 'Light', icon: Sun }, { id: 'dark', name: 'Dark', icon: Moon },
] as const

export default function Settings(props: Props) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [copyResult, setCopyResult] = useState<DeviceCopyResult | null>(null)

  async function run(action: () => void | Promise<void>) {
    setBusy(true)
    setError('')
    try { await action() }
    catch (issue) { setError((issue as { message?: string } | null)?.message || 'This action could not be completed.') }
    finally { setBusy(false) }
  }

  function changeTheme(theme: Theme) {
    const setting = props.setting ?? { ...recordBase(), id: props.session?.id ?? '00000000-0000-4000-8000-000000000001', theme }
    void run(() => props.commit([put('settings', touch({ ...setting, theme }))]))
  }

  async function exportData() {
    const workspace = await props.getExport()
    const blob = new Blob([JSON.stringify(workspace, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'whereami-workspace-' + new Date().toISOString().slice(0, 10) + '.json'
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 60000)
  }

  function copyStatus(result: DeviceCopyResult) {
    if (!result.recordKeys.length) return result.unavailable ? 'No records were copied.' : 'There are no new local records to copy.'
    if (props.isDeviceCopyConfirmed(result.recordKeys)) return 'The copy has synced to your account.'
    if (props.syncState === 'saved' && props.pending === 0) return 'The copy was interrupted. You can try again from the local copy.'
    return 'The copy is saved on this device and waiting for cloud confirmation.'
  }

  return <>
    <div className="page-heading"><h1>Settings</h1></div>
    <div className="settings-panels">
      <section className="panel settings-panel" aria-labelledby="theme-settings">
        <h2 id="theme-settings">Appearance</h2><p>Choose a theme for your workspace.</p>
        <div className="theme-options">{themeOptions.map(({ id, name, icon: Icon }) => <button key={id} type="button" className="btn btn-secondary" disabled={busy} aria-pressed={(props.setting?.theme ?? 'system') === id} onClick={() => changeTheme(id)}><Icon size={17} />{name}</button>)}</div>
      </section>
      <section className="panel settings-panel" aria-labelledby="sync-settings">
        <h2 id="sync-settings">Account and sync</h2>
        <p>{props.session ? props.session.email : props.cloudConfigured ? 'Sign in to sync across devices. You can copy your existing goals and tasks to your account after signing in.' : 'This build stores your workspace on this device. Cloud access is available in a build configured with Supabase.'}</p>
        <div className="settings-status"><Cloud size={17} /><strong>{syncLabels[props.syncState]}</strong>{props.pending > 0 && <span>· {props.pending} pending {props.pending === 1 ? 'change' : 'changes'}</span>}</div>
        {props.syncError && <p className="form-error" role="alert">{props.syncError}</p>}
        {props.cloudConfigured && <div className="settings-actions">
          {props.session ? <>
            <button className="btn btn-secondary" disabled={busy} onClick={() => void run(props.onSignOut)}><LogOut size={17} /> Sign out</button>
            <button className="btn btn-secondary" onClick={props.refresh}><RefreshCw size={16} /> Check sync</button>
          </> : <button className="btn btn-primary" onClick={props.onSignIn}><LogIn size={17} /> Sign in or create account</button>}
        </div>}
        {props.session && props.syncState === 'failed' && props.pending > 0 && props.discardPending && <div className="discard-actions">
          {confirm ? <><p>Export a copy first to keep your pending edits. Reloading the cloud workspace will discard pending edits on this device.</p><div className="settings-actions">
            <button className="btn btn-secondary" onClick={() => setConfirm(false)}>Keep pending changes</button>
            <button className="btn btn-danger" disabled={busy} onClick={() => void run(async () => { await props.discardPending?.(); setConfirm(false) })}>Discard pending changes</button>
          </div></> : <button className="btn btn-quiet" onClick={() => setConfirm(true)}>Resolve pending changes</button>}
        </div>}
      </section>
      <section className="panel settings-panel" aria-labelledby="data-settings">
        <h2 id="data-settings">Workspace data</h2><p>Download your records and pending changes as a portable JSON file.</p>
        <div className="settings-actions"><button className="btn btn-secondary" disabled={busy} onClick={() => void run(exportData)}><Download size={17} /> Export workspace</button></div>
        {props.session && props.deviceRecordCount > 0 && <div className="discard-actions">
          <p>Copy goals, tasks, and progress from this device into {props.session.email}. Your local copy and existing account records are kept.</p>
          <div className="settings-actions"><button type="button" className="btn btn-primary"
            disabled={busy || props.syncState !== 'saved' || props.pending > 0}
            onClick={() => void run(async () => { setCopyResult(null); setCopyResult(await props.copyDeviceWorkspace()) })}>
            <Upload size={17} /> Copy local workspace to account
          </button></div>
          {copyResult && <p role="status">
            {copyStatus(copyResult)}
            {copyResult.unavailable > 0 && ' Some items stayed local because their parent was removed from the account.'}
          </p>}
        </div>}
      </section>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  </>
}

interface AccountProps {
  onClose: () => void
  signIn: (email: string, password: string) => Promise<unknown>
  signUp: (email: string, password: string) => Promise<boolean>
}

export function AccountDialog({ onClose, signIn, signUp }: AccountProps) {
  const [create, setCreate] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      if (create && !await signUp(email.trim(), password)) {
        setMessage('Check your email to confirm your account, then sign in here.')
        setPassword('')
        setCreate(false)
      } else {
        if (!create) await signIn(email.trim(), password)
        onClose()
      }
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Check your connection and try again.')
    } finally { setBusy(false) }
  }

  return <Dialog title={create ? 'Create an account' : 'Sign in'} description="Use your account to open the same workspace on Windows and the web." onClose={onClose}>
    <form className="editor-form" onSubmit={submit}>
      <label className="field">Email<input autoFocus type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required /></label>
      <label className="field">Password<input type="password" autoComplete={create ? 'new-password' : 'current-password'} minLength={create ? 8 : undefined} value={password} onChange={event => setPassword(event.target.value)} required />{create && <small>Use at least 8 characters.</small>}</label>
      {message && <p role="status">{message}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="editor-actions"><button className="btn btn-quiet" type="button" onClick={() => { setCreate(!create); setError(''); setMessage('') }}>{create ? 'Back to sign in' : 'Create an account'}</button><button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Please wait…' : create ? 'Create account' : 'Sign in'}</button></div>
    </form>
  </Dialog>
}
