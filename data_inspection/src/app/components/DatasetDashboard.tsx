import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  createDatasetFromCsv,
  deleteDataset,
  fetchDatasets,
  renameDataset,
  startClusterStream,
  fetchClusterLog,
  type ClusterEvent,
  type ClusterStream,
} from '../lib/api'
import type { DatasetSummary } from '../types'
import { useToast } from '../providers/ToastContext'

type DatasetDashboardProps = {
  onOpenInspection: (dataset: DatasetSummary) => Promise<void>
  openingDatasetId?: string
}

type ClusterLogEntry = {
  timestamp?: string
  level: string
  logger?: string
  message: string
  exception?: string
  logFile?: string
  logUrl?: string
}

type ClusterState = {
  includeExpressions: boolean
  running: boolean
  logs: ClusterLogEntry[]
  hasRun: boolean
  error?: string
  logFile?: string
  logUrl?: string
}

const MAX_LOG_LINES = 200
const numberFormatter = new Intl.NumberFormat()

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  const megabytes = bytes / (1024 * 1024)
  if (megabytes < 1) {
    const kilobytes = bytes / 1024
    return `${kilobytes.toFixed(1)} KB`
  }
  return `${megabytes.toFixed(2)} MB`
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function formatLogTimestamp(value?: string): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatLogEntry(entry: ClusterLogEntry): string {
  const timestamp = formatLogTimestamp(entry.timestamp)
  const parts: string[] = []
  if (timestamp) parts.push(`[${timestamp}]`)
  parts.push(`[${entry.level.toUpperCase()}]`)
  if (entry.logger) parts.push(entry.logger)
  parts.push(entry.message)
  return parts.join(' ')
}

export function DatasetDashboard({ onOpenInspection, openingDatasetId }: DatasetDashboardProps) {
  const { showToast } = useToast()
  const [datasets, setDatasets] = useState<DatasetSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pendingTitle, setPendingTitle] = useState('')
  const [clusterStates, setClusterStates] = useState<Record<string, ClusterState>>({})
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const clusterControllers = useRef<Map<string, ClusterStream>>(new Map())

  const ensureClusterState = useCallback(
    (datasetId: string): ClusterState => {
      const existing = clusterStates[datasetId]
      if (existing) return existing
      const dataset = datasets.find(item => item.id === datasetId)
      return {
        includeExpressions: false,
        running: false,
        logs: [],
        hasRun: Boolean(dataset?.lastClusteredAt),
        error: undefined,
        logFile: undefined,
        logUrl: undefined,
      }
    },
    [clusterStates, datasets],
  )

  const refreshDatasets = useCallback(async () => {
    setLoading(true)
    try {
      const list = await fetchDatasets()
      setDatasets(list)
      setClusterStates(prev => {
        const next: Record<string, ClusterState> = {}
        for (const dataset of list) {
          const previous = prev[dataset.id]
          next[dataset.id] = {
            includeExpressions: previous?.includeExpressions ?? false,
            running: false,
            logs: previous?.logs ?? [],
            error: undefined,
            hasRun: previous?.hasRun ?? Boolean(dataset.lastClusteredAt),
            logFile: previous?.logFile,
            logUrl: previous?.logUrl,
          }
        }
        return next
      })
    } catch (error) {
      console.error('Failed to list datasets', error)
      showToast('Impossible de charger la liste des bases de travail.', { tone: 'error' })
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    refreshDatasets().catch(error => console.error(error))
    return () => {
      clusterControllers.current.forEach(stream => stream.cancel())
      clusterControllers.current.clear()
    }
  }, [refreshDatasets])

  const handleFileButtonClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [datasets])

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return

      setUploading(true)
      try {
        const baseName = file.name.replace(/\\.csv$/i, '')
        const dataset = await createDatasetFromCsv(file, baseName)
        setDatasets(prev => [dataset, ...prev.filter(item => item.id !== dataset.id)])
        setClusterStates(prev => ({
          ...prev,
          [dataset.id]: prev[dataset.id] ?? { includeExpressions: false, running: false, logs: [], hasRun: Boolean(dataset.lastClusteredAt) },
        }))
        showToast(`Base "${dataset.title}" prête.`, { tone: 'success' })
      } catch (error) {
        console.error('Failed to create dataset', error)
        showToast("Échec du chargement du CSV.", { tone: 'error' })
      } finally {
        setUploading(false)
      }
    },
    [showToast],
  )

  const handleStartRename = useCallback((dataset: DatasetSummary) => {
    setEditingId(dataset.id)
    setPendingTitle(dataset.title)
  }, [])

  const applyRename = useCallback(
    async (datasetId: string, title: string) => {
      if (!title.trim()) {
        showToast('Le titre ne peut pas être vide.', { tone: 'error' })
        return
      }
      try {
        const updated = await renameDataset(datasetId, title.trim())
        setDatasets(prev => prev.map(item => (item.id === updated.id ? updated : item)))
        showToast(`Titre mis à jour.`)
      } catch (error) {
        console.error('Failed to rename dataset', error)
        showToast("Impossible de renommer la base.", { tone: 'error' })
      } finally {
        setEditingId(null)
        setPendingTitle('')
      }
    },
    [showToast],
  )

  const handleDeleteDataset = useCallback(
    async (dataset: DatasetSummary) => {
      const confirmed = window.confirm(`Supprimer la base « ${dataset.title} » ? Cette action est définitive.`)
      if (!confirmed) return
      const controller = clusterControllers.current.get(dataset.id)
      if (controller) {
        controller.cancel()
        clusterControllers.current.delete(dataset.id)
      }
      try {
        await deleteDataset(dataset.id)
        setDatasets(prev => prev.filter(item => item.id !== dataset.id))
        setClusterStates(prev => {
          const next = { ...prev }
          delete next[dataset.id]
          return next
        })
        showToast('Base supprimée.', { tone: 'success' })
      } catch (error) {
        console.error('Failed to delete dataset', error)
        showToast("La suppression a échoué.", { tone: 'error' })
      }
    },
    [showToast],
  )

  const appendLog = useCallback((datasetId: string, entry: ClusterLogEntry) => {
    setClusterStates(prev => {
      const current = prev[datasetId] ?? {
        includeExpressions: false,
        running: false,
        logs: [],
        hasRun: Boolean(datasets.find(item => item.id === datasetId)?.lastClusteredAt),
        error: undefined,
        logFile: undefined,
        logUrl: undefined,
      }
      const logs = [...current.logs, entry].slice(-MAX_LOG_LINES)
      return {
        ...prev,
        [datasetId]: {
          ...current,
          logs,
          logFile: entry.logFile ?? current.logFile,
          logUrl: entry.logUrl ?? current.logUrl,
        },
      }
    })
  }, [datasets])

  const handleClusterEvent = useCallback(
    (datasetId: string, event: ClusterEvent) => {
      if (event.type === 'log') {
        appendLog(datasetId, {
          level: event.level,
          logger: event.logger,
          message: event.message,
          timestamp: event.timestamp,
          exception: event.exception,
          logFile: event.logFile,
          logUrl: event.logUrl,
        })
      } else if (event.type === 'result') {
        const workCount = Array.isArray(event.workClusters) ? event.workClusters.length : 0
        const expressionCount = Array.isArray(event.expressionClusters) ? event.expressionClusters.length : 0
        appendLog(datasetId, {
          level: 'INFO',
          message: `Terminé. Regroupements œuvres: ${workCount}, expressions: ${expressionCount}`,
          timestamp: event.lastClusteredAt ?? undefined,
          logFile: event.logFile,
          logUrl: event.logUrl,
        })
        setClusterStates(prev => {
          const current = prev[datasetId] ?? {
            includeExpressions: false,
            running: false,
            logs: [],
            hasRun: false,
            error: undefined,
            logFile: undefined,
            logUrl: undefined,
          }
          return {
            ...prev,
            [datasetId]: {
              ...current,
              hasRun: true,
              running: false,
              logFile: event.logFile ?? current.logFile,
              logUrl: event.logUrl ?? current.logUrl,
            },
          }
        })
        if (event.lastClusteredAt) {
          setDatasets(prev =>
            prev.map(item => (item.id === datasetId ? { ...item, lastClusteredAt: event.lastClusteredAt ?? item.lastClusteredAt } : item)),
          )
        }
        showToast('Clusterisation terminée.', { tone: 'success' })
      } else if (event.type === 'error') {
        appendLog(datasetId, {
          level: 'ERROR',
          message: `Erreur: ${event.message}`,
          logFile: event.logFile,
          logUrl: event.logUrl,
        })
        setClusterStates(prev => {
          const current = prev[datasetId] ?? {
            includeExpressions: false,
            running: false,
            logs: [],
            hasRun: false,
            error: undefined,
            logFile: undefined,
            logUrl: undefined,
          }
          return {
            ...prev,
            [datasetId]: {
              ...current,
              running: false,
              error: event.message,
              logFile: event.logFile ?? current.logFile,
              logUrl: event.logUrl ?? current.logUrl,
            },
          }
        })
        showToast("La clusterisation a échoué.", { tone: 'error' })
      }
    },
    [appendLog, showToast],
  )

  const runCluster = useCallback(
    (datasetId: string) => {
      const state = ensureClusterState(datasetId)
      if (state.running) return
      if (state.hasRun) {
        showToast('La clusterisation a déjà été effectuée pour cette base.', { tone: 'info' })
        return
      }
      setClusterStates(prev => ({
        ...prev,
        [datasetId]: { ...state, running: true, error: undefined, logs: [], hasRun: false, logFile: undefined, logUrl: undefined },
      }))
      const stream = startClusterStream(datasetId, state.includeExpressions, event => handleClusterEvent(datasetId, event))
      clusterControllers.current.set(datasetId, stream)
      stream.completed
        .then(() => {
          clusterControllers.current.delete(datasetId)
          setClusterStates(prev => {
            const current = prev[datasetId] ?? {
              includeExpressions: false,
              running: false,
              logs: [],
              hasRun: false,
              error: undefined,
              logFile: undefined,
              logUrl: undefined,
            }
            return { ...prev, [datasetId]: { ...current, running: false } }
          })
          refreshDatasets().catch(error => console.error(error))
        })
        .catch(error => {
          if (error && typeof error === 'object' && 'name' in error && (error as { name?: string }).name === 'AbortError') {
            clusterControllers.current.delete(datasetId)
            setClusterStates(prev => {
              const current = prev[datasetId] ?? {
                includeExpressions: false,
                running: false,
                logs: [],
                hasRun: false,
                error: undefined,
                logFile: undefined,
                logUrl: undefined,
              }
              return { ...prev, [datasetId]: { ...current, running: false } }
            })
            return
          }
          console.error('Cluster stream failed', error)
          clusterControllers.current.delete(datasetId)
          setClusterStates(prev => {
            const current = prev[datasetId] ?? {
              includeExpressions: false,
              running: false,
              logs: [],
              hasRun: false,
              error: undefined,
              logFile: undefined,
              logUrl: undefined,
            }
            return { ...prev, [datasetId]: { ...current, running: false, error: String(error) } }
          })
          showToast("La clusterisation a échoué.", { tone: 'error' })
        })
    },
    [ensureClusterState, handleClusterEvent, refreshDatasets, showToast],
  )

  const handleToggleIncludeExpressions = useCallback((datasetId: string, includeExpressions: boolean) => {
    setClusterStates(prev => {
      const current = prev[datasetId] ?? {
        includeExpressions: false,
        running: false,
        logs: [],
        hasRun: Boolean(datasets.find(item => item.id === datasetId)?.lastClusteredAt),
        error: undefined,
        logFile: undefined,
        logUrl: undefined,
      }
      return {
        ...prev,
        [datasetId]: { ...current, includeExpressions },
      }
    })
  }, [datasets])

  const handleDownloadLogs = useCallback(
    async (datasetId: string) => {
      const state = ensureClusterState(datasetId)
      try {
        const options =
          state.logFile || state.logUrl
            ? {
                logFile: state.logFile,
                logUrl: state.logUrl,
              }
            : undefined
        const { blob, filename } = await fetchClusterLog(datasetId, options)
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = filename
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        URL.revokeObjectURL(url)
      } catch (error) {
        console.error('Failed to download cluster logs', error)
        showToast("Impossible de télécharger les logs.", { tone: 'error' })
      }
    },
    [ensureClusterState, showToast],
  )

  const sortedDatasets = useMemo(
    () =>
      [...datasets].sort((a, b) => {
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      }),
    [datasets],
  )

  return (
    <div className="dataset-dashboard">
      <header className="dataset-dashboard__header">
        <div>
          <h1>Bases de travail</h1>
          <p>Chargez un CSV, lancez les scripts, puis ouvrez la vue d&#39;inspection.</p>
        </div>
        <div className="dataset-dashboard__actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <button type="button" onClick={handleFileButtonClick} disabled={uploading}>
            {uploading ? 'Chargement…' : 'Ajouter un CSV'}
          </button>
          <button type="button" onClick={() => refreshDatasets().catch(error => console.error(error))} disabled={loading}>
            Actualiser
          </button>
        </div>
      </header>
      {loading && <p className="dataset-dashboard__loading">Chargement des bases en cours…</p>}
      {!loading && sortedDatasets.length === 0 && (
        <p className="dataset-dashboard__empty">Aucune base de travail n&#39;a encore été chargée.</p>
      )}
      <div className="dataset-grid">
        {sortedDatasets.map(dataset => {
          const state = ensureClusterState(dataset.id)
          return (
            <section key={dataset.id} className={`dataset-card${state.running ? ' is-running' : ''}`}>
              <header className="dataset-card__header">
                {editingId === dataset.id ? (
                  <input
                    autoFocus
                    value={pendingTitle}
                    onChange={event => setPendingTitle(event.target.value)}
                    onBlur={() => applyRename(dataset.id, pendingTitle)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.currentTarget.blur()
                      } else if (event.key === 'Escape') {
                        setEditingId(null)
                        setPendingTitle('')
                      }
                    }}
                  />
                ) : (
                  <h2 title={dataset.title} onDoubleClick={() => handleStartRename(dataset)}>
                    {dataset.title}
                  </h2>
                )}
                <button type="button" className="dataset-card__rename" onClick={() => handleStartRename(dataset)}>
                  Renommer
                </button>
              </header>
              <dl className="dataset-card__stats">
                <div>
                  <dt>Entités</dt>
                  <dd>{numberFormatter.format(dataset.stats.entityCount)}</dd>
                </div>
                <div>
                  <dt>Quads</dt>
                  <dd>{numberFormatter.format(dataset.stats.quadCount)}</dd>
                </div>
                <div>
                  <dt>Taille</dt>
                  <dd>{formatBytes(dataset.stats.sizeBytes)}</dd>
                </div>
                <div>
                  <dt>Modifiée</dt>
                  <dd>{formatTimestamp(dataset.updatedAt)}</dd>
                </div>
                {dataset.lastClusteredAt ? (
                  <div>
                    <dt>Clusterisée</dt>
                    <dd>{formatTimestamp(dataset.lastClusteredAt)}</dd>
                  </div>
                ) : null}
              </dl>
              <div className="dataset-card__controls">
                <label>
                  <input
                    type="checkbox"
                    checked={state.includeExpressions}
                    disabled={state.running || state.hasRun}
                    onChange={event => handleToggleIncludeExpressions(dataset.id, event.target.checked)}
                  />{' '}
                  Propager aux expressions
                </label>
                <div className="dataset-card__buttons">
                  <button
                    type="button"
                    onClick={() => runCluster(dataset.id)}
                    disabled={state.running || state.hasRun}
                  >
                    {state.running
                      ? 'En cours…'
                      : state.hasRun
                        ? 'Clusterisation effectuée'
                        : 'Lancer la clusterisation'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void onOpenInspection(dataset)}
                    disabled={state.running || openingDatasetId === dataset.id}
                  >
                    {openingDatasetId === dataset.id ? 'Ouverture…' : "Ouvrir l'inspection"}
                  </button>
                  <button type="button" className="danger" onClick={() => handleDeleteDataset(dataset)} disabled={state.running}>
                    Supprimer
                  </button>
                </div>
              </div>
              <div className="dataset-card__console" aria-live="polite">
                {state.logs.length === 0 ? (
                  <span className="dataset-card__console--placeholder">Console en attente…</span>
                ) : (
                  state.logs.map((entry, index) => (
                    <div key={`${dataset.id}-log-${index}`} className={`dataset-card__log dataset-card__log--${entry.level.toLowerCase()}`}>
                      <div>{formatLogEntry(entry)}</div>
                      {entry.exception ? <pre>{entry.exception}</pre> : null}
                    </div>
                  ))
                )}
              </div>
              <div className="dataset-card__log-actions">
                <button
                  type="button"
                  onClick={() => handleDownloadLogs(dataset.id)}
                  disabled={
                    state.running || (!state.hasRun && state.logs.length === 0 && !state.logFile && !state.logUrl)
                  }
                >
                  Télécharger les logs (.zip)
                </button>
                {state.logFile ? <span className="dataset-card__log-footnote">Dernier bundle : {state.logFile}</span> : null}
              </div>
              {state.error && <p className="dataset-card__error">Erreur : {state.error}</p>}
            </section>
          )
        })}
      </div>
    </div>
  )
}
