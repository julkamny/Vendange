import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAppData } from '../providers/AppDataContext'
import type { RecordRow } from '../types'
import { DEFAULT_PREFIXES } from './constants'
import { buildSearchGraph, type SearchGraphBuildResult, type SearchGraphMetadata } from './graph'
import type { Term } from 'oxigraph'

export type SearchStatus = 'idle' | 'building' | 'ready' | 'empty' | 'error'

type QueryTerm = {
  termType: string
  value: string
  language?: string
  datatype?: string
}

type QueryBindingRow = Record<string, QueryTerm>

type SelectResult = {
  kind: 'select'
  variables: string[]
  rows: QueryBindingRow[]
}

type BooleanResult = {
  kind: 'boolean'
  value: boolean
}

type ConstructResult = {
  kind: 'construct'
  quads: string[]
}

type EmptyResult = { kind: 'empty' }

export type QueryExecutionResult = SelectResult | BooleanResult | ConstructResult | EmptyResult

type SearchContextValue = {
  status: SearchStatus
  metadata: SearchGraphMetadata | null
  prefixes: string
  lastError: string | null
  runQuery: (query: string) => Promise<QueryExecutionResult>
}

const SearchContext = createContext<SearchContextValue | null>(null)

function serializeTerm(term: Term): QueryTerm {
  switch (term.termType) {
    case 'NamedNode':
      return { termType: term.termType, value: term.value }
    case 'BlankNode':
      return { termType: term.termType, value: term.value }
    case 'Literal':
      return {
        termType: term.termType,
        value: term.value,
        language: term.language || undefined,
        datatype: term.datatype?.value,
      }
    default:
      return { termType: term.termType, value: term.value }
  }
}

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
    store: SearchGraphBuildResult['store'] | null
    error: string | null
  }>({ status: 'idle', metadata: null, store: null, error: null })

  useEffect(() => {
    let cancelled = false
    if (!combinedRecords.length) {
      setState({ status: 'empty', metadata: null, store: null, error: null })
      return
    }
    setState({ status: 'building', metadata: null, store: null, error: null })
    buildSearchGraph(combinedRecords)
      .then(result => {
        if (cancelled) return
        setState({ status: 'ready', metadata: result.metadata, store: result.store, error: null })
      })
      .catch(err => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        setState({ status: 'error', metadata: null, store: null, error: message })
      })
    return () => {
      cancelled = true
    }
  }, [combinedRecords])

  const runQuery = useCallback(
    async (query: string): Promise<QueryExecutionResult> => {
      if (!state.store) {
        throw new Error('Search graph is not ready yet')
      }
      const trimmed = query.trim()
      if (!trimmed) return { kind: 'empty' }
      const finalQuery = `${DEFAULT_PREFIXES}\n${trimmed}`
      const result = state.store.query(finalQuery)
      if (typeof result === 'boolean') {
        return { kind: 'boolean', value: result }
      }
      if (Array.isArray(result)) {
        if (result.length === 0) {
          return { kind: 'select', variables: [], rows: [] }
        }
        const sample = result[0]
        if (sample instanceof Map) {
          const variables = Array.from(sample.keys())
          const rows = result.map(rowMap => {
            const row = rowMap as Map<string, Term>
            const converted: QueryBindingRow = {}
            for (const variable of variables) {
              const term = row.get(variable)
              if (term) {
                converted[variable] = serializeTerm(term)
              }
            }
            return converted
          })
          return { kind: 'select', variables, rows }
        }
        return { kind: 'construct', quads: (result as Array<{ toString(): string }>).map(q => q.toString()) }
      }
      if (typeof result === 'string') {
        return { kind: 'construct', quads: [result] }
      }
      return { kind: 'empty' }
    },
    [state.store],
  )

  const value = useMemo<SearchContextValue>(
    () => ({
      status: state.status,
      metadata: state.metadata,
      prefixes: DEFAULT_PREFIXES,
      lastError: state.error,
      runQuery,
    }),
    [state.status, state.metadata, state.error, runQuery],
  )

  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>
}

export function useSearchContext(): SearchContextValue {
  const ctx = useContext(SearchContext)
  if (!ctx) throw new Error('useSearchContext must be used within SearchProvider')
  return ctx
}
