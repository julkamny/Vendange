/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, useState, useCallback, useRef, useEffect, type ReactNode } from 'react'
import type {
  CsvTable,
  RecordRow,
  Cluster,
  ExpressionClusterItem,
  ExpressionItem,
  ManifestationItem,
} from '../types'
import type { Intermarc } from '../lib/intermarc'
import {
  parseIntermarc,
  primeArkLabelCache,
  resetArkLabelCache,
  registerArkLabelForRecord,
  findZones,
  rebuildWorkCluster90FEntries,
  rebuildExpressionCluster90FEntries,
} from '../lib/intermarc'
import { detectClusters, buildArkIndex } from '../core/clusters'
import { buildOriginalIndexes, type OriginalIndexes } from '../core/originalIndexes'
import { getCurrentLanguage } from '../i18n'
import { normalizeType } from '../core/records'
import { stringifyCsv } from '../lib/csv'
import { useToast } from './ToastContext'
import { cloneIntermarc } from '../core/intermarc-utils'
import { fetchDatasetRecords, syncRecordUpdate, type DatasetRecordPayload } from '../lib/api'
import { postBroadcastEvent, subscribeToBroadcast, getBroadcastClientId } from '../lib/broadcast'

// --- Types -----------------------------------------------------------------

type DataSet = {
  csv: CsvTable
  records: RecordRow[]
  intermarcIndex: number
}

type UpdatePayload = {
  id: string
  type: string
  intermarc: string
}

export type AppDataState = {
  datasetId: string | null
  datasetTitle: string | null
  curated: DataSet | null
  pristineRecords: Map<string, RecordRow>
  clusters: Cluster[]
  loadingDataset: boolean
  originalIndexes: OriginalIndexes | null
}

type AppDataContextValue = AppDataState & {
  loadDataset: (datasetId: string, options?: { title?: string }) => Promise<DatasetSummary>
  refreshDataset: () => Promise<void>
  updateRecordIntermarc: (recordId: string, intermarc: Intermarc) => void
  getCuratedBaselineRecord: (recordId: string) => RecordRow | null
  setWorkAccepted: (clusterId: string, workArk: string, accepted: boolean) => void
  setExpressionAccepted: (
    clusterId: string,
    anchorExpressionId: string,
    expressionArk: string,
    accepted: boolean,
  ) => void
  moveManifestation: (
    clusterId: string,
    manifestationId: string,
    target: { anchorExpressionId: string | null; expressionId?: string; expressionArk: string },
  ) => void
  exportCurated: () => Promise<void>
  clearData: () => void
}

const INITIAL_STATE: AppDataState = {
  datasetId: null,
  datasetTitle: null,
  curated: null,
  pristineRecords: new Map(),
  clusters: [],
  loadingDataset: false,
  originalIndexes: null,
}

const AppDataContext = createContext<AppDataContextValue | null>(null)

export function useAppData() {
  const ctx = useContext(AppDataContext)
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider')
  return ctx
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { showToast } = useToast()
  const [state, setState] = useState<AppDataState>(INITIAL_STATE)
  const datasetIdRef = useRef<string | null>(null)
  const clientId = getBroadcastClientId()

  useEffect(() => {
    datasetIdRef.current = state.datasetId
  }, [state.datasetId])

  const loadDataset = useCallback(
    async (datasetId: string, options?: { title?: string }) => {
      setState(prev => ({ ...prev, loadingDataset: true }))
      try {
        const { dataset, records } = await fetchDatasetRecords(datasetId)
        const built = buildDataSetFromRecords(records)
        const language = getCurrentLanguage()
        const originalIndexes = buildOriginalIndexes(built.records, language)
        const clusters = detectClusters(built.records, buildArkIndex(built.records))
        resetArkLabelCache()
        primeArkLabelCache(built.records)
        setState({
          datasetId,
          datasetTitle: options?.title ?? dataset.title,
          curated: built,
          pristineRecords: new Map(),
          clusters,
          loadingDataset: false,
          originalIndexes,
        })
        return {
          id: dataset.id,
          title: dataset.title,
          createdAt: dataset.created_at,
          updatedAt: dataset.updated_at,
          sourceFilename: dataset.source_filename,
          lastClusteredAt: dataset.last_clustered_at,
          stats: {
            entityCount: dataset.stats.entity_count,
            quadCount: dataset.stats.quad_count,
            sizeBytes: dataset.stats.size_bytes,
          },
        }
      } catch (error) {
        console.error('Failed to load dataset', error)
        showToast('Impossible de charger la base sélectionnée.', { tone: 'error' })
        setState(prev => ({ ...prev, loadingDataset: false }))
        throw error
      }
    },
    [showToast],
  )

  const refreshDataset = useCallback(async () => {
    if (!state.datasetId) return
    await loadDataset(state.datasetId, { title: state.datasetTitle ?? undefined })
  }, [loadDataset, state.datasetId, state.datasetTitle])

  useEffect(() => {
    if (!state.datasetId) return undefined
    return subscribeToBroadcast(event => {
      if (event.sourceId === clientId) return
      if (event.type === 'dataset-update' && event.datasetId === state.datasetId) {
        refreshDataset()
      }
    })
  }, [clientId, refreshDataset, state.datasetId])

  const updateRecordIntermarc = useCallback(
    (recordId: string, intermarc: Intermarc) => {
      const updates: UpdatePayload[] = []
      setState(prev => {
        if (!prev.curated) return prev
        const pristineRecords = new Map(prev.pristineRecords)
        snapshotRecord(prev.curated, recordId, pristineRecords)

        const curated = updateRecordIntermarcInDataset(prev.curated, recordId, intermarc)
        const updatedRecord = curated.records.find(r => r.id === recordId)
        if (updatedRecord) {
          updates.push({ id: updatedRecord.id, type: updatedRecord.type, intermarc: updatedRecord.intermarcStr })
          registerArkLabelForRecord(updatedRecord)
        }
        const clusters = detectClusters(curated.records, buildArkIndex(curated.records))
        return { ...prev, curated, clusters, pristineRecords }
      })
      const datasetId = datasetIdRef.current
      if (datasetId && updates.length) {
        updates.forEach(payload => {
          syncRecordUpdate(datasetId, payload).catch(err => {
            console.error('Failed to synchronise record', err)
            showToast('Synchronisation avec la base impossible.', { tone: 'error' })
          })
        })
        postBroadcastEvent({
          type: 'dataset-update',
          datasetId,
          recordIds: updates.map(update => update.id),
        })
      }
    },
    [showToast],
  )

  const getCuratedBaselineRecord = useCallback(
    (recordId: string) => {
      return state.pristineRecords.get(recordId) ?? null
    },
    [state.pristineRecords],
  )

  const setWorkAccepted = useCallback(
    (clusterId: string, workArk: string, accepted: boolean) => {
      const updates: UpdatePayload[] = []
      setState(prev => {
        if (!prev.curated) return prev
        const cluster = prev.clusters.find(c => c.anchorId === clusterId)
        if (!cluster) return prev
        const anchorRecord = prev.curated.records.find(r => r.id === cluster.anchorId)
        if (!anchorRecord) return prev

        const today = new Date().toISOString().slice(0, 10)
        const nextItems = cluster.items
          .filter(entry => (accepted ? true : entry.ark !== workArk))
          .map(entry => ({
            ...entry,
            accepted: true,
            date: entry.origin === 'script' ? entry.date ?? today : entry.date,
          }))

        const pristineRecords = new Map(prev.pristineRecords)
        snapshotRecord(prev.curated, cluster.anchorId, pristineRecords)

        const updatedIntermarc = rebuildWorkCluster90FEntries(anchorRecord.intermarc, nextItems, { defaultDate: today })
        const curated = updateRecordIntermarcInDataset(prev.curated, anchorRecord.id, updatedIntermarc)
        const clusters = detectClusters(curated.records, buildArkIndex(curated.records))
        const updatedRecord = curated.records.find(r => r.id === anchorRecord.id)
        if (updatedRecord) {
          updates.push({ id: updatedRecord.id, type: updatedRecord.type, intermarc: updatedRecord.intermarcStr })
          registerArkLabelForRecord(updatedRecord)
        }

        return { ...prev, clusters, curated, pristineRecords }
      })
      const datasetId = datasetIdRef.current
      if (datasetId && updates.length) {
        updates.forEach(payload => {
          syncRecordUpdate(datasetId, payload).catch(err => {
            console.error('Failed to synchronise record', err)
            showToast('Synchronisation avec la base impossible.', { tone: 'error' })
          })
        })
      }
    },
    [showToast],
  )

  const setExpressionAccepted = useCallback(
    (clusterId: string, anchorExpressionId: string, expressionArk: string, accepted: boolean) => {
      const updates: UpdatePayload[] = []
      setState(prev => {
        if (!prev.curated) return prev
        const cluster = prev.clusters.find(c => c.anchorId === clusterId)
        if (!cluster) return prev
        const group = cluster.expressionGroups.find(g => g.anchor.id === anchorExpressionId)
        if (!group) return prev

        const pristineRecords = new Map(prev.pristineRecords)
        snapshotRecord(prev.curated, anchorExpressionId, pristineRecords)

        const today = new Date().toISOString().slice(0, 10)
        const nextClustered = group.clustered
          .filter(expr => (accepted ? true : expr.ark !== expressionArk))
          .map(expr => ({
            ...expr,
            accepted: true,
            date: expr.origin === 'script' ? expr.date ?? today : expr.date,
          }))

        const curated = updateExpressionClusterIntermarc(
          {
            ...cluster,
            expressionGroups: cluster.expressionGroups.map(g =>
              g.anchor.id === anchorExpressionId ? { ...g, clustered: nextClustered } : g,
            ),
          },
          anchorExpressionId,
          prev.curated,
        )
        const anchorRecord = curated.records.find(r => r.id === anchorExpressionId)
        if (anchorRecord) {
          updates.push({ id: anchorRecord.id, type: anchorRecord.type, intermarc: anchorRecord.intermarcStr })
          registerArkLabelForRecord(anchorRecord)
        }

        const clusters = detectClusters(curated.records, buildArkIndex(curated.records))
        return { ...prev, clusters, curated, pristineRecords }
      })
      const datasetId = datasetIdRef.current
      if (datasetId && updates.length) {
        updates.forEach(payload => {
          syncRecordUpdate(datasetId, payload).catch(err => {
            console.error('Failed to synchronise record', err)
            showToast('Synchronisation avec la base impossible.', { tone: 'error' })
          })
        })
      }
    },
    [showToast],
  )

  const moveManifestation = useCallback(
    (
      clusterId: string,
      manifestationId: string,
      target: { anchorExpressionId: string | null; expressionId?: string; expressionArk: string },
    ) => {
      const updates: UpdatePayload[] = []
      setState(prev => {
        if (!prev.curated) return prev
        const clusterIndex = prev.clusters.findIndex(c => c.anchorId === clusterId)
        if (clusterIndex === -1) return prev
        const targetCluster = cloneCluster(prev.clusters[clusterIndex])
        const detachResult = detachManifestationFromCluster(targetCluster, manifestationId)
        if (!detachResult) return prev
        if (detachResult.previousExpressionArk === target.expressionArk) return prev
        const attached = attachManifestationToCluster(targetCluster, target, detachResult.item)
        if (!attached) return prev

        const pristineRecords = new Map(prev.pristineRecords)
        snapshotRecord(prev.curated, manifestationId, pristineRecords)
        if (detachResult.anchorExpressionId) snapshotRecord(prev.curated, detachResult.anchorExpressionId, pristineRecords)
        snapshotRecord(prev.curated, target.anchorExpressionId, pristineRecords)

        let curated = updateManifestationParentInDataset(
          prev.curated,
          manifestationId,
          detachResult.previousExpressionArk,
          target.expressionArk,
          target.expressionId,
        )
        const manifestationRecord = curated.records.find(r => r.id === manifestationId)
        if (manifestationRecord) {
          updates.push({ id: manifestationRecord.id, type: manifestationRecord.type, intermarc: manifestationRecord.intermarcStr })
          registerArkLabelForRecord(manifestationRecord)
        }
        if (detachResult.anchorExpressionId) {
          curated = updateExpressionClusterIntermarc(targetCluster, detachResult.anchorExpressionId, curated)
          const expressionRecord = curated.records.find(r => r.id === detachResult.anchorExpressionId)
          if (expressionRecord) {
            updates.push({ id: expressionRecord.id, type: expressionRecord.type, intermarc: expressionRecord.intermarcStr })
            registerArkLabelForRecord(expressionRecord)
          }
        }
        if (target.anchorExpressionId) {
          curated = updateExpressionClusterIntermarc(targetCluster, target.anchorExpressionId, curated)
          const expressionRecord = curated.records.find(r => r.id === target.anchorExpressionId)
          if (expressionRecord) {
            updates.push({ id: expressionRecord.id, type: expressionRecord.type, intermarc: expressionRecord.intermarcStr })
            registerArkLabelForRecord(expressionRecord)
          }
        }

        const clusters = prev.clusters.slice()
        clusters[clusterIndex] = targetCluster
        return { ...prev, clusters, curated, pristineRecords }
      })
      const datasetId = datasetIdRef.current
      if (datasetId && updates.length) {
        updates.forEach(payload => {
          syncRecordUpdate(datasetId, payload).catch(err => {
            console.error('Failed to synchroniser record', err)
            showToast('Synchronisation avec la base impossible.', { tone: 'error' })
          })
        })
      }
    },
    [showToast],
  )

  const exportCurated = useCallback(async () => {
    if (!state.curated) {
      showToast('Aucune base chargée.', { tone: 'info' })
      return
    }
    try {
      const csvText = stringifyCsv({ headers: state.curated.csv.headers, rows: state.curated.csv.rows.slice(1) })
      const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' })
      const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').split('.')[0]
      const fileName = `vendange_export_${timestamp}.csv`
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Failed to export dataset CSV', error)
      showToast('Impossible d\'exporter le CSV.', { tone: 'error' })
    }
  }, [showToast, state.curated])

  const clearData = useCallback(() => {
    resetArkLabelCache()
    setState(() => ({ ...INITIAL_STATE, pristineRecords: new Map() }))
  }, [])

  const value = useMemo<AppDataContextValue>(
    () => ({
      ...state,
      loadDataset,
      refreshDataset,
      updateRecordIntermarc,
      getCuratedBaselineRecord,
      setWorkAccepted,
      setExpressionAccepted,
      moveManifestation,
      exportCurated,
      clearData,
    }),
    [
      state,
      loadDataset,
      refreshDataset,
      updateRecordIntermarc,
      getCuratedBaselineRecord,
      setWorkAccepted,
      setExpressionAccepted,
      moveManifestation,
      exportCurated,
      clearData,
    ],
  )

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}

// --- Helpers ----------------------------------------------------------------

function buildDataSetFromRecords(records: DatasetRecordPayload[]): DataSet {
  const headers = ['id_entitelrm', 'type_entite', 'intermarc']
  const rows: string[][] = [headers]
  const recordRows: RecordRow[] = records.map((record, index) => {
    const intermarcStr = String(record.intermarc ?? '')
    const intermarc = parseIntermarc(intermarcStr)
    const row = [record.id, record.type, intermarcStr]
    rows.push(row)
    const ark = record.ark ?? findArkInIntermarc(intermarc)
    return {
      id: record.id,
      type: record.type,
      typeNorm: normalizeType(record.type),
      rowIndex: index + 1,
      intermarcStr,
      intermarc,
      ark: ark ?? undefined,
      raw: row,
    }
  })
  return {
    csv: { headers, rows },
    records: recordRows,
    intermarcIndex: 2,
  }
}

function findArkInIntermarc(intermarc: Intermarc): string | null {
  const zone = findZones(intermarc, '001')[0]
  const ark = zone?.sousZones.find(sz => sz.code === '001$a')?.valeur
  return ark ?? null
}

function updateRecordIntermarcInDataset(dataset: DataSet, recordId: string, intermarc: Intermarc): DataSet {
  const recordIdx = dataset.records.findIndex(r => r.id === recordId)
  if (recordIdx === -1) return dataset
  const record = dataset.records[recordIdx]
  const intermarcStr = JSON.stringify(intermarc)

  const updatedRaw = record.raw.slice()
  if (dataset.intermarcIndex >= 0 && dataset.intermarcIndex < updatedRaw.length) {
    updatedRaw[dataset.intermarcIndex] = intermarcStr
  }

  const updatedRecord: RecordRow = {
    ...record,
    intermarc,
    intermarcStr,
    raw: updatedRaw,
  }

  const updatedRecords = dataset.records.slice()
  updatedRecords[recordIdx] = updatedRecord

  const updatedRows = dataset.csv.rows.slice()
  const targetRow = dataset.csv.rows[record.rowIndex]
  if (targetRow) {
    const updatedRow = targetRow.slice()
    if (dataset.intermarcIndex >= 0 && dataset.intermarcIndex < updatedRow.length) {
      updatedRow[dataset.intermarcIndex] = intermarcStr
    }
    updatedRows[record.rowIndex] = updatedRow
  }

  return {
    ...dataset,
    csv: { headers: dataset.csv.headers.slice(), rows: updatedRows },
    records: updatedRecords,
  }
}

function cloneRecordRow(record: RecordRow): RecordRow {
  return {
    ...record,
    raw: record.raw.slice(),
    intermarc: cloneIntermarc(record.intermarc),
  }
}

function snapshotRecord(dataset: DataSet | null, recordId: string | undefined | null, target: Map<string, RecordRow>) {
  if (!dataset || !recordId) return
  if (target.has(recordId)) return
  const record = dataset.records.find(r => r.id === recordId)
  if (record) {
    target.set(recordId, cloneRecordRow(record))
  }
}

function cloneManifestations(items: ManifestationItem[]): ManifestationItem[] {
  return items.map(item => ({ ...item }))
}

function cloneExpression(expression: ExpressionItem | ExpressionClusterItem): ExpressionItem | ExpressionClusterItem {
  return {
    ...expression,
    manifestations: cloneManifestations(expression.manifestations),
  }
}

function cloneCluster(cluster: Cluster): Cluster {
  return {
    ...cluster,
    items: cluster.items.map(item => ({ ...item })),
    expressionGroups: cluster.expressionGroups.map(group => ({
      anchor: cloneExpression(group.anchor) as ExpressionItem,
      clustered: group.clustered.map(expr => cloneExpression(expr) as ExpressionClusterItem),
    })),
    independentExpressions: cluster.independentExpressions.map(expr => cloneExpression(expr) as ExpressionItem),
  }
}

function detachManifestationFromCluster(
  cluster: Cluster,
  manifestationId: string,
): { item: ManifestationItem; previousExpressionArk: string; anchorExpressionId: string | null } | null {
  for (const group of cluster.expressionGroups) {
    const anchorIdx = group.anchor.manifestations.findIndex(m => m.id === manifestationId)
    if (anchorIdx !== -1) {
      const [item] = group.anchor.manifestations.splice(anchorIdx, 1)
      return { item, previousExpressionArk: group.anchor.ark ?? '', anchorExpressionId: group.anchor.id }
    }
    for (const expr of group.clustered) {
      const idx = expr.manifestations.findIndex(m => m.id === manifestationId)
      if (idx !== -1) {
        const [item] = expr.manifestations.splice(idx, 1)
        return { item, previousExpressionArk: expr.ark ?? '', anchorExpressionId: group.anchor.id }
      }
    }
  }
  for (const expr of cluster.independentExpressions) {
    const idx = expr.manifestations.findIndex(m => m.id === manifestationId)
    if (idx !== -1) {
      const [item] = expr.manifestations.splice(idx, 1)
      return { item, previousExpressionArk: expr.ark ?? '', anchorExpressionId: null }
    }
  }
  return null
}

function attachManifestationToCluster(
  cluster: Cluster,
  target: { anchorExpressionId: string | null; expressionArk: string },
  item: ManifestationItem,
): boolean {
  if (target.anchorExpressionId) {
    const group = cluster.expressionGroups.find(g => g.anchor.id === target.anchorExpressionId)
    if (!group) return false
    if (group.anchor.ark === target.expressionArk) {
      group.anchor.manifestations.push(item)
      return true
    }
    const expression = group.clustered.find(expr => expr.ark === target.expressionArk)
    if (!expression) return false
    expression.manifestations.push(item)
    return true
  }
  const expression = cluster.independentExpressions.find(expr => expr.ark === target.expressionArk)
  if (!expression) return false
  expression.manifestations.push(item)
  return true
}

function updateManifestationParentInDataset(
  dataset: DataSet,
  manifestationId: string,
  previousExpressionArk: string,
  newExpressionArk: string,
  newExpressionId?: string,
): DataSet {
  if (!newExpressionArk || previousExpressionArk === newExpressionArk) return dataset
  const record = dataset.records.find(r => r.id === manifestationId)
  if (!record) return dataset
  const cloned = cloneIntermarc(record.intermarc)
  let updated = false
  for (const zone of cloned.zones) {
    if (zone.code !== '740') continue
    for (const sub of zone.sousZones) {
      if (sub.code === '740$3' && sub.valeur === previousExpressionArk) {
        sub.valeur = newExpressionArk
        sub.affectedByCuration = 'modified'
        zone.affectedByCuration = 'modified'
        updated = true
      }
    }
  }
  if (!updated) {
    const zone = cloned.zones.find(z => z.code === '740')
    const targetSub = zone?.sousZones.find(sz => sz.code === '740$3')
    if (targetSub) {
      targetSub.valeur = newExpressionArk
      targetSub.affectedByCuration = 'modified'
      if (zone) zone.affectedByCuration = 'modified'
      updated = true
    }
  }
  if (!updated) {
    cloned.zones.push({
      code: '740',
      affectedByCuration: 'modified',
      sousZones: [{ code: '740$3', valeur: newExpressionArk, affectedByCuration: 'modified' }],
    })
    updated = true
  }
  if (!updated) return dataset
  const next = updateRecordIntermarcInDataset(dataset, manifestationId, cloned)
  if (newExpressionId) {
    const updatedRecord = next.records.find(r => r.id === manifestationId)
    if (updatedRecord) {
      updatedRecord.raw = updatedRecord.raw.slice()
    }
  }
  return next
}

function updateExpressionClusterIntermarc(cluster: Cluster, anchorExpressionId: string, dataset: DataSet): DataSet {
  const record = dataset.records.find(r => r.id === anchorExpressionId)
  if (!record) return dataset
  const group = cluster.expressionGroups.find(g => g.anchor.id === anchorExpressionId)
  if (!group) return dataset
  const today = new Date().toISOString().slice(0, 10)
  const entries = group.clustered.map(entry => ({
    ark: entry.ark,
    date: entry.date ?? today,
    origin: entry.origin,
  }))
  const updatedIntermarc = rebuildExpressionCluster90FEntries(record.intermarc, entries, { defaultDate: today })
  return updateRecordIntermarcInDataset(dataset, record.id, updatedIntermarc)
}
