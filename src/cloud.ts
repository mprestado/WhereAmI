import { createClient } from '@supabase/supabase-js'
import { emptyWorkspace, entityKeys, type EntityKey, type Workspace } from './model'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY)?.trim()

export const confirmationRedirect: string | undefined = import.meta.env.VITE_AUTH_REDIRECT_URL?.trim() || undefined

function configureCloud() {
  if (!url && !key) return { client: null, error: null }
  if (!url || !key) return { client: null, error: 'Set both the Supabase URL and publishable key to enable sync.' }

  try {
    const endpoint = new URL(url)
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)
    if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && loopback)) {
      throw new Error('Use an HTTPS Supabase URL.')
    }
    return { client: createClient(url, key), error: null }
  } catch (error) {
    return { client: null, error: error instanceof Error ? error.message : 'The Supabase project URL is invalid.' }
  }
}

const setup = configureCloud()
export const cloud = setup.client
export const cloudConfigured = Boolean(cloud)
export const cloudSetupError = setup.error

export const tableName = (table: EntityKey) => table === 'checklistItems' ? 'checklist_items' : table

const snakeCase = (name: string) => name.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase())
const camelCase = (name: string) => name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())

export const wireRecord = (record: object) =>
  Object.fromEntries(Object.entries(record).map(([name, value]) => [snakeCase(name), value]))

export interface WireChange {
  table: string
  id: string
  op: 'put' | 'delete'
  expected_revision: string | null
  record?: Record<string, unknown>
}

export type Versions = Record<string, string>

export function versionKey(table: EntityKey, id: string) {
  return table + '/' + id
}

export interface Snapshot {
  data: Workspace
  versions: Versions
  version: number
}

export function readSnapshot(input: unknown, ownerId: string): Snapshot {
  if (typeof input !== 'object' || input === null) throw new Error('The server returned an invalid workspace.')
  const response = input as Record<string, unknown>
  if (response.owner_id !== ownerId) throw new Error('The cloud account changed. Sign in again and retry.')
  const version = Number(response.version)
  if (!Number.isSafeInteger(version) || version < 0) throw new Error('The server returned an invalid workspace version.')

  const data = emptyWorkspace()
  const versions: Versions = {}
  for (const table of entityKeys) {
    const rows = response[tableName(table)]
    if (!Array.isArray(rows)) throw new Error('The server returned an incomplete workspace.')

    const records = rows.map((row: Record<string, unknown>) => {
      const { revision, count_target, count_value, ...record } = row
      if (typeof revision !== 'string' || typeof record.id !== 'string') {
        throw new Error('The server returned a record without an identity.')
      }
      versions[versionKey(table, record.id)] = revision
      // SQL adds default tracker fields to older records. Keep the fields
      // absent on ordinary records so their edits retain the compatible RPC.
      if (count_target != null) Object.assign(record, { count_target, count_value })
      return Object.fromEntries(Object.entries(record).map(([name, value]) => [
        camelCase(name),
        name.endsWith('_at') && typeof value === 'string' ? new Date(value).toISOString() : value,
      ]))
    })
    Object.assign(data, { [table]: records })
  }
  return { version, data, versions }
}

export function syncFailure(error: unknown): { message: string; retry: boolean } {
  const failure = error as { code?: string; message?: string } | null
  const code = failure?.code
  if (code === '40001') {
    return { message: 'A queued record changed on another device. Export to keep your edits, then discard the queue or retry.', retry: false }
  }
  if (code === '42501' || code === 'PGRST301' || code === 'PGRST302') {
    return { message: 'The account session could not save these edits. Sign in again and retry.', retry: false }
  }
  if (code?.startsWith('22') || code?.startsWith('23')) {
    return { message: 'The server rejected a queued edit. Export to keep your edits before clearing the queue.', retry: false }
  }
  if (code === 'PGRST202' || code === '42883' || code === '42P01') {
    return { message: 'The workspace database needs the WhereAmI migration. Your queued edits are still stored here.', retry: false }
  }
  return { message: failure?.message || 'Could not reach the workspace server.', retry: true }
}


