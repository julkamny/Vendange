import type { SqlQueryResult } from '../workspace/types'

const DEFAULT_API_BASE_URL = 'http://localhost:8000'

function resolveBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw.replace(/\/$/, '')
  }
  return DEFAULT_API_BASE_URL
}

const API_BASE_URL = resolveBaseUrl()

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text()
  try {
    return JSON.parse(text) as T
  } catch (error) {
    throw new Error(`Unexpected response from server: ${text || response.statusText}`)
  }
}

export async function uploadDataset(kind: 'original' | 'curated', file: File): Promise<number> {
  const url = `${API_BASE_URL}/api/upload`
  const form = new FormData()
  form.append('dataset', kind)
  form.append('file', file)
  const response = await fetch(url, {
    method: 'POST',
    body: form,
  })
  if (!response.ok) {
    const detail = await parseJson<{ detail?: string }>(response).catch(() => ({ detail: response.statusText }))
    throw new Error(detail.detail || `Failed to upload ${kind} dataset`)
  }
  const data = await parseJson<{ records?: number }>(response)
  return data.records ?? 0
}

export async function syncRecordUpdate(payload: { id: string; type: string; intermarc: string }): Promise<void> {
  const url = `${API_BASE_URL}/api/update_record`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const detail = await parseJson<{ detail?: string }>(response).catch(() => ({ detail: response.statusText }))
    throw new Error(detail.detail || 'Failed to synchronise record update')
  }
}

export async function executeSqlQuery(sql: string): Promise<SqlQueryResult> {
  const url = `${API_BASE_URL}/api/query`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  })
  if (!response.ok) {
    const detail = await parseJson<{ detail?: string }>(response).catch(() => ({ detail: response.statusText }))
    throw new Error(detail.detail || 'Query failed')
  }
  const data = await parseJson<{ columns: string[]; rows: Array<Record<string, unknown>> }>(response)
  return { columns: data.columns, rows: data.rows }
}

export function getApiBaseUrl(): string {
  return API_BASE_URL
}
