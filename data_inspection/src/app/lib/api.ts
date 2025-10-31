import type { DatasetSummary } from '../types'
import type { SparqlQueryResult } from '../workspace/types'

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

export async function executeSparqlQuery(datasetId: string, sparql: string): Promise<SparqlQueryResult>
export async function executeSparqlQuery(sparql: string): Promise<SparqlQueryResult>
export async function executeSparqlQuery(arg1: string, arg2?: string): Promise<SparqlQueryResult> {
  const datasetId = arg2 !== undefined ? arg1 : 'default'
  const query = arg2 ?? arg1
  const url = `${API_BASE_URL}/api/datasets/${encodeURIComponent(datasetId)}/query`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
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

export async function fetchDatasets(): Promise<DatasetSummary[]> {
  const url = `${API_BASE_URL}/api/datasets`
  const response = await fetch(url)
  if (!response.ok) {
    const detail = await parseJson<{ detail?: string }>(response).catch(() => ({ detail: response.statusText }))
    throw new Error(detail.detail || 'Failed to list datasets')
  }
  const data = await parseJson<{ datasets?: DatasetSummary[] }>(response)
  return data.datasets ?? []
}

export async function createDatasetFromCsv(file: File, title?: string): Promise<DatasetSummary> {
  const url = `${API_BASE_URL}/api/datasets`
  const form = new FormData()
  if (title && title.trim().length > 0) {
    form.append('title', title.trim())
  }
  form.append('file', file)
  const response = await fetch(url, { method: 'POST', body: form })
  if (!response.ok) {
    const detail = await parseJson<{ detail?: string }>(response).catch(() => ({ detail: response.statusText }))
    throw new Error(detail.detail || 'Failed to create dataset')
  }
  const data = await parseJson<{ dataset: DatasetSummary }>(response)
  return data.dataset
}

export async function renameDataset(datasetId: string, title: string): Promise<DatasetSummary> {
  const url = `${API_BASE_URL}/api/datasets/${encodeURIComponent(datasetId)}`
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!response.ok) {
    const detail = await parseJson<{ detail?: string }>(response).catch(() => ({ detail: response.statusText }))
    throw new Error(detail.detail || 'Failed to rename dataset')
  }
  const data = await parseJson<{ dataset: DatasetSummary }>(response)
  return data.dataset
}

export async function deleteDataset(datasetId: string): Promise<void> {
  const url = `${API_BASE_URL}/api/datasets/${encodeURIComponent(datasetId)}`
  const response = await fetch(url, { method: 'DELETE' })
  if (!response.ok && response.status !== 204) {
    const detail = await parseJson<{ detail?: string }>(response).catch(() => ({ detail: response.statusText }))
    throw new Error(detail.detail || 'Failed to delete dataset')
  }
}

export type ClusterLogEvent = {
  type: 'log'
  datasetId: string
  level: string
  logger: string
  message: string
}

export type ClusterResultEvent = {
  type: 'result'
  datasetId: string
  workClusters: unknown
  expressionClusters?: unknown
}

export type ClusterErrorEvent = {
  type: 'error'
  datasetId: string
  message: string
}

export type ClusterEvent = ClusterLogEvent | ClusterResultEvent | ClusterErrorEvent

export type ClusterStream = {
  cancel: () => void
  completed: Promise<void>
}

function parseSseChunk(buffer: string, emit: (event: { event: string; data: string }) => void): string {
  const parts = buffer.split(/\n\n/)
  const incomplete = parts.pop() ?? ''
  for (const part of parts) {
    let event = 'message'
    const dataLines: string[] = []
    for (const line of part.split(/\n/)) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim() || event
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart())
      }
    }
    emit({ event, data: dataLines.join('\n') })
  }
  return incomplete
}

export function startClusterStream(
  datasetId: string,
  includeExpressions: boolean,
  onEvent: (event: ClusterEvent) => void,
): ClusterStream {
  const url = `${API_BASE_URL}/api/datasets/${encodeURIComponent(datasetId)}/cluster`
  const controller = new AbortController()
  const completed = (async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ includeExpressions }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const detail = await parseJson<{ detail?: string }>(response).catch(() => ({ detail: response.statusText }))
      throw new Error(detail.detail || 'Failed to start clustering job')
    }
    if (!response.body) {
      throw new Error('Server did not return a streaming body')
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      buffer = parseSseChunk(buffer, ({ event, data }) => {
        if (!data) return
        try {
          const parsed = JSON.parse(data)
          if (event === 'log') {
            onEvent({
              type: 'log',
              datasetId: parsed.datasetId ?? datasetId,
              level: parsed.level,
              logger: parsed.logger,
              message: parsed.message,
            })
          } else if (event === 'result') {
            onEvent({
              type: 'result',
              datasetId: parsed.datasetId ?? datasetId,
              workClusters: parsed.workClusters,
              expressionClusters: parsed.expressionClusters,
            })
          } else if (event === 'error') {
            onEvent({ type: 'error', datasetId: parsed.datasetId ?? datasetId, message: parsed.message || 'Unknown error' })
          }
        } catch (error) {
          console.error('Failed to parse SSE payload', error, data)
        }
      })
    }
    if (buffer.trim().length > 0) {
      parseSseChunk(buffer, ({ event, data }) => {
        if (!data) return
        try {
          const parsed = JSON.parse(data)
          if (event === 'log') {
            onEvent({
              type: 'log',
              datasetId: parsed.datasetId ?? datasetId,
              level: parsed.level,
              logger: parsed.logger,
              message: parsed.message,
            })
          } else if (event === 'result') {
            onEvent({
              type: 'result',
              datasetId: parsed.datasetId ?? datasetId,
              workClusters: parsed.workClusters,
              expressionClusters: parsed.expressionClusters,
            })
          } else if (event === 'error') {
            onEvent({ type: 'error', datasetId: parsed.datasetId ?? datasetId, message: parsed.message || 'Unknown error' })
          }
        } catch (error) {
          console.error('Failed to parse trailing SSE payload', error, data)
        }
      })
    }
  })()

  return {
    cancel: () => controller.abort(),
    completed,
  }
}
