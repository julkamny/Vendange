import type {
  DatasetSummary,
  WorkspaceWorksResponse,
  WorkClusterDto,
  WorkspaceAgentsResponse,
  WorkRecordPayload,
  BacklinksResponse,
} from '../types'
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
  } catch {
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

export type DatasetRecordPayload = {
  id: string
  type: string
  ark?: string | null
  intermarc: string
  arkLabels?: Record<string, string>
  ark_labels?: Record<string, string>
}

export async function syncRecordUpdate(
  datasetId: string,
  payload: { id: string; type: string; intermarc: string },
): Promise<WorkspaceUpdatePayload> {
  const url = `${API_BASE_URL}/api/datasets/${encodeURIComponent(datasetId)}/update_record`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: payload.id, type: payload.type, intermarc: payload.intermarc }),
  })
  if (!response.ok) {
    const detail = await parseJson<{ detail?: string }>(response).catch(() => ({ detail: response.statusText }))
    throw new Error(detail.detail || 'Failed to synchronise record update')
  }
  return parseJson<WorkspaceUpdatePayload>(response)
}

export type WorkspaceUpdatePayload = {
  updatedRecords?: DatasetRecordPayload[]
  updatedClusters?: unknown[]
  removedClusterIds?: string[]
  updatedWorkRows?: unknown[]
}

export async function swapClusterAnchor(
  datasetId: string,
  payload: { anchorId: string; targetId: string },
): Promise<WorkspaceUpdatePayload> {
  const url = `${API_BASE_URL}/api/datasets/${encodeURIComponent(datasetId)}/swap_anchor`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ anchorId: payload.anchorId, targetId: payload.targetId }),
  })
  if (!response.ok) {
    const detail = await parseJson<{ detail?: string }>(response).catch(() => ({ detail: response.statusText }))
    throw new Error(detail.detail || 'Failed to swap cluster anchor')
  }
  return parseJson<WorkspaceUpdatePayload>(response)
}

export async function swapWorkOriginality(
  datasetId: string,
  payload: { originalId: string; targetId: string },
): Promise<WorkspaceUpdatePayload> {
  const url = `${API_BASE_URL}/api/datasets/${encodeURIComponent(datasetId)}/swap_originality`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ originalId: payload.originalId, targetId: payload.targetId }),
  })
  if (!response.ok) {
    const detail = await parseJson<{ detail?: string }>(response).catch(() => ({ detail: response.statusText }))
    throw new Error(detail.detail || 'Failed to swap originality')
  }
  return parseJson<WorkspaceUpdatePayload>(response)
}

export async function updateManualCluster(
  datasetId: string,
  payload: { anchorId: string; targetId?: string; targetArk?: string; accepted: boolean },
): Promise<WorkspaceUpdatePayload> {
  const url = `${API_BASE_URL}/api/datasets/${encodeURIComponent(datasetId)}/manual_cluster`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      anchorId: payload.anchorId,
      targetId: payload.targetId,
      targetArk: payload.targetArk,
      accepted: payload.accepted,
    }),
  })
  if (!response.ok) {
    const detail = await parseJson<{ detail?: string }>(response).catch(() => ({ detail: response.statusText }))
    throw new Error(detail.detail || 'Failed to update manual cluster')
  }
  return parseJson<WorkspaceUpdatePayload>(response)
}

export async function uprootManifestation(
  datasetId: string,
  payload: {
    manifestationId: string
    targetExpressionId?: string
    targetExpressionArk: string
    detachArks: string[]
    partialArk?: string | null
  },
): Promise<WorkspaceUpdatePayload> {
  const url = `${API_BASE_URL}/api/datasets/${encodeURIComponent(datasetId)}/manifestations/uproot`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      manifestationId: payload.manifestationId,
      targetExpressionId: payload.targetExpressionId,
      targetExpressionArk: payload.targetExpressionArk,
      detachArks: payload.detachArks,
      partialArk: payload.partialArk,
    }),
  })
  if (!response.ok) {
    const detail = await parseJson<{ detail?: string }>(response).catch(() => ({ detail: response.statusText }))
    throw new Error(detail.detail || 'Failed to uproot manifestation')
  }
  return parseJson<WorkspaceUpdatePayload>(response)
}

export async function fetchWorkspaceWorks(datasetId: string): Promise<WorkspaceWorksResponse> {
  const url = `${API_BASE_URL}/api/datasets/${encodeURIComponent(datasetId)}/workspace/works`
  const response = await fetch(url)
  if (!response.ok) {
    const detail = await parseJson<{ detail?: string }>(response).catch(() => ({ detail: response.statusText }))
    throw new Error(detail.detail || 'Failed to load workspace works')
  }
  return parseJson<WorkspaceWorksResponse>(response)
}

export async function fetchWorkCluster(datasetId: string, anchorKey: string): Promise<WorkClusterDto> {
  const url = `${API_BASE_URL}/api/datasets/${encodeURIComponent(datasetId)}/workspace/work/${encodeURIComponent(anchorKey)}`
  const response = await fetch(url)
  if (!response.ok) {
    const detail = await parseJson<{ detail?: string }>(response).catch(() => ({ detail: response.statusText }))
    throw new Error(detail.detail || 'Failed to load work cluster')
  }
  return parseJson<WorkClusterDto>(response)
}

export async function fetchWorkspaceAgents(datasetId: string): Promise<WorkspaceAgentsResponse> {
  const url = `${API_BASE_URL}/api/datasets/${encodeURIComponent(datasetId)}/workspace/agents`
  const response = await fetch(url)
  if (!response.ok) {
    const detail = await parseJson<{ detail?: string }>(response).catch(() => ({ detail: response.statusText }))
    throw new Error(detail.detail || 'Failed to load workspace agents')
  }
  return parseJson<WorkspaceAgentsResponse>(response)
}

export async function fetchWorkspaceRecord(datasetId: string, recordKey: string): Promise<WorkRecordPayload> {
  const url = `${API_BASE_URL}/api/datasets/${encodeURIComponent(datasetId)}/workspace/record/${encodeURIComponent(recordKey)}`
  const response = await fetch(url)
  if (!response.ok) {
    const detail = await parseJson<{ detail?: string }>(response).catch(() => ({ detail: response.statusText }))
    throw new Error(detail.detail || 'Failed to load record')
  }
  return parseJson<WorkRecordPayload>(response)
}

export async function fetchWorkspaceBacklinks(datasetId: string, recordKey: string): Promise<BacklinksResponse> {
  const url = `${API_BASE_URL}/api/datasets/${encodeURIComponent(datasetId)}/workspace/backlinks/${encodeURIComponent(recordKey)}`
  const response = await fetch(url)
  if (!response.ok) {
    const detail = await parseJson<{ detail?: string }>(response).catch(() => ({ detail: response.statusText }))
    throw new Error(detail.detail || 'Failed to load backlinks')
  }
  return parseJson<BacklinksResponse>(response)
}

export type ClusterLogEvent = {
  type: 'log'
  datasetId: string
  level: string
  logger: string
  message: string
  timestamp?: string
  logFile?: string
  logUrl?: string
  exception?: string
}

export type ClusterResultEvent = {
  type: 'result'
  datasetId: string
  workClusters: unknown
  expressionClusters?: unknown
  lastClusteredAt?: string | null
  logFile?: string
  logUrl?: string
}

export type ClusterErrorEvent = {
  type: 'error'
  datasetId: string
  message: string
  logFile?: string
  logUrl?: string
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

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'name' in error && (error as { name?: string }).name === 'AbortError')
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
    const emitFromChunk = ({ event, data }: { event: string; data: string }) => {
      if (!data) return
      try {
        const parsed = JSON.parse(data)
        const targetDataset = parsed.datasetId ?? datasetId
        if (event === 'log') {
          onEvent({
            type: 'log',
            datasetId: targetDataset,
            level: parsed.level ?? 'INFO',
            logger: parsed.logger ?? 'data_curation',
            message: parsed.message ?? '',
            timestamp: parsed.timestamp,
            logFile: parsed.logFile,
            logUrl: parsed.logUrl,
            exception: parsed.exception,
          })
        } else if (event === 'result') {
          onEvent({
            type: 'result',
            datasetId: targetDataset,
            workClusters: parsed.workClusters,
            expressionClusters: parsed.expressionClusters,
            lastClusteredAt: parsed.lastClusteredAt,
            logFile: parsed.logFile,
            logUrl: parsed.logUrl,
          })
        } else if (event === 'error') {
          onEvent({
            type: 'error',
            datasetId: targetDataset,
            message: parsed.message || 'Unknown error',
            logFile: parsed.logFile,
            logUrl: parsed.logUrl,
          })
        }
      } catch (error) {
        console.error('Failed to parse SSE payload', error, data)
      }
    }
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        buffer = parseSseChunk(buffer, emitFromChunk)
      }
    } catch (error) {
      if (error instanceof TypeError && /input stream/i.test(error.message)) {
        if (buffer.trim().length > 0) {
          parseSseChunk(buffer, emitFromChunk)
        }
        return
      }
      if (isAbortError(error)) {
        throw error
      }
      throw error
    }
    if (buffer.trim().length > 0) {
      parseSseChunk(buffer, emitFromChunk)
    }
  })()

  return {
    cancel: () => controller.abort(),
    completed,
  }
}

function parseFilenameFromContentDisposition(header: string | null): string | undefined {
  if (!header) return undefined
  const filenameMatch =
    header.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i) ?? header.match(/filename="?([^";]+)"?/i)
  if (!filenameMatch || filenameMatch.length < 2) return undefined
  const raw = filenameMatch[1].trim()
  try {
    return decodeURIComponent(raw.replace(/"/g, ''))
  } catch {
    return raw.replace(/"/g, '')
  }
}

type FetchClusterLogOptions = {
  logFile?: string
  logUrl?: string
}

export async function fetchClusterLog(
  datasetId: string,
  options?: FetchClusterLogOptions,
): Promise<{ blob: Blob; filename: string }> {
  const logFile = options?.logFile
  const rawUrl = options?.logUrl
  let endpoint: string
  if (rawUrl && rawUrl.trim().length > 0) {
    endpoint = rawUrl.startsWith('http') ? rawUrl : `${API_BASE_URL}${rawUrl}`
  } else {
    endpoint = logFile
      ? `${API_BASE_URL}/api/datasets/${encodeURIComponent(datasetId)}/cluster/logs/${encodeURIComponent(logFile)}`
      : `${API_BASE_URL}/api/datasets/${encodeURIComponent(datasetId)}/cluster/logs/latest`
  }
  const response = await fetch(endpoint)
  if (!response.ok) {
    const detail = await parseJson<{ detail?: string }>(response).catch(() => ({ detail: response.statusText }))
    throw new Error(detail.detail || 'Failed to download cluster logs')
  }
  const blob = await response.blob()
  const filename =
    parseFilenameFromContentDisposition(response.headers.get('Content-Disposition')) ??
    (logFile ? `${logFile}.zip` : `${datasetId}-cluster-log.zip`)
  return { blob, filename }
}
