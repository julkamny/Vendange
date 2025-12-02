import CodeMirror from '@uiw/react-codemirror'
import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { sql } from '@codemirror/lang-sql'
import { executeSparqlQuery, getApiBaseUrl } from '../lib/api'
import type { WorkspaceTabStateSparql, WorkspaceTabStateWorkspace, AgentTabState } from '../workspace/types'
import type { RecordRow } from '../types'
import { DEFAULT_WORKSPACE_STATE } from '../workspace/types'
import { useTranslation } from '../hooks/useTranslation'
import { useToast } from '../providers/ToastContext'
import { useAppData } from '../providers/AppDataContext'
import { useRecordLookup } from '../hooks/useRecordLookup'
import { useWorkspaceData } from '../workspace/useWorkspaceData'
import { configureTabStateForRecord } from '../workspace/tabState'
import { deriveInternalIdFromArk } from '../lib/ark'
import { SparnaturalBuilder, type ControlledValueOption } from './SparnaturalBuilder'
import { buildSparnaturalConfig } from '../sparql/sparnaturalConfig'
import { ensureGraphWrapping } from '../sparql/queryUtils'
import { labelFromRecord } from '../lib/intermarc'
import { extractControlledValueLabel } from '../core/controlledValues'
import { WorkspaceContextMenu } from './WorkspaceContextMenu'
import { isAgentRecord } from '../agents/useAgentData'

const ARK_REGEX = /ark:\/\S+/g

type SparqlWorkspaceViewProps = {
  state: WorkspaceTabStateSparql
  onStateChange: (updater: (prev: WorkspaceTabStateSparql) => WorkspaceTabStateSparql) => void
  onOpenWorkspaceTab: (
    initializer: (base: WorkspaceTabStateWorkspace) => WorkspaceTabStateWorkspace,
  ) => void
  onOpenWorkspaceTabDetached: (
    initializer: (base: WorkspaceTabStateWorkspace) => WorkspaceTabStateWorkspace,
  ) => void
  onOpenAgentTab: (initializer: (base: AgentTabState) => AgentTabState) => void
  onOpenAgentTabDetached: (initializer: (base: AgentTabState) => AgentTabState) => void
}

type ArkContextMenuState = {
  position: { x: number; y: number }
  record: RecordRow
}

function normalizeArk(value: string): string {
  return value.trim()
}

function isWorkspaceEntityRecord(record?: RecordRow | null): record is RecordRow {
  if (!record) return false
  return record.typeNorm === 'oeuvre' || record.typeNorm === 'expression' || record.typeNorm === 'manifestation'
}

export function SparqlWorkspaceView({
  state,
  onStateChange,
  onOpenWorkspaceTab,
  onOpenWorkspaceTabDetached,
  onOpenAgentTab,
  onOpenAgentTabDetached,
}: SparqlWorkspaceViewProps) {
  const { t, language } = useTranslation()
  const { showToast } = useToast()
  const { clusters, curated, datasetId } = useAppData()
  const { getByArk, getById } = useRecordLookup()
  const sparnaturalConfig = useMemo(() => buildSparnaturalConfig(), [])
  const stubWorkspaceState = useMemo<WorkspaceTabStateWorkspace>(
    () => ({ ...DEFAULT_WORKSPACE_STATE, id: '__sparql__', title: 'SPARQL' }),
    [],
  )
  const workspaceData = useWorkspaceData(stubWorkspaceState)
  const tabContext = useMemo(
    () => ({
      clusters,
      indexes: workspaceData.indexes,
      curatedRecords: curated?.records ?? [],
    }),
    [clusters, workspaceData.indexes, curated?.records],
  )
  const collator = useMemo(() => new Intl.Collator(language, { sensitivity: 'accent' }), [language])
  const [contextMenu, setContextMenu] = useState<ArkContextMenuState | null>(null)
  const controlledValueOptions = useMemo<ControlledValueOption[]>(() => {
    const source = curated?.records ?? []
    const entries = new Map<string, string>()
    for (const record of source) {
      if (record.typeNorm !== 'valeur controlee' || !record.ark) continue
      const label = extractControlledValueLabel(record)
      if (!label || entries.has(record.ark)) continue
      entries.set(record.ark, label)
    }
    return Array.from(entries.entries())
      .map(([ark, label]) => ({ ark, label }))
      .sort((a, b) => a.label.localeCompare(b.label, language, { sensitivity: 'accent' }))
  }, [curated?.records, language])
  const builderDisabled = !datasetId
  const builderKey = `${datasetId ?? 'no-dataset'}-${language}`

  const agentLabelForArk = useCallback(
    (ark: string): string | null => {
      const normalized = normalizeArk(ark)
      let record = getByArk(normalized)
      if (!record) {
        const fallbackId = deriveInternalIdFromArk(normalized)
        if (fallbackId) record = getById(fallbackId)
      }
      if (!record) return null
      if (!['identite publique de personne', 'collectivite', 'famille'].includes(record.typeNorm)) return null
      return labelFromRecord(record) ?? null
    },
    [getByArk, getById],
  )

  useEffect(() => {
    if (!contextMenu) return undefined
    const handleClose = () => setContextMenu(null)
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null)
    }
    window.addEventListener('click', handleClose)
    window.addEventListener('keydown', handleKeydown)
    return () => {
      window.removeEventListener('click', handleClose)
      window.removeEventListener('keydown', handleKeydown)
    }
  }, [contextMenu])

  const extensions = useMemo(() => [sql()], [])

  const visibleColumns = useMemo(() => {
    if (!state.result) return []
    return state.result.columns.filter(column => !state.hiddenColumns.has(column))
  }, [state.result, state.hiddenColumns])

  const sortedRows = useMemo(() => {
    if (!state.result) return []
    const rows = state.result.rows.slice()
    if (!state.sort) return rows
    const { column, direction } = state.sort
    const multiplier = direction === 'asc' ? 1 : -1
    return rows.sort((a, b) => {
      const aVal = a[column]
      const bVal = b[column]
      if (aVal == null && bVal == null) return 0
      if (aVal == null) return -1 * multiplier
      if (bVal == null) return 1 * multiplier
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return aVal === bVal ? 0 : aVal < bVal ? -1 * multiplier : 1 * multiplier
      }
      const aStr = String(aVal)
      const bStr = String(bVal)
      const comparison = collator.compare(aStr, bStr)
      return comparison * multiplier
    })
  }, [state.result, state.sort, collator])

  const apiBaseUrl = getApiBaseUrl()

  const handleQueryChange = useCallback(
    (value: string) => {
      onStateChange(prev => ({ ...prev, query: value }))
    },
    [onStateChange],
  )

  const handleBuilderQuery = useCallback(
    (value: string) => {
      const wrapped = ensureGraphWrapping(value)
      onStateChange(prev => {
        if (prev.query === wrapped) return prev
        return { ...prev, query: wrapped }
      })
    },
    [onStateChange],
  )

  const handleRunQuery = useCallback(async () => {
    const trimmed = state.query.trim()
    if (!trimmed) {
      onStateChange(prev => ({
        ...prev,
        lastRunError: t('workspace.sparqlEmptyQuery', { defaultValue: 'Enter a SPARQL query first.' }),
      }))
      showToast(t('workspace.sparqlEmptyQuery', { defaultValue: 'Enter a SPARQL query first.' }), { tone: 'error' })
      return
    }
    if (!datasetId) {
      showToast(t('workspace.sparqlNoDataset', { defaultValue: 'Chargez une base avant d’exécuter une requête.' }), {
        tone: 'error',
      })
      return
    }
    onStateChange(prev => ({ ...prev, isExecuting: true, lastRunError: null }))
    try {
      const executableQuery = ensureGraphWrapping(state.query)
      const result = await executeSparqlQuery(datasetId, executableQuery)
      onStateChange(prev => {
        const preservedHidden = new Set([...prev.hiddenColumns].filter(column => result.columns.includes(column)))
        const nextSort = prev.sort && result.columns.includes(prev.sort.column) ? prev.sort : null
        return {
          ...prev,
          isExecuting: false,
          lastRunQuery: executableQuery,
          lastRunError: null,
          result,
          hiddenColumns: preservedHidden,
          sort: nextSort,
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      onStateChange(prev => ({ ...prev, isExecuting: false, lastRunError: message }))
      showToast(message, { tone: 'error' })
    }
  }, [state.query, onStateChange, showToast, t, datasetId])

  const handleClearResults = useCallback(() => {
    onStateChange(prev => ({ ...prev, result: null, lastRunQuery: null, sort: null }))
  }, [onStateChange])

  const toggleColumn = useCallback(
    (column: string) => {
      onStateChange(prev => {
        const next = new Set(prev.hiddenColumns)
        if (next.has(column)) {
          next.delete(column)
        } else {
          next.add(column)
        }
        return { ...prev, hiddenColumns: next }
      })
    },
    [onStateChange],
  )

  const toggleSort = useCallback(
    (column: string) => {
      onStateChange(prev => {
        if (prev.sort && prev.sort.column === column) {
          if (prev.sort.direction === 'asc') {
            return { ...prev, sort: { column, direction: 'desc' } }
          }
          return { ...prev, sort: null }
        }
        return { ...prev, sort: { column, direction: 'asc' } }
      })
    },
    [onStateChange],
  )

  const resolveRecordForArk = useCallback(
    (ark: string): RecordRow | null => {
      const trimmed = normalizeArk(ark)
      if (!trimmed) return null
      let record = getByArk(trimmed)
      if (!record) {
        const fallbackId = deriveInternalIdFromArk(trimmed)
        if (fallbackId) record = getById(fallbackId)
      }
      if (!record) return null
      if (isWorkspaceEntityRecord(record) || isAgentRecord(record)) return record
      return null
    },
    [getByArk, getById],
  )

  const openRecordInWorkspace = useCallback(
    (record: RecordRow, options?: { detach?: boolean }) => {
      if (isAgentRecord(record)) {
        const initAgent = (base: AgentTabState) => ({ ...base, selectedAgentId: record.id })
        if (options?.detach) onOpenAgentTabDetached(initAgent)
        else onOpenAgentTab(initAgent)
        return
      }
      const initializer = (base: WorkspaceTabStateWorkspace) => configureTabStateForRecord(base, record, tabContext)
      if (options?.detach) onOpenWorkspaceTabDetached(initializer)
      else onOpenWorkspaceTab(initializer)
    },
    [onOpenAgentTab, onOpenAgentTabDetached, onOpenWorkspaceTab, onOpenWorkspaceTabDetached, tabContext],
  )

  const openRecordForArk = useCallback(
    (ark: string, options?: { detach?: boolean }) => {
      const record = resolveRecordForArk(ark)
      if (!record) {
        showToast(t('workspace.sparqlNoRecordForArk', { defaultValue: 'No record found for this ARK.' }), {
          tone: 'error',
        })
        return
      }
      setContextMenu(null)
      openRecordInWorkspace(record, options)
    },
    [openRecordInWorkspace, resolveRecordForArk, showToast, t],
  )

  const handleContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null
      const arkLink = target?.closest<HTMLElement>('.ark-link')
      if (!arkLink) return
      const rawArk = arkLink.getAttribute('data-ark')
      if (!rawArk) return
      event.preventDefault()
      const record = resolveRecordForArk(rawArk)
      if (!record) return
      setContextMenu({ position: { x: event.clientX, y: event.clientY }, record })
    },
    [resolveRecordForArk],
  )

  const handleOpenContextRecord = useCallback(() => {
    if (!contextMenu) return
    openRecordInWorkspace(contextMenu.record)
    setContextMenu(null)
  }, [contextMenu, openRecordInWorkspace])

  const handleOpenContextRecordDetached = useCallback(() => {
    if (!contextMenu) return
    openRecordInWorkspace(contextMenu.record, { detach: true })
    setContextMenu(null)
  }, [contextMenu, openRecordInWorkspace])

  const renderArkFragments = useCallback(
    (value: string) => {
      const matches = Array.from(value.matchAll(ARK_REGEX))
      if (!matches.length) return value
      const pieces: Array<string | { ark: string }> = []
      let lastIndex = 0
      for (const match of matches) {
        const start = match.index ?? 0
        if (start > lastIndex) {
          pieces.push(value.slice(lastIndex, start))
        }
        const ark = match[0]
        pieces.push({ ark })
        lastIndex = start + ark.length
      }
      if (lastIndex < value.length) {
        pieces.push(value.slice(lastIndex))
      }
      return pieces.map((piece, index) => {
        if (typeof piece === 'string') {
          return <span key={`text-${index}`}>{piece}</span>
        }
        const arkValue = piece.ark
        return (
          <button
            key={`ark-${index}`}
            type="button"
            className="ark-link"
            data-ark={arkValue}
            onClick={() => openRecordForArk(arkValue)}
          >
            {agentLabelForArk(arkValue) ?? arkValue}
          </button>
        )
      })
    },
    [agentLabelForArk, openRecordForArk],
  )

  const renderCell = useCallback(
    (value: unknown) => {
      if (value === null || value === undefined) {
        return <span className="sparql-null">NULL</span>
      }
      if (typeof value === 'number' || typeof value === 'bigint') {
        return value.toString()
      }
      if (typeof value === 'string') {
        const trimmed = value.trim()
        if (trimmed.length === 0) return ''
        if (trimmed.match(ARK_REGEX)?.length === 1 && trimmed === trimmed.match(ARK_REGEX)?.[0]) {
          const display = agentLabelForArk(trimmed) ?? trimmed
          return (
            <button
              type="button"
              className="ark-link"
              data-ark={trimmed}
              onClick={() => openRecordForArk(trimmed)}
            >
              {display}
            </button>
          )
        }
        return renderArkFragments(value)
      }
      if (typeof value === 'boolean') {
        return value ? 'TRUE' : 'FALSE'
      }
      return JSON.stringify(value)
    },
    [agentLabelForArk, openRecordForArk, renderArkFragments],
  )

  return (
    <div className="sparql-workspace" onContextMenu={handleContextMenu}>
      <section className="sparql-editor">
        <header className="sparql-editor__header">
          <div>
            <strong>{t('workspace.sparqlEditorTitle', { defaultValue: 'SPARQL query' })}</strong>
            <span className="sparql-editor__base-url">{apiBaseUrl}</span>
          </div>
          <div className="sparql-editor__actions">
            <button type="button" onClick={handleRunQuery} disabled={state.isExecuting}>
              {state.isExecuting
                ? t('workspace.sparqlRunning', { defaultValue: 'Running…' })
                : t('workspace.sparqlRunQuery', { defaultValue: 'Run query' })}
            </button>
            <button type="button" onClick={handleClearResults} disabled={!state.result}>
              {t('workspace.sparqlClearResults', { defaultValue: 'Clear results' })}
            </button>
          </div>
        </header>
        <div className="sparql-builder">
          <div className="sparql-builder__header">
            <strong>{t('workspace.sparqlBuilderTitle', { defaultValue: 'Visual builder' })}</strong>
            <p>
              {t('workspace.sparqlBuilderHelp', {
                defaultValue:
                  'Assemble W–E–M joins, MARC field filters, and controlled values, then fine-tune the SPARQL below.',
              })}
            </p>
          </div>
          <SparnaturalBuilder
            key={builderKey}
            datasetId={datasetId}
            language={language}
            config={sparnaturalConfig}
            controlledValues={controlledValueOptions}
            disabled={builderDisabled}
            onQueryChange={handleBuilderQuery}
            onSubmit={handleRunQuery}
          />
          {builderDisabled ? (
            <p className="sparql-builder__status">
              {t('workspace.sparqlBuilderDisabled', {
                defaultValue: 'Load a dataset to enable the visual builder.',
              })}
            </p>
          ) : (
            <p className="sparql-builder__status">
              {t('workspace.sparqlBuilderSync', {
                defaultValue: 'Builder updates the editor automatically; run or edit the SPARQL at any time.',
              })}
            </p>
          )}
        </div>
        <CodeMirror
          value={state.query}
          onChange={handleQueryChange}
          height="200px"
          extensions={extensions}
        />
        {state.lastRunError ? <p className="sparql-error">{state.lastRunError}</p> : null}
      </section>
      <section className="sparql-results">
        {state.result ? (
          <>
            <header className="sparql-results__toolbar">
              <span>
                {t('workspace.sparqlRowCount', {
                  defaultValue: '{{count}} rows',
                  count: state.result.rows.length,
                })}
              </span>
              <div className="sparql-columns">
                <strong>{t('workspace.sparqlColumns', { defaultValue: 'Columns' })}</strong>
                <div className="sparql-columns__list">
                  {state.result.columns.map(column => (
                    <label key={column}>
                      <input
                        type="checkbox"
                        checked={!state.hiddenColumns.has(column)}
                        onChange={() => toggleColumn(column)}
                      />
                      <span>{column}</span>
                    </label>
                  ))}
                </div>
              </div>
            </header>
            <div className="sparql-results__table" role="region" aria-live="polite">
              <table>
                <thead>
                  <tr>
                    {visibleColumns.map(column => {
                      const isActiveSort = state.sort?.column === column
                      const indicator = isActiveSort ? (state.sort?.direction === 'asc' ? '▲' : '▼') : ''
                      return (
                        <th key={column}>
                          <button type="button" onClick={() => toggleSort(column)}>
                            {column}
                            <span className="sparql-sort-indicator">{indicator}</span>
                          </button>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row, rowIndex) => (
                    <tr key={`row-${rowIndex}`}>
                      {visibleColumns.map(column => (
                        <td key={`${rowIndex}-${column}`}>{renderCell(row[column])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="sparql-placeholder">
            {t('workspace.sparqlNoResults', { defaultValue: 'Run a query to see results.' })}
          </p>
        )}
      </section>
      {contextMenu ? (
        <WorkspaceContextMenu
          position={contextMenu.position}
          openLabel={t('workspace.openInNewTab', { defaultValue: 'Open in new workspace tab' })}
          openDetachedLabel={t('workspace.openInDetachedWindow', {
            defaultValue: 'Open in detached workspace window',
          })}
          onOpen={handleOpenContextRecord}
          onOpenDetached={handleOpenContextRecordDetached}
        />
      ) : null}
    </div>
  )
}
