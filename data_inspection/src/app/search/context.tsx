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
import type { SearchGraphMetadata, BuildProgressUpdate } from './graph'
import type { QueryExecutionResult } from './types'
import type { WorkerRequest, WorkerResponse } from './workerTypes'

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

  const workerRef = useRef<Worker | null>(null)
  const requestCounterRef = useRef(0)
  const currentBuildIdRef = useRef<number | null>(null)
  const pendingQueriesRef = useRef(
    new Map<
      number,
      {
        resolve: (value: QueryExecutionResult) => void
        reject: (reason?: unknown) => void
      }
    >(),
  )
  const lastLoggedPercentRef = useRef<number | null>(null)

  const ensureWorker = useCallback(() => {
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL('./searchWorker.ts', import.meta.url), { type: 'module' })
    }
    return workerRef.current
  }, [])

  useEffect(() => {
    const worker = ensureWorker()
    const handleMessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data
      switch (message.type) {
        case 'progress': {
          if (message.requestId !== currentBuildIdRef.current) break
          const percent = message.progress.total
            ? Math.round((message.progress.current / message.progress.total) * 100)
            : 0
          if (lastLoggedPercentRef.current !== percent) {
            lastLoggedPercentRef.current = percent
            console.info('Search index build progress', {
              phase: message.progress.phase,
              percent,
              current: message.progress.current,
              total: message.progress.total,
            })
          }
          setState(prev => ({ ...prev, progress: message.progress }))
          break
        }
        case 'built': {
          if (message.requestId !== currentBuildIdRef.current) break
          lastLoggedPercentRef.current = null
          setState({ status: 'ready', metadata: message.metadata, error: null, progress: null })
          console.info('Search index build completed', {
            records: combinedRecords.length,
          })
          break
        }
        case 'build-error': {
          if (message.requestId !== currentBuildIdRef.current) break
          lastLoggedPercentRef.current = null
          setState({ status: 'error', metadata: null, error: message.error, progress: null })
          console.error('Search index build failed', message.error)
          break
        }
        case 'query-result': {
          const pending = pendingQueriesRef.current.get(message.requestId)
          if (pending) {
            pending.resolve(message.result)
            pendingQueriesRef.current.delete(message.requestId)
          }
          break
        }
        case 'query-error': {
          const pending = pendingQueriesRef.current.get(message.requestId)
          if (pending) {
            pending.reject(new Error(message.error))
            pendingQueriesRef.current.delete(message.requestId)
          }
          break
        }
        default:
          break
      }
    }
    worker.addEventListener('message', handleMessage)
    return () => {
      worker.removeEventListener('message', handleMessage)
    }
  }, [combinedRecords.length, ensureWorker])

  useEffect(() => {
    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
      pendingQueriesRef.current.clear()
    }
  }, [])

  useEffect(() => {
    if (!combinedRecords.length) {
      currentBuildIdRef.current = null
      lastLoggedPercentRef.current = null
      if (workerRef.current) {
        workerRef.current.postMessage({ type: 'reset' } as WorkerRequest)
      }
      setState({ status: 'empty', metadata: null, error: null, progress: null })
      return
    }
    const worker = ensureWorker()
    const requestId = ++requestCounterRef.current
    currentBuildIdRef.current = requestId
    lastLoggedPercentRef.current = null
    setState({
      status: 'building',
      metadata: null,
      error: null,
      progress: { phase: 'indexing', current: 0, total: combinedRecords.length },
    })
    worker.postMessage({ type: 'build', requestId, records: combinedRecords } as WorkerRequest)
    console.info('Search index build started', { total: combinedRecords.length })
  }, [combinedRecords, ensureWorker])

  const runQuery = useCallback(
    async (query: string): Promise<QueryExecutionResult> => {
      if (state.status !== 'ready') {
        throw new Error('Search graph is not ready yet')
      }
      const trimmed = query.trim()
      if (!trimmed) return { kind: 'empty' }
      const finalQuery = `${DEFAULT_PREFIXES}\n${trimmed}`
      const worker = ensureWorker()
      const requestId = ++requestCounterRef.current
      return new Promise<QueryExecutionResult>((resolve, reject) => {
        pendingQueriesRef.current.set(requestId, { resolve, reject })
        worker.postMessage({ type: 'query', requestId, query: finalQuery } as WorkerRequest)
      })
    },
    [ensureWorker, state.status],
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
