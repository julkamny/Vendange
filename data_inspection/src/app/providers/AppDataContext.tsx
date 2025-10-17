import { createContext, useContext, useMemo, useState, useCallback, type ReactNode } from 'react'
import type {
  CsvTable,
  RecordRow,
  Cluster,
  ExpressionClusterItem,
  ExpressionItem,
  ManifestationItem,
  ClusterItem,
  ExpressionAnchorGroup,
} from '../types'
import type { Intermarc } from '../lib/intermarc'
import { parseCsvText, indexRecords, findIntermarcColumnIndex } from '../core/records'
import { detectClusters, buildArkIndex } from '../core/clusters'
import { buildOriginalIndexes, type OriginalIndexes } from '../core/originalIndexes'
import { getCurrentLanguage } from '../i18n'
import { DEFAULT_CURATED_NAME, DEFAULT_ORIGINAL_CANDIDATES, CLUSTER_NOTE } from '../core/constants'
import { add90FEntries } from '../lib/intermarc'
import { cloneIntermarc } from '../core/intermarc-utils'
import {
  titleOf,
  expressionWorkArks,
  manifestationsForExpression,
  manifestationExpressionArks,
  findExpressionInCluster,
  manifestationTitle,
} from '../core/entities'

type DataSet = {
  csv: CsvTable
  records: RecordRow[]
  intermarcIndex: number
}

export type AppDataState = {
  original: DataSet | null
  curated: DataSet | null
  clusters: Cluster[]
  loadingDefaults: boolean
  originalIndexes: OriginalIndexes | null
}

type AppDataContextValue = AppDataState & {
  loadOriginal: (file: File) => Promise<void>
  loadCurated: (file: File) => Promise<void>
  loadDefaults: () => Promise<void>
  updateRecordIntermarc: (recordId: string, intermarc: Intermarc) => void
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
  addWorkToCluster: (clusterId: string, workArk: string) => void
  addExpressionToCluster: (payload: AddExpressionPayload) => void
  exportCurated: () => Promise<void>
  clearData: () => void
}

type AddExpressionPayload = {
  clusterId: string
  anchorExpressionId: string
  expressionArk: string
  allowExternal?: boolean
  manifestation?: { id: string; keepOriginalLink: boolean }
}

const AppDataContext = createContext<AppDataContextValue | null>(null)

export function useAppData() {
  const ctx = useContext(AppDataContext)
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider')
  return ctx
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppDataState>({
    original: null,
    curated: null,
    clusters: [],
    loadingDefaults: false,
    originalIndexes: null,
  })

  const loadOriginal = useCallback(
    async (file: File) => {
      const text = await readFileAsText(file)
      const csv = parseCsvText(text)
      const records = indexRecords(csv)
      setState(prev => {
        const original = { csv, records, intermarcIndex: findIntermarcColumnIndex(csv) }
        const originalIndexes = buildOriginalIndexes(records, getCurrentLanguage())
        const clusters = prev.curated ? detectClusters(prev.curated.records, buildArkIndex(records)) : []
        return { ...prev, original, clusters, originalIndexes }
      })
    },
    [],
  )

  const loadCurated = useCallback(
    async (file: File) => {
      const text = await readFileAsText(file)
      const csv = parseCsvText(text)
      const records = indexRecords(csv)
      setState(prev => {
        const curated = { csv, records, intermarcIndex: findIntermarcColumnIndex(csv) }
        const clusters = prev.original ? detectClusters(records, buildArkIndex(prev.original.records)) : []
        return { ...prev, curated, clusters }
      })
    },
    [],
  )

  const loadDefaults = useCallback(async () => {
    setState(prev => ({ ...prev, loadingDefaults: true }))
    try {
      let curated: DataSet | null = null
      try {
        const resp = await fetch(`/data/${DEFAULT_CURATED_NAME}`)
          if (resp.ok) {
            const text = await resp.text()
            const csv = parseCsvText(text)
            const records = indexRecords(csv)
            curated = { csv, records, intermarcIndex: findIntermarcColumnIndex(csv) }
          }
      } catch (error) {
        console.error('Failed to load curated defaults', error)
      }

      let original: DataSet | null = null
      for (const candidate of DEFAULT_ORIGINAL_CANDIDATES) {
        try {
          const resp = await fetch(`/data/${candidate}`)
          if (!resp.ok) continue
          const text = await resp.text()
          const csv = parseCsvText(text)
          const records = indexRecords(csv)
          original = { csv, records, intermarcIndex: findIntermarcColumnIndex(csv) }
          break
        } catch (error) {
          console.error(`Failed to load original defaults (${candidate})`, error)
        }
      }

      setState(prev => {
        const nextOriginal = original ?? prev.original
        const nextCurated = curated ?? prev.curated
        const originalIndexes = nextOriginal
          ? buildOriginalIndexes(nextOriginal.records, getCurrentLanguage())
          : prev.originalIndexes
        const clusters = nextOriginal && nextCurated
          ? detectClusters(nextCurated.records, buildArkIndex(nextOriginal.records))
          : []
        return {
          ...prev,
          original: nextOriginal,
          curated: nextCurated,
          clusters,
          originalIndexes,
          loadingDefaults: false,
        }
      })
    } catch (error) {
      console.error('Failed to load default data', error)
      setState(prev => ({ ...prev, loadingDefaults: false }))
    }
  }, [])

  const updateRecordIntermarc = useCallback((recordId: string, intermarc: Intermarc) => {
    setState(prev => {
      if (!prev.curated) return prev
      const nextCurated = updateRecordIntermarcInDataset(prev.curated, recordId, intermarc)
      if (nextCurated === prev.curated) return prev
      const nextClusters =
        prev.original && prev.original.records.length > 0
          ? detectClusters(nextCurated.records, buildArkIndex(prev.original.records))
          : prev.clusters
      return { ...prev, curated: nextCurated, clusters: nextClusters }
    })
  }, [])

  const exportCurated = useCallback(async () => {
    console.warn('exportCurated not yet implemented')
  }, [])

  const setWorkAccepted = useCallback((clusterId: string, workArk: string, accepted: boolean) => {
    setState(prev => {
      if (!prev.curated) return prev
      const clusterIndex = prev.clusters.findIndex(c => c.anchorId === clusterId)
      if (clusterIndex === -1) return prev
      const targetCluster = cloneCluster(prev.clusters[clusterIndex])
      const item = targetCluster.items.find(entry => entry.ark === workArk)
      if (!item) return prev

      const today = new Date().toISOString().slice(0, 10)
      item.accepted = accepted
      if (accepted && !item.date) item.date = today

      const affectedAnchors = new Set<string>()
      if (!accepted) {
        for (const group of targetCluster.expressionGroups) {
          for (const expr of group.clustered) {
            if (expr.workArk === workArk && expr.accepted) {
              expr.accepted = false
              expr.date = undefined
              affectedAnchors.add(group.anchor.id)
            }
          }
        }
      }

      let curated = updateWorkClusterIntermarc(targetCluster, prev.curated)
      for (const anchorId of affectedAnchors) {
        curated = updateExpressionClusterIntermarc(targetCluster, anchorId, curated)
      }

      const clusters = prev.clusters.slice()
      clusters[clusterIndex] = targetCluster
      return { ...prev, clusters, curated }
    })
  }, [])

  const setExpressionAccepted = useCallback(
    (clusterId: string, anchorExpressionId: string, expressionArk: string, accepted: boolean) => {
      setState(prev => {
        if (!prev.curated) return prev
        const clusterIndex = prev.clusters.findIndex(c => c.anchorId === clusterId)
        if (clusterIndex === -1) return prev
        const targetCluster = cloneCluster(prev.clusters[clusterIndex])
        const group = targetCluster.expressionGroups.find(g => g.anchor.id === anchorExpressionId)
        if (!group) return prev
        const expression = group.clustered.find(expr => expr.ark === expressionArk)
        if (!expression) return prev
        const today = new Date().toISOString().slice(0, 10)
        expression.accepted = accepted
        expression.date = accepted ? expression.date ?? today : undefined
        let curated = updateExpressionClusterIntermarc(targetCluster, anchorExpressionId, prev.curated)
        const clusters = prev.clusters.slice()
        clusters[clusterIndex] = targetCluster
        return { ...prev, clusters, curated }
      })
    },
    [],
  )

  const moveManifestation = useCallback(
    (
      clusterId: string,
      manifestationId: string,
      target: { anchorExpressionId: string | null; expressionId?: string; expressionArk: string },
    ) => {
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
        let curated = updateManifestationParentInDataset(
          prev.curated,
          manifestationId,
          detachResult.previousExpressionArk,
          target.expressionArk,
          target.expressionId,
        )
        detachResult.item.expressionArk = target.expressionArk
        detachResult.item.expressionId = target.expressionId
        const clusters = prev.clusters.slice()
        clusters[clusterIndex] = targetCluster
        return { ...prev, clusters, curated }
      })
    },
    [],
  )

  const addWorkToCluster = useCallback(
    (clusterId: string, workArk: string) => {
      setState(prev => {
        if (!prev.curated) return prev
        const normalizedArk = workArk.trim()
        if (!normalizedArk) return prev
        const clusterIndex = prev.clusters.findIndex(c => c.anchorId === clusterId)
        if (clusterIndex === -1) return prev
        const targetCluster = cloneCluster(prev.clusters[clusterIndex])
        if (targetCluster.anchorArk === normalizedArk) return prev
        if (targetCluster.items.some(item => item.ark === normalizedArk)) return prev

        const indexes = buildDatasetIndexes(prev.curated.records, prev.original?.records ?? null)
        const workRecord = indexes.worksByArk.get(normalizedArk)
        if (!workRecord) return prev

        const today = new Date().toISOString().slice(0, 10)
        targetCluster.items.push(createClusterItemFromRecord(workRecord, today))

        let nextCurated = prev.curated
        const updatedClusters = prev.clusters.slice()
        const removedExpressionAnchors = new Set<string>()

        const sourceIndex = prev.clusters.findIndex(
          (cluster, index) => index !== clusterIndex && cluster.items.some(item => item.ark === normalizedArk),
        )
        if (sourceIndex !== -1) {
          const sourceCluster = cloneCluster(prev.clusters[sourceIndex])
          sourceCluster.items = sourceCluster.items.filter(item => item.ark !== normalizedArk)
          sourceCluster.independentExpressions = sourceCluster.independentExpressions.filter(
            expr => expr.workArk !== normalizedArk,
          )
          for (const group of sourceCluster.expressionGroups) {
            const before = group.clustered.length
            group.clustered = group.clustered.filter(expr => expr.workArk !== normalizedArk)
            if (group.clustered.length !== before) removedExpressionAnchors.add(group.anchor.id)
          }
          nextCurated = updateWorkClusterIntermarc(sourceCluster, nextCurated)
          removedExpressionAnchors.forEach(anchorId => {
            nextCurated = updateExpressionClusterIntermarc(sourceCluster, anchorId, nextCurated)
          })
          updatedClusters[sourceIndex] = sourceCluster
        }

        const expressionRecords = indexes.expressionsByWorkArk.get(normalizedArk) ?? []
        for (const exprRecord of expressionRecords) {
          const expressionArk = exprRecord.ark || exprRecord.id
          if (findExpressionInCluster(targetCluster, exprRecord.id, expressionArk)) continue
          targetCluster.independentExpressions.push(
            createExpressionItemFromRecord(exprRecord, normalizedArk, indexes),
          )
        }

        nextCurated = updateWorkClusterIntermarc(targetCluster, nextCurated)
        updatedClusters[clusterIndex] = targetCluster
        return { ...prev, curated: nextCurated, clusters: updatedClusters }
      })
    },
    [],
  )

  const addExpressionToCluster = useCallback(
    ({ clusterId, anchorExpressionId, expressionArk, allowExternal, manifestation }: AddExpressionPayload) => {
      setState(prev => {
        if (!prev.curated) return prev
        const targetArk = expressionArk.trim()
        if (!targetArk) return prev
        const clusterIndex = prev.clusters.findIndex(c => c.anchorId === clusterId)
        if (clusterIndex === -1) return prev
        const targetCluster = cloneCluster(prev.clusters[clusterIndex])
        const indexes = buildDatasetIndexes(prev.curated.records, prev.original?.records ?? null)
        const expressionRecord =
          indexes.expressionsByArk.get(targetArk) || indexes.expressionsById.get(targetArk)
        if (!expressionRecord) return prev

        if (findExpressionInCluster(targetCluster, expressionRecord.id, expressionRecord.ark)) return prev

        const workCandidates = expressionWorkArks(expressionRecord)
        const clusterWorkArks = collectClusterWorkArks(targetCluster)
        if (!allowExternal && workCandidates.length && !workCandidates.some(ark => clusterWorkArks.has(ark))) {
          return prev
        }

        const today = new Date().toISOString().slice(0, 10)
        const expressionItem = createExpressionClusterItem(expressionRecord, anchorExpressionId, indexes, today)

        const updatedClusters = prev.clusters.slice()
        let nextCurated = prev.curated

        if (allowExternal) {
          prev.clusters.forEach((clusterEntry, clusterIdx) => {
            if (clusterIdx === clusterIndex) return
            const clone = cloneCluster(clusterEntry)
            const removal = removeExpressionFromCluster(clone, expressionRecord.id, expressionRecord.ark)
            if (removal.removed) {
              updatedClusters[clusterIdx] = clone
              removal.anchorIds.forEach(anchorId => {
                nextCurated = updateExpressionClusterIntermarc(clone, anchorId, nextCurated)
              })
            }
          })
        }

        const removalResult = removeExpressionFromCluster(targetCluster, expressionRecord.id, expressionRecord.ark)

        let group = targetCluster.expressionGroups.find(g => g.anchor.id === anchorExpressionId) || null
        if (!group) {
          group = ensureGroupForAnchor(targetCluster, anchorExpressionId)
        }
        if (!group) return prev

        const anchorExpression = group.anchor
        const anchorExpressionArk = anchorExpression.ark

        removalResult.anchorIds.forEach(anchorId => {
          nextCurated = updateExpressionClusterIntermarc(targetCluster, anchorId, nextCurated)
        })

        group.clustered = group.clustered.filter(expr => expr.ark !== expressionItem.ark)
        group.clustered.push(expressionItem)
        nextCurated = updateExpressionClusterIntermarc(targetCluster, anchorExpressionId, nextCurated)

        if (manifestation && anchorExpressionArk) {
          const manifestationId = manifestation.id
          const anchorManifestations = group.anchor.manifestations
          const manifestationEntry = anchorManifestations.find(item => item.id === manifestationId)
          if (manifestationEntry) {
            nextCurated = updateManifestationParentInDataset(
              nextCurated,
              manifestationId,
              anchorExpressionArk,
              expressionItem.ark,
              expressionItem.id,
              manifestation.keepOriginalLink,
            )
            if (!manifestation.keepOriginalLink) {
              group.anchor.manifestations = anchorManifestations.filter(item => item.id !== manifestationId)
            }
            const targetExpression = findExpressionInCluster(
              targetCluster,
              expressionRecord.id,
              expressionItem.ark,
            )
            if (targetExpression) {
              const alreadyLinked = targetExpression.manifestations.some(item => item.id === manifestationId)
              if (!alreadyLinked) {
                const manifestationRecord = indexes.manifestationsById.get(manifestationId)
                if (manifestationRecord) {
                  targetExpression.manifestations.push({
                    id: manifestationRecord.id,
                    ark: manifestationRecord.ark || manifestationRecord.id,
                    title: manifestationTitle(manifestationRecord) || manifestationRecord.id,
                    expressionArk: expressionItem.ark,
                    expressionId: expressionItem.id,
                    originalExpressionArk: manifestationEntry.originalExpressionArk,
                  })
                } else {
                  targetExpression.manifestations.push({
                    ...manifestationEntry,
                    expressionArk: expressionItem.ark,
                    expressionId: expressionItem.id,
                  })
                }
              }
            }
          }
        }

        updatedClusters[clusterIndex] = targetCluster
        return { ...prev, curated: nextCurated, clusters: updatedClusters }
      })
    },
    [],
  )

  const clearData = useCallback(() => {
    setState(prev => ({ ...prev, original: null, curated: null, clusters: [], originalIndexes: null }))
  }, [])

  const value = useMemo(
    () => ({
      ...state,
      loadOriginal,
      loadCurated,
      loadDefaults,
      updateRecordIntermarc,
      setWorkAccepted,
      setExpressionAccepted,
      moveManifestation,
      addWorkToCluster,
      addExpressionToCluster,
      exportCurated,
      clearData,
    }),
    [
      state,
      loadOriginal,
      loadCurated,
      loadDefaults,
      updateRecordIntermarc,
      setWorkAccepted,
      setExpressionAccepted,
      moveManifestation,
      addWorkToCluster,
      addExpressionToCluster,
      exportCurated,
      clearData,
    ],
  )

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file, 'utf-8')
  })
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
  keepOriginalLink = false,
): DataSet {
  if (!newExpressionArk || previousExpressionArk === newExpressionArk) return dataset
  const record = dataset.records.find(r => r.id === manifestationId)
  if (!record) return dataset
  const cloned = cloneIntermarc(record.intermarc)
  let updated = false
  for (const zone of cloned.zones) {
    if (zone.code !== '740') continue
    if (keepOriginalLink) {
      const exists = zone.sousZones.some(sz => sz.code === '740$3' && sz.valeur === newExpressionArk)
      if (!exists) {
        zone.sousZones.push({ code: '740$3', valeur: newExpressionArk })
        updated = true
      }
      continue
    }
    for (const sub of zone.sousZones) {
      if (sub.code === '740$3' && sub.valeur === previousExpressionArk) {
        sub.valeur = newExpressionArk
        updated = true
      }
    }
  }
  if (!updated) {
    if (keepOriginalLink) {
      cloned.zones.push({ code: '740', sousZones: [{ code: '740$3', valeur: newExpressionArk }] })
      updated = true
    } else {
      const zone = cloned.zones.find(z => z.code === '740')
      const target = zone?.sousZones.find(sz => sz.code === '740$3')
      if (target) {
        target.valeur = newExpressionArk
        updated = true
      } else {
        cloned.zones.push({ code: '740', sousZones: [{ code: '740$3', valeur: newExpressionArk }] })
        updated = true
      }
    }
  }
  if (!keepOriginalLink) {
    for (const zone of cloned.zones) {
      if (zone.code !== '740') continue
      zone.sousZones = zone.sousZones.filter(
        sub => !(sub.code === '740$3' && sub.valeur === previousExpressionArk && sub.valeur !== newExpressionArk),
      )
    }
    for (let i = cloned.zones.length - 1; i >= 0; i -= 1) {
      const zone = cloned.zones[i]
      if (zone.code === '740' && zone.sousZones.length === 0) cloned.zones.splice(i, 1)
    }
  }
  if (!updated) return dataset
  let next = updateRecordIntermarcInDataset(dataset, manifestationId, cloned)
  if (newExpressionId) {
    const nextRecord = next.records.find(r => r.id === manifestationId)
    if (nextRecord) {
      nextRecord.raw = nextRecord.raw.slice()
    }
  }
  return next
}

type DatasetIndexes = {
  worksByArk: Map<string, RecordRow>
  worksById: Map<string, RecordRow>
  expressionsByArk: Map<string, RecordRow>
  expressionsById: Map<string, RecordRow>
  expressionsByWorkArk: Map<string, RecordRow[]>
  manifestationsByExpressionArk: Map<string, RecordRow[]>
  manifestationsById: Map<string, RecordRow>
}

function buildDatasetIndexes(curated: RecordRow[] | null, original: RecordRow[] | null): DatasetIndexes {
  const worksByArk = new Map<string, RecordRow>()
  const worksById = new Map<string, RecordRow>()
  const expressionsByArk = new Map<string, RecordRow>()
  const expressionsById = new Map<string, RecordRow>()
  const expressionsByWorkArk = new Map<string, RecordRow[]>()
  const manifestationsByExpressionArk = new Map<string, RecordRow[]>()
  const manifestationsById = new Map<string, RecordRow>()

  const addRecords = (records: RecordRow[] | null | undefined, preferExisting = true) => {
    if (!records) return
    for (const rec of records) {
      if (rec.typeNorm === 'oeuvre') {
        if (!worksById.has(rec.id) || !preferExisting) worksById.set(rec.id, rec)
        if (rec.ark && (!worksByArk.has(rec.ark) || !preferExisting)) worksByArk.set(rec.ark, rec)
        continue
      }
      if (rec.typeNorm === 'expression') {
        if (!expressionsById.has(rec.id) || !preferExisting) expressionsById.set(rec.id, rec)
        if (rec.ark && (!expressionsByArk.has(rec.ark) || !preferExisting)) expressionsByArk.set(rec.ark, rec)
        const workArks = expressionWorkArks(rec)
        for (const workArk of workArks) {
          if (!expressionsByWorkArk.has(workArk)) expressionsByWorkArk.set(workArk, [])
          const list = expressionsByWorkArk.get(workArk)!
          if (!list.some(existing => existing.id === rec.id)) list.push(rec)
        }
        continue
      }
      if (rec.typeNorm === 'manifestation') {
        manifestationsById.set(rec.id, rec)
        const exprArks = manifestationExpressionArks(rec)
        for (const exprArk of exprArks) {
          if (!manifestationsByExpressionArk.has(exprArk)) manifestationsByExpressionArk.set(exprArk, [])
          const list = manifestationsByExpressionArk.get(exprArk)!
          if (!list.some(existing => existing.id === rec.id)) list.push(rec)
        }
      }
    }
  }

  addRecords(original ?? null, false)
  addRecords(curated ?? null, true)

  return {
    worksByArk,
    worksById,
    expressionsByArk,
    expressionsById,
    expressionsByWorkArk,
    manifestationsByExpressionArk,
    manifestationsById,
  }
}

function createClusterItemFromRecord(record: RecordRow, date?: string): ClusterItem {
  return {
    ark: record.ark || record.id,
    id: record.id,
    title: titleOf(record) || record.id,
    accepted: true,
    date,
  }
}

function createExpressionItemFromRecord(
  record: RecordRow,
  workArk: string,
  indexes: DatasetIndexes,
): ExpressionItem {
  const expressionArk = record.ark || record.id
  const manifestations = expressionArk
    ? manifestationsForExpression(expressionArk, indexes.manifestationsByExpressionArk, indexes.expressionsByArk)
    : []
  const workRecord = indexes.worksByArk.get(workArk)
  return {
    id: record.id,
    ark: expressionArk,
    title: titleOf(record) || record.id,
    workArk,
    workId: workRecord?.id,
    manifestations,
  }
}

function createExpressionClusterItem(
  record: RecordRow,
  anchorExpressionId: string,
  indexes: DatasetIndexes,
  date?: string,
): ExpressionClusterItem {
  const workArks = expressionWorkArks(record)
  const workArk = workArks[0] || ''
  const expressionArk = record.ark || record.id
  const manifestations = expressionArk
    ? manifestationsForExpression(expressionArk, indexes.manifestationsByExpressionArk, indexes.expressionsByArk)
    : []
  const workRecord = workArk ? indexes.worksByArk.get(workArk) : undefined
  return {
    id: record.id,
    ark: expressionArk,
    title: titleOf(record) || record.id,
    workArk,
    workId: workRecord?.id,
    anchorExpressionId,
    accepted: true,
    date,
    manifestations,
  }
}

function collectClusterWorkArks(cluster: Cluster): Set<string> {
  const set = new Set<string>()
  if (cluster.anchorArk) set.add(cluster.anchorArk)
  cluster.items.forEach(item => {
    if (item.ark) set.add(item.ark)
  })
  return set
}

function removeExpressionFromCluster(
  cluster: Cluster,
  expressionId?: string | null,
  expressionArk?: string | null,
): { removed: boolean; anchorIds: Set<string> } {
  const affected = new Set<string>()
  let removed = false
  for (const group of cluster.expressionGroups) {
    const before = group.clustered.length
    group.clustered = group.clustered.filter(expr => {
      const match = (expressionId && expr.id === expressionId) || (expressionArk && expr.ark === expressionArk)
      if (match) affected.add(group.anchor.id)
      return !match
    })
    if (group.clustered.length !== before) removed = true
  }
  const independentBefore = cluster.independentExpressions.length
  cluster.independentExpressions = cluster.independentExpressions.filter(expr => {
    const match = (expressionId && expr.id === expressionId) || (expressionArk && expr.ark === expressionArk)
    return !match
  })
  if (cluster.independentExpressions.length !== independentBefore) removed = true
  return { removed, anchorIds: affected }
}

function ensureGroupForAnchor(cluster: Cluster, anchorExpressionId: string): ExpressionAnchorGroup | null {
  const existing = cluster.expressionGroups.find(group => group.anchor.id === anchorExpressionId)
  if (existing) return existing
  const independent = cluster.independentExpressions.find(expr => expr.id === anchorExpressionId)
  if (!independent) return null
  cluster.independentExpressions = cluster.independentExpressions.filter(expr => expr.id !== anchorExpressionId)
  const group: ExpressionAnchorGroup = {
    anchor: independent,
    clustered: [],
  }
  cluster.expressionGroups.push(group)
  return group
}

function updateWorkClusterIntermarc(cluster: Cluster, dataset: DataSet): DataSet {
  const anchorRecord = dataset.records.find(r => r.id === cluster.anchorId)
  if (!anchorRecord) return dataset
  const today = new Date().toISOString().slice(0, 10)
  const entries = cluster.items
    .filter(entry => entry.accepted)
    .map(entry => ({ ark: entry.ark, date: entry.date ?? today, note: CLUSTER_NOTE }))
  const updatedIntermarc = add90FEntries(anchorRecord.intermarc, entries)
  return updateRecordIntermarcInDataset(dataset, anchorRecord.id, updatedIntermarc)
}

function updateExpressionClusterIntermarc(cluster: Cluster, anchorExpressionId: string, dataset: DataSet): DataSet {
  const record = dataset.records.find(r => r.id === anchorExpressionId)
  if (!record) return dataset
  const group = cluster.expressionGroups.find(g => g.anchor.id === anchorExpressionId)
  if (!group) return dataset
  const today = new Date().toISOString().slice(0, 10)
  const entries = group.clustered
    .filter(entry => entry.accepted)
    .map(entry => ({ ark: entry.ark, date: entry.date ?? today, note: CLUSTER_NOTE }))
  const updatedIntermarc = add90FEntries(record.intermarc, entries)
  return updateRecordIntermarcInDataset(dataset, record.id, updatedIntermarc)
}
