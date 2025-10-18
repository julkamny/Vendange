import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './sparnaturalGlobals'
import type { SparnaturalElement } from 'sparnatural'
import { SparnaturalElement as SparnaturalElementClass } from 'sparnatural'
import '../../../node_modules/sparnatural/dist/browser/sparnatural.css'
import 'sparnatural/dist/browser'
import { useSearchContext } from './context'
import type { QueryExecutionResult } from './types'
import { sparnaturalConfigTtl } from './config'
import { useTranslation } from '../hooks/useTranslation'

const SEARCH_API_BASE = (
  (import.meta.env.VITE_SEARCH_API_BASE_URL as string | undefined)?.replace(/\/+$/, '') ?? 'http://localhost:8000'
)

export function SearchPanel() {
  const { t, language } = useTranslation()
  const { status, runQuery, prefixes, lastError, progress } = useSearchContext()
  const sparnaturalRef = useRef<SparnaturalElement | null>(null)
  const [builderQuery, setBuilderQuery] = useState('')
  const [expandedQuery, setExpandedQuery] = useState('')
  const [manualQuery, setManualQuery] = useState('')
  const [manualDirty, setManualDirty] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [executionError, setExecutionError] = useState<string | null>(null)
  const [executionResult, setExecutionResult] = useState<QueryExecutionResult>({ kind: 'empty' })
  const [lastRanQuery, setLastRanQuery] = useState('')

  const handleBuilderUpdate = useCallback(
    (query: string) => {
      setBuilderQuery(query)
      const element = sparnaturalRef.current
      let nextExpanded = query
      if (element && typeof element.expandSparql === 'function') {
        try {
          nextExpanded = element.expandSparql(query)
        } catch (error) {
          console.error('Failed to expand SPARQL query', error)
        }
      }
      setExpandedQuery(nextExpanded)
      if (!manualDirty) {
        setManualQuery(nextExpanded)
      }
    },
    [manualDirty],
  )

  useEffect(() => {
    const element = sparnaturalRef.current
    if (!element) return
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ queryString?: string }>
      const query = custom.detail?.queryString ?? ''
      handleBuilderUpdate(query)
    }
    element.addEventListener(SparnaturalElementClass.EVENT_QUERY_UPDATED, handler as EventListener)
    return () => {
      element.removeEventListener(SparnaturalElementClass.EVENT_QUERY_UPDATED, handler as EventListener)
    }
  }, [handleBuilderUpdate])

  const effectiveQuery = manualQuery.trim() || expandedQuery.trim() || builderQuery.trim()

  const handleRunQuery = async () => {
    if (!effectiveQuery) return
    setExecuting(true)
    setExecutionError(null)
    try {
      const result = await runQuery(effectiveQuery)
      setExecutionResult(result)
      setLastRanQuery(effectiveQuery)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setExecutionError(message)
    } finally {
      setExecuting(false)
    }
  }

  const resetToBuilder = () => {
    setManualQuery(expandedQuery)
    setManualDirty(false)
  }

  const copyPrefixes = async () => {
    try {
      await navigator.clipboard.writeText(prefixes.trim())
    } catch (error) {
      console.error('Failed to copy prefixes', error)
    }
  }

  const statusMessage = useMemo(() => {
    if (status === 'building') {
      if (progress && progress.total > 0) {
        const percent = Math.round((progress.current / progress.total) * 100)
        return t('search.status.buildingProgress', { percent })
      }
      return t('search.status.building')
    }
    if (status === 'empty') return t('search.status.empty')
    if (status === 'error') return lastError ? `${t('search.status.error')}: ${lastError}` : t('search.status.error')
    return null
  }, [status, progress, lastError, t])

  return (
    <div className="search-panel">
      <section className="search-panel__builder">
        <header>
          <h2>{t('search.builderTitle')}</h2>
        </header>
        <div className="search-panel__builder-body">
          {/* @ts-expect-error Sparnatural custom element provided at runtime */}
          <spar-natural
            ref={sparnaturalRef}
            src={sparnaturalConfigTtl}
            lang={language}
            defaultLang={language}
            endpoint={`${SEARCH_API_BASE}/search/query`}
            distinct="true"
            limit="200"
            debug="false"
          />
        </div>
      </section>
      <section className="search-panel__query">
        <header className="search-panel__query-header">
          <h3>{t('search.queryTitle')}</h3>
          <div className="search-panel__query-actions">
            <button type="button" onClick={copyPrefixes}>{t('search.copyPrefixes')}</button>
            <button type="button" disabled={executing || !effectiveQuery || status !== 'ready'} onClick={handleRunQuery}>
              {executing ? t('search.running') : t('search.run')}
            </button>
            <button type="button" onClick={resetToBuilder} disabled={!manualDirty}>
              {t('search.reset')}
            </button>
          </div>
        </header>
        <textarea
          className="search-panel__query-editor"
          value={manualQuery}
          onChange={event => {
            setManualDirty(true)
            setManualQuery(event.target.value)
          }}
          placeholder={t('search.queryPlaceholder')}
          rows={10}
        />
        {statusMessage && <p className="search-panel__status">{statusMessage}</p>}
        {executionError && <p className="search-panel__error">{executionError}</p>}
      </section>
      <section className="search-panel__results">
        <header>
          <h3>{t('search.resultsTitle')}</h3>
          {lastRanQuery && <p className="search-panel__results-query">{t('search.lastQueryPrefix')} {lastRanQuery}</p>}
        </header>
        <ResultView result={executionResult} />
      </section>
      <aside className="search-panel__help">
        <h3>{t('search.help.title')}</h3>
        <ul>
          <li>{t('search.help.normalized')}</li>
          <li>{t('search.help.quantifiers')}</li>
          <li>{t('search.help.relationships')}</li>
          <li>{t('search.help.editing')}</li>
        </ul>
      </aside>
    </div>
  )
}

type ResultViewProps = {
  result: QueryExecutionResult
}

function ResultView({ result }: ResultViewProps) {
  const { t } = useTranslation()
  if (result.kind === 'empty') {
    return <p className="search-panel__results-empty">{t('search.results.empty')}</p>
  }
  if (result.kind === 'boolean') {
    return (
      <p className="search-panel__results-boolean">
        {result.value ? t('search.results.booleanTrue') : t('search.results.booleanFalse')}
      </p>
    )
  }
  if (result.kind === 'construct') {
    return (
      <pre className="search-panel__results-construct">
        {result.quads.map((line, index) => (
          <span key={index}>{line}\n</span>
        ))}
      </pre>
    )
  }
  if (result.kind === 'select') {
    if (!result.rows.length) {
      return <p className="search-panel__results-empty">{t('search.results.empty')}</p>
    }
    return (
      <div className="search-panel__table-wrapper">
        <table className="search-panel__table">
          <thead>
            <tr>
              {result.variables.map(variable => (
                <th key={variable}>{variable}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, index) => (
              <tr key={index}>
                {result.variables.map(variable => {
                  const term = row[variable]
                  if (!term) return <td key={variable} />
                  const display = term.datatype
                    ? `${term.value}^^${term.datatype}`
                    : term.language
                      ? `${term.value}@${term.language}`
                      : term.value
                  return <td key={variable}>{display}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  return null
}
