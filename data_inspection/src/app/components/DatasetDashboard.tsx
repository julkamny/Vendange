import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  createDatasetFromCsv,
  deleteDataset,
  fetchDatasets,
  renameDataset,
  startClusterStream,
  type ClusterEvent,
  type ClusterStream,
} from '../lib/api'
import type { DatasetSummary } from '../types'
import { useToast } from '../providers/ToastContext'

type DatasetDashboardProps = {
  onOpenInspection: (dataset: DatasetSummary) => void
}

type ClusterState = {
  includeExpressions: boolean
  running: boolean
  logs: string[]
  error?: string
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

export function DatasetDashboard({ onOpenInspection }: DatasetDashboardProps) {
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
      if (!clusterStates[datasetId]) {
        return { includeExpressions: false, running: false, logs: [] }
      }
      return clusterStates[datasetId]
    },
    [clusterStates],
  )

  const refreshDatasets = useCallback(async () => {
    setLoading(true)
    try {
      const list = await fetchDatasets()
      setDatasets(list)
      setClusterStates(prev => {
        const next: Record<string, ClusterState> = {}
        for (const dataset of list) {
          next[dataset.id] = prev[dataset.id] ?? { includeExpressions: false, running: false, logs: [] }
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
  }, [])

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
          [dataset.id]: prev[dataset.id] ?? { includeExpressions: false, running: false, logs: [] },
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

  const appendLog = useCallback((datasetId: string, message: string) => {
    setClusterStates(prev => {
      const current = prev[datasetId] ?? { includeExpressions: false, running: false, logs: [] }
      const logs = [...current.logs, message].slice(-MAX_LOG_LINES)
      return {
        ...prev,
        [datasetId]: { ...current, logs },
      }
    })
  }, [])

  const handleClusterEvent = useCallback(
    (datasetId: string, event: ClusterEvent) => {
      if (event.type === 'log') {
        appendLog(datasetId, `[${event.level}] ${event.message}`)
      } else if (event.type === 'result') {
        const workCount = Array.isArray(event.workClusters) ? event.workClusters.length : 0
        const expressionCount = Array.isArray(event.expressionClusters) ? event.expressionClusters.length : 0
        appendLog(datasetId, `Terminé. Regroupements œuvres: ${workCount}, expressions: ${expressionCount}`)
        showToast('Clusterisation terminée.', { tone: 'success' })
      } else if (event.type === 'error') {
        appendLog(datasetId, `Erreur: ${event.message}`)
        setClusterStates(prev => {
          const current = prev[datasetId] ?? { includeExpressions: false, running: false, logs: [] }
          return {
            ...prev,
            [datasetId]: { ...current, running: false, error: event.message },
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
      setClusterStates(prev => ({
        ...prev,
        [datasetId]: { ...state, running: true, error: undefined, logs: [] },
      }))
      const stream = startClusterStream(datasetId, state.includeExpressions, event => handleClusterEvent(datasetId, event))
      clusterControllers.current.set(datasetId, stream)
      stream.completed
        .then(() => {
          clusterControllers.current.delete(datasetId)
          setClusterStates(prev => {
            const current = prev[datasetId] ?? { includeExpressions: false, running: false, logs: [] }
            return { ...prev, [datasetId]: { ...current, running: false } }
          })
          refreshDatasets().catch(error => console.error(error))
        })
        .catch(error => {
          if (error && typeof error === 'object' && 'name' in error && (error as { name?: string }).name === 'AbortError') {
            clusterControllers.current.delete(datasetId)
            setClusterStates(prev => {
              const current = prev[datasetId] ?? { includeExpressions: false, running: false, logs: [] }
              return { ...prev, [datasetId]: { ...current, running: false } }
            })
            return
          }
          console.error('Cluster stream failed', error)
          clusterControllers.current.delete(datasetId)
          setClusterStates(prev => {
            const current = prev[datasetId] ?? { includeExpressions: false, running: false, logs: [] }
            return { ...prev, [datasetId]: { ...current, running: false, error: String(error) } }
          })
          showToast("La clusterisation a échoué.", { tone: 'error' })
        })
    },
    [ensureClusterState, handleClusterEvent, refreshDatasets, showToast],
  )

  const handleToggleIncludeExpressions = useCallback((datasetId: string, includeExpressions: boolean) => {
    setClusterStates(prev => {
      const current = prev[datasetId] ?? { includeExpressions: false, running: false, logs: [] }
      return {
        ...prev,
        [datasetId]: { ...current, includeExpressions },
      }
    })
  }, [])

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
              </dl>
              <div className="dataset-card__controls">
                <label>
                  <input
                    type="checkbox"
                    checked={state.includeExpressions}
                    disabled={state.running}
                    onChange={event => handleToggleIncludeExpressions(dataset.id, event.target.checked)}
                  />{' '}
                  Propager aux expressions
                </label>
                <div className="dataset-card__buttons">
                  <button type="button" onClick={() => runCluster(dataset.id)} disabled={state.running}>
                    {state.running ? 'En cours…' : 'Lancer la clusterisation'}
                  </button>
                  <button type="button" onClick={() => onOpenInspection(dataset)} disabled={state.running}>
                    Ouvrir l&#39;inspection
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
                  state.logs.map((line, index) => <div key={`${dataset.id}-log-${index}`}>{line}</div>)
                )}
              </div>
              {state.error && <p className="dataset-card__error">Erreur : {state.error}</p>}
            </section>
          )
        })}
      </div>
    </div>
  )
}
