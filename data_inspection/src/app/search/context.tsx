import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAppData } from '../providers/AppDataContext'
import type { RecordRow } from '../types'
import { DEFAULT_PREFIXES } from './constants'
import type {
  BuildProgressUpdate,
  BuildResponse,
  JobStatusResponse,
  QueryExecutionResult,
  QueryRequestPayload,
  SearchGraphMetadata,
} from './types'

export type SearchStatus = 'idle' | 'building' | 'ready' | 'empty' | 'error'

type SearchContextValue = {
  status: SearchStatus
  metadata: SearchGraphMetadata | null
  prefixes: string
  lastError: string | null
  progress: BuildProgressUpdate | null
  runQuery: (query: string) => Promise<QueryExecutionResult>
}

const SearchContext = createContext<SearchContextValue | null>(null)

const SEARCH_API_BASE = (
  (import.meta.env.VITE_SEARCH_API_BASE_URL as string | undefined)?.replace(/\/+$/, '') ?? 'http://localhost:8000'
)
const buildUrl = `${SEARCH_API_BASE}/search/build`
const statusUrl = (jobId: string) => `${SEARCH_API_BASE}/search/status/${jobId}`
const queryUrl = (jobId: string) => `${SEARCH_API_BASE}/search/query/${jobId}`
const deleteUrl = (jobId: string) => `${SEARCH_API_BASE}/search/job/${jobId}`
const POLL_INTERVAL_MS = 750

function combineRecords(primary: RecordRow[] = [], secondary: RecordRow[] = []): RecordRow[] {
  const map = new Map<string, RecordRow>()
  secondary.forEach(rec => {
    if (!map.has(rec.id)) map.set(rec.id, rec)
  })
  primary.forEach(rec => {
    map.set(rec.id, rec)
  })
  return Array.from(map.values())
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const data = await response.json()
    if (typeof data?.detail === 'string') return data.detail
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message) return message
  }
  try {
    const text = await response.text()
    if (text) return text
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message) return message
  }
  return `Request failed with status ${response.status}`
}

export function SearchProvider({ children }: { children: ReactNode }) {
  const { curated, original } = useAppData()
  const combinedRecords = useMemo(
    () => combineRecords(curated?.records ?? [], original?.records ?? []),
    [curated?.records, original?.records],
  )

  const [state, setState] = useState<{
    status: SearchStatus
    metadata: SearchGraphMetadata | null
    error: string | null
    progress: BuildProgressUpdate | null
  }>({ status: 'idle', metadata: null, error: null, progress: null })

  const jobIdRef = useRef<string | null>(null)
  const buildRequestIdRef = useRef(0)
  const pollTimeoutRef = useRef<number | null>(null)
  const lastLoggedPercentRef = useRef<number | null>(null)

  const clearPendingTimer = useCallback(() => {
    if (pollTimeoutRef.current !== null) {
      clearTimeout(pollTimeoutRef.current)
      pollTimeoutRef.current = null
    }
  }, [])

  const releaseJob = useCallback(async (jobId: string | null) => {
    if (!jobId) return
    try {
      await fetch(deleteUrl(jobId), { method: 'DELETE' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn('Failed to delete search job', message)
    }
  }, [])

  useEffect(() => {
    return () => {
      clearPendingTimer()
      const jobId = jobIdRef.current
      jobIdRef.current = null
      void releaseJob(jobId)
    }
  }, [clearPendingTimer, releaseJob])

  useEffect(() => {
    let cancelled = false
    const abortController = new AbortController()
    const requestId = buildRequestIdRef.current + 1
    buildRequestIdRef.current = requestId

    const finalize = () => {
      cancelled = true
      abortController.abort()
      clearPendingTimer()
    }

    if (!combinedRecords.length) {
      lastLoggedPercentRef.current = null
      const jobId = jobIdRef.current
      jobIdRef.current = null
      void releaseJob(jobId)
      setState({ status: 'empty', metadata: null, error: null, progress: null })
      return finalize
    }

    setState({
      status: 'building',
      metadata: null,
      error: null,
      progress: { phase: 'indexing', current: 0, total: combinedRecords.length },
    })
    lastLoggedPercentRef.current = null

    const pollStatus = async (jobId: string) => {
      while (!cancelled && buildRequestIdRef.current === requestId) {
        try {
          const response = await fetch(statusUrl(jobId), { signal: abortController.signal })
          if (!response.ok) {
            throw new Error(await readErrorMessage(response))
          }
          const payload = (await response.json()) as JobStatusResponse
          if (cancelled || buildRequestIdRef.current !== requestId) return

          if (payload.progress) {
            const percent = payload.progress.total
              ? Math.round((payload.progress.current / payload.progress.total) * 100)
              : 0
            if (lastLoggedPercentRef.current !== percent) {
              lastLoggedPercentRef.current = percent
              console.info('Search index build progress', {
                jobId,
                phase: payload.progress.phase,
                percent,
                current: payload.progress.current,
                total: payload.progress.total,
              })
            }
            setState(prev => ({ ...prev, progress: payload.progress ?? null }))
          }

          if (payload.status === 'ready' && payload.metadata) {
            lastLoggedPercentRef.current = null
            if (!cancelled && buildRequestIdRef.current === requestId) {
              setState({ status: 'ready', metadata: payload.metadata, error: null, progress: null })
              console.info('Search index build completed', { jobId, records: combinedRecords.length })
            }
            return
          }

          if (payload.status === 'error') {
            lastLoggedPercentRef.current = null
            jobIdRef.current = null
            if (!cancelled && buildRequestIdRef.current === requestId) {
              const message = payload.error || 'Search graph build failed'
              setState({ status: 'error', metadata: null, error: message, progress: null })
              console.error('Search index build failed', message)
            }
            return
          }
        } catch (error) {
          if (cancelled || buildRequestIdRef.current !== requestId) return
          lastLoggedPercentRef.current = null
          jobIdRef.current = null
          const message = error instanceof Error ? error.message : String(error)
          setState({ status: 'error', metadata: null, error: message, progress: null })
          console.error('Search index build failed', message)
          return
        }

        await new Promise<void>(resolve => {
          pollTimeoutRef.current = window.setTimeout(() => {
            pollTimeoutRef.current = null
            resolve()
          }, POLL_INTERVAL_MS)
        })
      }
    }

    void (async () => {
      await releaseJob(jobIdRef.current)
      if (cancelled || buildRequestIdRef.current !== requestId) return

      jobIdRef.current = null
      try {
        const response = await fetch(buildUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ records: combinedRecords }),
        })
        if (!response.ok) {
          throw new Error(await readErrorMessage(response))
        }
        const payload = (await response.json()) as BuildResponse
        if (cancelled || buildRequestIdRef.current !== requestId) return
        jobIdRef.current = payload.jobId
        console.info('Search index build started', { jobId: payload.jobId, total: combinedRecords.length })
        await pollStatus(payload.jobId)
      } catch (error) {
        if (cancelled || buildRequestIdRef.current !== requestId) return
        lastLoggedPercentRef.current = null
        jobIdRef.current = null
        const message = error instanceof Error ? error.message : String(error)
        setState({ status: 'error', metadata: null, error: message, progress: null })
        console.error('Search index build failed', message)
      }
    })()

    return finalize
  }, [clearPendingTimer, combinedRecords, releaseJob])

  const runQuery = useCallback(
    async (query: string): Promise<QueryExecutionResult> => {
      if (state.status !== 'ready' || !jobIdRef.current) {
        throw new Error('Search graph is not ready yet')
      }
      const trimmed = query.trim()
      if (!trimmed) return { kind: 'empty' }
      const payload: QueryRequestPayload = { query: `${DEFAULT_PREFIXES}\n${trimmed}` }
      try {
        const response = await fetch(queryUrl(jobIdRef.current), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!response.ok) {
          throw new Error(await readErrorMessage(response))
        }
        return (await response.json()) as QueryExecutionResult
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('Search query failed', message)
        throw new Error(message)
      }
    },
    [state.status],
  )

  const value = useMemo<SearchContextValue>(
    () => ({
      status: state.status,
      metadata: state.metadata,
      prefixes: DEFAULT_PREFIXES,
      lastError: state.error,
      progress: state.progress,
      runQuery,
    }),
    [state.status, state.metadata, state.error, state.progress, runQuery],
  )

  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>
}

export function useSearchContext(): SearchContextValue {
  const ctx = useContext(SearchContext)
  if (!ctx) throw new Error('useSearchContext must be used within SearchProvider')
  return ctx
}
