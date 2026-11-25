import Dexie, { liveQuery, type Table } from 'dexie'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  cloud, cloudConfigured, cloudSetupError, confirmationRedirect, readSnapshot, syncFailure, tableName, versionKey, wireRecord,
  type Snapshot, type Versions, type WireChange,
} from './cloud'
import { countDeviceRecords, deviceRecordKey, planDeviceCopy } from './deviceCopy'
import { adjustCount, hasCountTarget, type CountTable } from './counting'
import { applyChanges, changeTaskStatus, emptyWorkspace, entityKeys, put, touch, type Change, type Workspace } from './model'

type Account = { id: string; email: string }
type SyncState = 'local' | 'loading' | 'saving' | 'saved' | 'offline' | 'failed'

class WorkspaceWriteError extends Error {}

interface Batch {
  id: string
  changes: Change[]
  expected: (string | null)[]
  deviceCopy?: true
}

interface CachedWorkspace extends Snapshot {
  key: string
  queue: Batch[]
  copiedDeviceKeys?: string[]
}

class WorkspaceCache extends Dexie {
  workspaces!: Table<CachedWorkspace, string>

  constructor() {
    super('whereami-workspace')
    this.version(1).stores({ workspaces: 'key' })
  }
}

const cache = new WorkspaceCache()
const localKey = 'device'
const initialData = emptyWorkspace()

function emptyCache(key: string): CachedWorkspace {
  return { key, data: emptyWorkspace(), versions: {}, version: key === localKey ? 0 : -1, queue: [] }
}

function visibleWorkspace(entry: CachedWorkspace) {
  return entry.queue.reduce((data, batch) => applyChanges(data, batch.changes), entry.data)
}

// A queued deletion can disassociate other records. Assign the batch revision to those
// records as well so a subsequent offline edit expects the same revision PostgreSQL does.
function projectBatch(data: Workspace, versions: Versions, batch: Batch, captureExpected = false): Workspace {
  for (const [index, change] of batch.changes.entries()) {
    const id = 'record' in change ? change.record.id : change.deleteId
    const key = versionKey(change.table, id)
    if (captureExpected) batch.expected[index] = versions[key] ?? null
    const previous = data
    data = applyChanges(data, [change])

    if ('record' in change) {
      versions[key] = batch.id
    } else {
      for (const table of entityKeys) {
        if (previous[table] === data[table]) continue
        const surviving = new Map(data[table].map(row => [row.id, row]))
        for (const row of previous[table]) {
          const current = surviving.get(row.id)
          const affectedKey = versionKey(table, row.id)
          if (current === undefined) delete versions[affectedKey]
          else if (current !== row) versions[affectedKey] = batch.id
        }
      }
    }
  }
  return data
}

function newBatch(cached: CachedWorkspace, changes: Change[]): Batch {
  const batch: Batch = { id: crypto.randomUUID(), changes, expected: [] }
  const versions = { ...cached.versions }
  const projected = cached.queue.reduce((data, queued) => projectBatch(data, versions, queued), cached.data)
  projectBatch(projected, versions, batch, true)
  return batch
}

function wireBatch(batch: Batch): WireChange[] {
  return batch.changes.map((change, index) => ({
    table: tableName(change.table),
    id: 'record' in change ? change.record.id : change.deleteId,
    op: 'record' in change ? 'put' : 'delete',
    expected_revision: batch.expected[index],
    ...('record' in change ? { record: wireRecord(change.record) } : {}),
  }))
}

async function fetchWorkspace(accountId: string, batch?: Batch): Promise<Snapshot> {
  if (!cloud) throw new Error('Cloud accounts need a Supabase project configuration.')
  const hasTrackerWrite = batch?.changes.some(change => 'record' in change
    && 'countTarget' in change.record && change.record.countTarget !== undefined)
  const { data, error } = batch
    ? await cloud.rpc(hasTrackerWrite ? 'commit_workspace_v3' : 'commit_workspace_v2', {
      p_expected_owner: accountId, p_batch_id: batch.id, p_changes: wireBatch(batch),
    })
    : await cloud.rpc('get_workspace')
  if (error) throw error
  return readSnapshot(data, accountId)
}

async function confirmWorkspace(key: string, snapshot: Snapshot, confirmed = new Set<string>()) {
  await cache.transaction('rw', cache.workspaces, async () => {
    const current = await cache.workspaces.get(key) ?? emptyCache(key)
    const newer = snapshot.version >= current.version ? snapshot : {}
    const confirmedCopies = current.queue.filter(batch => batch.deviceCopy && confirmed.has(batch.id))
    const copiedDeviceKeys = new Set(current.copiedDeviceKeys)
    for (const batch of confirmedCopies) {
      for (const change of batch.changes) {
        if ('record' in change) copiedDeviceKeys.add(deviceRecordKey(change.table, change.record.id))
      }
    }
    await cache.workspaces.put({
      ...current,
      ...newer,
      queue: current.queue.filter(batch => !confirmed.has(batch.id)),
      ...(confirmedCopies.length ? { copiedDeviceKeys: [...copiedDeviceKeys] } : {}),
    })
  })
}

async function withWorkspaceLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  if (navigator.locks) return await navigator.locks.request('whereami-sync/' + key, run)
  return run()
}

function errorMessage(error: unknown, fallback: string) {
  return (error as { message?: string } | null)?.message || fallback
}

export function useWorkspace() {
  const [auth, setAuth] = useState<Account | null | undefined>(cloud ? undefined : null)
  const [cached, setCached] = useState<CachedWorkspace>()
  const [deviceRecordCount, setDeviceRecordCount] = useState(0)
  const [cacheError, setCacheError] = useState<string | null>(null)
  const [authError, setAuthError] = useState<string | null>(cloudSetupError)
  const [sync, setSync] = useState<{ key: string; state: SyncState; error: string | null }>()
  const key = auth ? 'account/' + auth.id : localKey
  const entry = cached?.key === key ? cached : undefined
  const activeKey = useRef(key)
  const refreshRef = useRef<() => void>(() => {})
  activeKey.current = key

  useEffect(() => {
    if (!cloud) return
    let active = true
    const subscription = cloud.auth.onAuthStateChange((event, session) => {
      if (!active) return
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        setAuth(session?.user ? { id: session.user.id, email: session.user.email ?? '' } : null)
        setAuthError(null)
      }
    }).data.subscription

    // Reading the persisted session also surfaces a broken auth storage or token refresh.
    void cloud.auth.getSession().then(({ error }) => {
      if (active && error) {
        setAuthError(error.message)
        setAuth(current => current ?? null)
      }
    }).catch(error => {
      if (active) {
        setAuthError(errorMessage(error, 'Could not open the account session.'))
        setAuth(current => current ?? null)
      }
    })
    return () => { active = false; subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    const query = liveQuery(async () => await cache.workspaces.get(key) ?? emptyCache(key))
    const subscription = query.subscribe({
      next: entry => { setCached(entry); setCacheError(null) },
      error: error => setCacheError(errorMessage(error, 'Could not open durable storage on this device.')),
    })
    return () => subscription.unsubscribe()
  }, [key])

  const accountId = auth?.id
  useEffect(() => {
    if (!accountId) return
    const subscription = liveQuery(async () => {
      const device = await cache.workspaces.get(localKey)
      return device ? countDeviceRecords(visibleWorkspace(device)) : 0
    }).subscribe({
      next: setDeviceRecordCount,
      error: () => setDeviceRecordCount(0),
    })
    return () => subscription.unsubscribe()
  }, [accountId])

  useEffect(() => {
    const client = cloud
    if (!client || !accountId) return
    let active = true
    let working = false
    let recheck = false
    let retryTimer: number | undefined
    const setStatus = (state: SyncState, error: string | null = null) => {
      if (active) setSync({ key, state, error })
    }

    const drain = async () => {
      if (!active) return
      if (working) { recheck = true; return }
      if (!navigator.onLine) {
        setStatus('offline')
        return
      }
      working = true
      window.clearTimeout(retryTimer)
      try {
        await withWorkspaceLock(key, async () => {
          if (!active) return
          let next = await cache.workspaces.get(key)
          if (!next?.queue.length) {
            const snapshot = await fetchWorkspace(accountId)
            await confirmWorkspace(key, snapshot)
            return
          }

          setStatus('saving')
          while (active && next?.queue.length) {
            if (!navigator.onLine) {
              setStatus('offline')
              return
            }
            const first = next.queue[0]
            const snapshot = await fetchWorkspace(accountId, first)
            await confirmWorkspace(key, snapshot, new Set([first.id]))
            next = await cache.workspaces.get(key)
          }
        })
        if (navigator.onLine) setStatus('saved')
      } catch (error) {
        const failure = syncFailure(error)
        setStatus(navigator.onLine ? 'failed' : 'offline', failure.message)
        if (active && navigator.onLine && failure.retry) retryTimer = window.setTimeout(request, 10_000)
      } finally {
        working = false
        if (recheck) {
          recheck = false
          request()
        }
      }
    }

    function request() { void drain() }

    refreshRef.current = request
    setStatus('loading')
    request()
    const interval = window.setInterval(request, 30_000)
    window.addEventListener('focus', request)
    window.addEventListener('online', request)
    window.addEventListener('offline', request)
    const channel = client.channel('whereami/' + accountId + '/' + crypto.randomUUID())
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'workspace_revisions', filter: 'user_id=eq.' + accountId,
      }, request)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'workspace_revisions', filter: 'user_id=eq.' + accountId,
      }, request)
      .subscribe()

    return () => {
      active = false
      refreshRef.current = () => {}
      window.clearTimeout(retryTimer)
      window.clearInterval(interval)
      window.removeEventListener('focus', request)
      window.removeEventListener('online', request)
      window.removeEventListener('offline', request)
      void client.removeChannel(channel)
    }
  }, [accountId, key])

  const data = useMemo(() => entry ? visibleWorkspace(entry) : initialData, [entry])
  const pending = entry?.queue.reduce((count, batch) => count + batch.changes.length, 0) ?? 0
  const remote = sync?.key === key ? sync : undefined
  const syncError = cacheError || authError || remote?.error || null
  let syncState: SyncState = 'loading'
  if (cacheError || authError) syncState = 'failed'
  else if (auth === null && entry) syncState = 'local'
  else if (auth && !navigator.onLine) syncState = 'offline'
  else if (remote) syncState = pending && remote.state === 'saved' ? 'saving' : remote.state

  async function commit(changes: Change[]): Promise<void> {
    if (!changes.length) return
    if (changes.length > 500) throw new Error('Save at most 500 changes at a time.')
    await commitFromLatest(() => changes)
  }

  async function adjustWorkspaceCount(table: CountTable, id: string, delta: number): Promise<void> {
    await commitFromLatest(current => {
      const record = visibleWorkspace(current)[table].find(record => record.id === id)
      if (!record || !hasCountTarget(record)) throw new WorkspaceWriteError('This item no longer has a count target.')
      const updated = adjustCount(record, delta)
      return updated === record ? [] : [put(table, updated)]
    })
  }

  async function setWorkspaceCompletion(table: CountTable, id: string, completed: boolean): Promise<void> {
    await commitFromLatest(current => {
      const record = visibleWorkspace(current)[table].find(record => record.id === id)
      if (!record) throw new WorkspaceWriteError('This item is no longer available.')
      if (hasCountTarget(record)) throw new WorkspaceWriteError('Use the count buttons to update this item.')
      if ('status' in record) {
        if (record.status === 'archived') throw new WorkspaceWriteError('Restore this item before checking it off.')
        const status = completed ? 'completed' : 'active'
        return record.status === status ? [] : [put('tasks', changeTaskStatus(record, status))]
      }
      return record.completed === completed ? [] : [put(table, touch({ ...record, completed }))]
    })
  }

  async function commitFromLatest(makeChanges: (current: CachedWorkspace) => Change[]): Promise<void> {
    if (auth === undefined) throw new Error('The workspace is opening. Try again in a moment.')
    if (activeKey.current !== key) throw new Error('The workspace changed. Return to the original workspace to save.')
    let changed: boolean
    try {
      changed = await cache.transaction('rw', cache.workspaces, async () => {
        const current = await cache.workspaces.get(key) ?? emptyCache(key)
        if (activeKey.current !== key) throw new WorkspaceWriteError('The workspace changed. Return to the original workspace to save.')
        const changes = makeChanges(current)
        if (!changes.length) return false
        const next = auth
          ? { ...current, queue: [...current.queue, newBatch(current, changes)] }
          : { ...current, data: applyChanges(current.data, changes) }
        await cache.workspaces.put(next)
        return true
      })
    } catch (error) {
      if (error instanceof WorkspaceWriteError) throw error
      const message = errorMessage(error, 'Could not save on this device. Free up space or try again.')
      setCacheError(message)
      throw new Error(message)
    }
    if (!changed) return
    setCacheError(null)
    if (activeKey.current === key) refreshRef.current()
  }

  async function signIn(email: string, password: string) {
    if (!cloud) throw new Error('Cloud accounts need a Supabase project configuration.')
    const { error } = await cloud.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  async function signUp(email: string, password: string) {
    if (!cloud) throw new Error('Cloud accounts need a Supabase project configuration.')
    const { data, error } = await cloud.auth.signUp({
      email, password, options: confirmationRedirect ? { emailRedirectTo: confirmationRedirect } : {},
    })
    if (error) throw error
    return Boolean(data.session)
  }

  async function signOut() {
    if (!cloud) return
    const { error } = await cloud.auth.signOut({ scope: 'local' })
    if (error) throw error
    setAuth(null)
  }

  async function copyDeviceWorkspace() {
    if (!accountId) throw new Error('Sign in before copying this device’s workspace.')
    if (!navigator.onLine) throw new Error('Connect to the internet to check the cloud workspace before copying.')
    function checkAccount() {
      if (activeKey.current !== key) throw new Error('The account changed. Sign back in to finish copying.')
    }
    const result = await withWorkspaceLock(key, async () => {
      checkAccount()
      const snapshot = await fetchWorkspace(accountId)
      return cache.transaction('rw', cache.workspaces, async () => {
        const current = await cache.workspaces.get(key) ?? emptyCache(key)
        const device = await cache.workspaces.get(localKey)
        checkAccount()
        if (current.queue.length) throw new Error('Wait for your pending changes to sync before copying.')
        const latest = snapshot.version >= current.version ? snapshot : current
        const plan = planDeviceCopy(device ? visibleWorkspace(device) : initialData, latest.data, current.copiedDeviceKeys ?? [])
        const batches: Batch[] = []
        for (let start = 0; start < plan.changes.length; start += 500) {
          const changes = plan.changes.slice(start, start + 500)
          // These records are new to the account. An unexpected existing
          // revision will stop the batch rather than overwrite cloud data.
          batches.push({ id: crypto.randomUUID(), changes, expected: changes.map(() => null), deviceCopy: true })
        }
        await cache.workspaces.put({
          key, version: latest.version, data: latest.data, versions: latest.versions,
          queue: batches, copiedDeviceKeys: plan.copiedKeys,
        })
        return { recordKeys: plan.recordKeys, unavailable: plan.unavailable }
      })
    })
    if (activeKey.current === key) {
      if (result.recordKeys.length) setSync({ key, state: 'saving', error: null })
      refreshRef.current()
    }
    return result
  }

  async function discardPending() {
    if (!accountId || !navigator.onLine) throw new Error('Connect to the server before discarding queued edits.')
    await withWorkspaceLock(key, async () => {
      const current = await cache.workspaces.get(key)
      const snapshot = await fetchWorkspace(accountId)
      await confirmWorkspace(key, snapshot, new Set(current?.queue.map(batch => batch.id)))
    })
    if (activeKey.current === key) refreshRef.current()
  }

  function getExport() {
    return {
      format: 'whereami-workspace',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      workspace: data,
      pendingBatches: entry?.queue.map(({ id, changes }) => ({ id, changes })) ?? [],
    }
  }

  function isDeviceCopyConfirmed(recordKeys: string[]) {
    const confirmed = new Set(entry?.copiedDeviceKeys)
    return recordKeys.every(id => confirmed.has(id))
  }

  return {
    data, commit, adjustWorkspaceCount, setWorkspaceCompletion, session: auth ?? null, cloudConfigured, syncState, syncError, pending,
    deviceRecordCount, copyDeviceWorkspace, isDeviceCopyConfirmed,
    refresh: () => refreshRef.current(), signIn, signUp, signOut, discardPending, getExport,
  }
}


