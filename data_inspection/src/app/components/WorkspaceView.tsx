import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import type { RecordRow } from '../types'
import type { WorkspaceTabState } from '../workspace/types'
import { useAppData } from '../providers/AppDataContext'
import { useTranslation } from '../hooks/useTranslation'
import { useWorkspaceData } from '../workspace/useWorkspaceData'
import { WorkListPanel } from '../workspace/components/WorkListPanel'
import { ExpressionPanel } from '../workspace/components/ExpressionPanel'
import { ManifestationPanel } from '../workspace/components/ManifestationPanel'
import { IntermarcView } from './IntermarcView'
import { IntermarcEditor } from './IntermarcEditor'
import { isWorkClustered, isExpressionClustered, isManifestationClustered } from '../core/clusterCoverage'
import { useArkDecoratedText } from '../hooks/useArkDecoratedText'
import { useRecordLookup } from '../hooks/useRecordLookup'
import { expressionWorkArks, manifestationTitle, titleOf } from '../core/entities'
import { configureTabStateForRecord } from '../workspace/tabState'

type WorkspaceViewProps = {
  state: WorkspaceTabState
  onStateChange: (updater: (prev: WorkspaceTabState) => WorkspaceTabState) => void
  onOpenTab: (initializer: (base: WorkspaceTabState) => WorkspaceTabState) => void
}

function findRecord(id: string, curated: RecordRow[], original: RecordRow[]): RecordRow | null {
  return curated.find(rec => rec.id === id) || original.find(rec => rec.id === id) || null
}

function deriveInternalIdFromArk(rawArk: string | null | undefined): string | null {
  if (!rawArk) return null
  const normalized = rawArk.trim()
  if (!normalized) return null
  const lower = normalized.toLowerCase()
  const cbIndex = lower.indexOf('cb')
  if (cbIndex === -1 || cbIndex + 2 >= normalized.length) return null
  const withoutPrefix = normalized
    .slice(cbIndex + 2)
    .replace(/[^0-9a-z]+/gi, '')
  if (withoutPrefix.length <= 1) return null
  return withoutPrefix.slice(0, withoutPrefix.length - 1)
}

function isWorkspaceEntityRecord(record: RecordRow | undefined): record is RecordRow {
  if (!record) return false
  return record.typeNorm === 'oeuvre' || record.typeNorm === 'expression' || record.typeNorm === 'manifestation'
}

type ArkContextMenuState = {
  position: { x: number; y: number }
  record: RecordRow
  ark: string
}

function BreadcrumbItem({ value, isLast }: { value: string; isLast: boolean }) {
  const label = useArkDecoratedText(value)
  return (
    <span className={`workspace-breadcrumb${isLast ? ' is-current' : ''}`} aria-current={isLast ? 'page' : undefined}>
      {label}
    </span>
  )
}

function WorkspaceBreadcrumbs({ items, ariaLabel }: { items: string[]; ariaLabel: string }) {
  if (!items.length) return null
  return (
    <nav className="workspace-breadcrumbs" aria-label={ariaLabel}>
      {items.map((item, index) => (
        <Fragment key={`${item}-${index}`}>
          <BreadcrumbItem value={item} isLast={index === items.length - 1} />
          {index < items.length - 1 ? <span className="workspace-breadcrumb-separator" aria-hidden="true">›</span> : null}
        </Fragment>
      ))}
    </nav>
  )
}

export function WorkspaceView({ state, onStateChange, onOpenTab }: WorkspaceViewProps) {
  const {
    clusters,
    original,
    curated,
    setWorkAccepted,
    setExpressionAccepted,
    updateRecordIntermarc,
  } = useAppData()
  const workspace = useWorkspaceData(state)
  const { t } = useTranslation()
  const { getById, getByArk } = useRecordLookup()
  const record = state.selectedEntity
    ? findRecord(state.selectedEntity.id, curated?.records ?? [], original?.records ?? [])
    : null
  const recordInCurated = useMemo(() => {
    if (!record || !curated) return false
    return curated.records.some(r => r.id === record.id)
  }, [record, curated])
  const isRecordClustered = useMemo(() => {
    if (!record) return false
    switch (record.typeNorm) {
      case 'oeuvre':
        return isWorkClustered(record, workspace.coverage)
      case 'expression':
        return isExpressionClustered(record, workspace.coverage)
      case 'manifestation':
        return isManifestationClustered(record, workspace.coverage)
      default:
        return false
    }
  }, [record, workspace.coverage])
  const canEditRecord = !!record && recordInCurated && !isRecordClustered
  const readOnlyReason = useMemo(() => {
    if (!record) return null
    if (!recordInCurated) return t('messages.recordNotInCurated')
    if (isRecordClustered) return t('messages.clusteredRecordReadOnly')
    return null
  }, [record, recordInCurated, isRecordClustered, t])
  const [editingRecord, setEditingRecord] = useState(false)

  useEffect(() => {
    setEditingRecord(false)
  }, [record?.id])

  const [contextMenu, setContextMenu] = useState<ArkContextMenuState | null>(null)

  const tabContext = useMemo(
    () => ({
      clusters,
      indexes: workspace.indexes,
      curatedRecords: curated?.records ?? [],
      originalRecords: original?.records ?? [],
    }),
    [clusters, workspace.indexes, curated?.records, original?.records],
  )

  const breadcrumbs = useMemo(() => {
    const items: string[] = []

    const addLabel = (value?: string | null) => {
      if (!value) return
      const trimmed = value.trim()
      if (!trimmed) return
      if (items[items.length - 1] === trimmed) return
      items.push(trimmed)
    }

    const labelFromRecord = (rec?: RecordRow | null, fallback?: string) => {
      if (!rec) return fallback
      if (rec.typeNorm === 'manifestation') {
        return manifestationTitle(rec) || rec.id
      }
      return titleOf(rec) || rec.id
    }

    const selected = state.selectedEntity
    if (!selected) return items

    if (selected.entityType === 'work') {
      const workRecord = getById(selected.id) || getByArk(selected.workArk)
      addLabel(labelFromRecord(workRecord, selected.id))
      return items
    }

    if (selected.entityType === 'expression') {
      const workRecord = selected.workArk ? getByArk(selected.workArk) : undefined
      if (workRecord) addLabel(labelFromRecord(workRecord, workRecord.id))
      else if (selected.workArk) addLabel(selected.workArk)
      const expressionRecord =
        (selected.expressionId && getById(selected.expressionId)) ||
        getById(selected.id) ||
        getByArk(selected.expressionArk)
      addLabel(labelFromRecord(expressionRecord, selected.expressionId || selected.id))
      return items
    }

    if (selected.entityType === 'manifestation') {
      const expressionRecord =
        (selected.expressionId && getById(selected.expressionId)) ||
        getByArk(selected.expressionArk)
      if (expressionRecord) {
        const relatedWorkArk = selected.workArk || expressionWorkArks(expressionRecord)[0]
        if (relatedWorkArk) {
          const workRecord = getByArk(relatedWorkArk)
          addLabel(labelFromRecord(workRecord, relatedWorkArk))
        }
        addLabel(labelFromRecord(expressionRecord, expressionRecord.id))
      }
      const manifestationRecord = record || getById(selected.id) || getByArk(selected.id)
      addLabel(labelFromRecord(manifestationRecord, selected.id))
      return items
    }

    addLabel(selected.id)
    return items
  }, [
    getByArk,
    getById,
    record,
    state.selectedEntity,
  ])

  const handleCloseContextMenu = useCallback(() => setContextMenu(null), [])

  useEffect(() => {
    if (!contextMenu) return undefined
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.workspace-context-menu')) return
      handleCloseContextMenu()
    }
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleCloseContextMenu()
      }
    }
    window.addEventListener('click', handleClick)
    window.addEventListener('contextmenu', handleClick)
    window.addEventListener('keydown', handleKeydown)
    return () => {
      window.removeEventListener('click', handleClick)
      window.removeEventListener('contextmenu', handleClick)
      window.removeEventListener('keydown', handleKeydown)
    }
  }, [contextMenu, handleCloseContextMenu])

  const handleRecordContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null
      const arkLink = target?.closest<HTMLElement>('.ark-link')
      if (!arkLink) return
      const rawArk = arkLink.getAttribute('data-ark')
      if (!rawArk) return
      const trimmedArk = rawArk.trim()
      if (!trimmedArk) return
      let targetRecord = getByArk(trimmedArk)
      if (!targetRecord) {
        const fallbackId = deriveInternalIdFromArk(trimmedArk)
        if (fallbackId) targetRecord = getById(fallbackId)
      }
      if (!isWorkspaceEntityRecord(targetRecord)) return
      event.preventDefault()
      setContextMenu({
        position: { x: event.clientX, y: event.clientY },
        record: targetRecord,
        ark: trimmedArk,
      })
    },
    [getByArk, getById],
  )

  const handleOpenArkInNewTab = useCallback(() => {
    if (!contextMenu) return
    const targetRecord = contextMenu.record
    setContextMenu(null)
    onOpenTab(base => configureTabStateForRecord(base, targetRecord, tabContext))
  }, [contextMenu, onOpenTab, tabContext])

  const handleSelectWork = ({ workId, workArk }: { workId: string; workArk?: string | null }) => {
    const hasCuratedRecord = !!findRecord(workId, curated?.records ?? [], [])
    onStateChange(prev => ({
      ...prev,
      activeWorkAnchorId: workId,
      highlightedWorkArk: workArk ?? null,
      viewMode: 'works',
      listScope: 'clusters',
      inventoryFocusWorkId: null,
      inventoryFocusExpressionId: null,
      selectedEntity: {
        id: workId,
        source: hasCuratedRecord ? 'curated' : 'original',
        entityType: 'work',
        workArk: workArk ?? undefined,
      },
    }))
  }

  const handleOpenExpressions = ({ workId, workArk }: { workId: string; workArk?: string | null }) => {
    const cluster = workspace.clusters.find(entry => entry.anchorId === workId) ?? null
    if (cluster) {
      const hasCuratedRecord = !!findRecord(workId, curated?.records ?? [], [])
      onStateChange(prev => ({
        ...prev,
        activeWorkAnchorId: cluster.anchorId,
        highlightedWorkArk: workArk ?? null,
        viewMode: 'expressions',
        listScope: 'clusters',
        inventoryFocusWorkId: null,
        inventoryFocusExpressionId: null,
        selectedEntity: {
          id: workId,
          source: hasCuratedRecord ? 'curated' : 'original',
          entityType: 'work',
          workArk: workArk ?? undefined,
        },
      }))
      return
    }

    const hasCuratedRecord = !!findRecord(workId, curated?.records ?? [], [])
    onStateChange(prev => ({
      ...prev,
      viewMode: 'expressions',
      listScope: 'inventory',
      activeWorkAnchorId: null,
      activeExpressionAnchorId: null,
      highlightedWorkArk: workArk ?? null,
      highlightedExpressionArk: null,
      inventoryFocusWorkId: workId,
      inventoryFocusExpressionId: null,
      selectedEntity: {
        id: workId,
        source: hasCuratedRecord ? 'curated' : 'original',
        entityType: 'work',
        workArk: workArk ?? undefined,
      },
    }))
  }

  const renderListPanel = (viewMode: WorkspaceTabState['viewMode']) => {
    if (viewMode === 'works') {
      return (
        <WorkListPanel
          clusters={workspace.clusters}
          unclusteredWorks={workspace.unclusteredWorks}
          state={state}
          onSelectWork={handleSelectWork}
          onOpenExpressions={handleOpenExpressions}
          onToggleWork={({ clusterId, workArk, accepted }) => setWorkAccepted(clusterId, workArk, accepted)}
        />
      )
    }
    if (viewMode === 'expressions') {
      return (
        <ExpressionPanel
          cluster={workspace.activeCluster}
          state={state}
          onSelectExpression={({
            expressionId,
            expressionArk,
            workArk,
            anchorId,
          }: {
            expressionId: string
            expressionArk?: string
            workArk?: string
            anchorId?: string
          }) =>
            onStateChange(prev => {
              const isClusterContext = workspace.activeClusterSource === 'cluster'
              return {
                ...prev,
                viewMode: 'expressions',
                listScope: isClusterContext ? prev.listScope : 'inventory',
                activeExpressionAnchorId: isClusterContext ? anchorId ?? expressionId : null,
                highlightedExpressionArk: expressionArk ?? null,
                inventoryFocusExpressionId: isClusterContext ? null : expressionId,
                selectedEntity: {
                  id: expressionId,
                  source: isClusterContext ? 'curated' : 'original',
                  entityType: 'expression',
                  workArk: workArk ?? undefined,
                  expressionId,
                  expressionArk,
                },
              }
            })
          }
          onToggleExpression={({ anchorExpressionId, expressionArk, accepted }) => {
            if (!workspace.activeCluster || workspace.activeClusterSource !== 'cluster') return
            setExpressionAccepted(workspace.activeCluster.anchorId, anchorExpressionId, expressionArk, accepted)
          }}
          onOpenManifestations={({ expressionId, expressionArk, workArk, anchorId }) => {
            onStateChange(prev => {
              const isClusterContext = workspace.activeClusterSource === 'cluster'
              return {
                ...prev,
                viewMode: 'manifestations',
                listScope: isClusterContext ? 'clusters' : 'inventory',
                activeExpressionAnchorId: isClusterContext ? anchorId ?? expressionId : null,
                highlightedExpressionArk: expressionArk ?? null,
                inventoryFocusExpressionId: isClusterContext ? null : expressionId,
                selectedEntity: {
                  id: expressionId,
                  source: isClusterContext ? 'curated' : 'original',
                  entityType: 'expression',
                  workArk: workArk ?? undefined,
                  expressionId,
                  expressionArk,
                },
              }
            })
          }}
        />
      )
    }
    return (
      <ManifestationPanel
        cluster={workspace.activeCluster}
        state={state}
        onSelectManifestation={({
          manifestationId,
          expressionId,
          expressionArk,
        }: {
          manifestationId: string
          expressionId?: string
          expressionArk?: string
        }) =>
          onStateChange(prev => ({
            ...prev,
            viewMode: 'manifestations',
            selectedEntity: {
              id: manifestationId,
              source: workspace.activeClusterSource === 'cluster' ? 'curated' : 'original',
              entityType: 'manifestation',
              expressionId,
              expressionArk,
            },
          }))
        }
      />
    )
  }

  return (
    <div className="workspace-view">
      <header className="workspace-view__header">
        <WorkspaceBreadcrumbs items={breadcrumbs} ariaLabel={t('breadcrumbs.ariaLabel')} />
      </header>
      <div className="workspace-view__body">
        <aside className="workspace-panel workspace-panel--list">
          {renderListPanel(state.viewMode)}
        </aside>
        <section className="workspace-panel workspace-panel--details">
          {record ? (
            <div className="record-details" onContextMenu={handleRecordContextMenu}>
              <header className="record-details__header">
                <h3>{record.id}</h3>
                <span>{record.type}</span>
              </header>
              {editingRecord && canEditRecord ? (
                <IntermarcEditor
                  record={record}
                  onSave={next => updateRecordIntermarc(record.id, next)}
                  onCancel={() => setEditingRecord(false)}
                />
              ) : (
                <>
                  <IntermarcView record={record} />
                  {readOnlyReason ? <p className="record-editor__note">{readOnlyReason}</p> : null}
                  {canEditRecord ? (
                    <div className="editor-actions">
                      <button type="button" onClick={() => setEditingRecord(true)}>
                        {t('buttons.modifyRecord')}
                      </button>
                    </div>
                  ) : null}
                </>
              )}
              {contextMenu ? (
                <div
                  className="workspace-context-menu"
                  style={{ top: `${contextMenu.position.y}px`, left: `${contextMenu.position.x}px` }}
                  role="menu"
                >
                  <button type="button" role="menuitem" onClick={handleOpenArkInNewTab}>
                    {t('workspace.openInNewTab', { defaultValue: 'Open in new workspace tab' })}
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <p>{t('layout.selectPrompt')}</p>
          )}
        </section>
      </div>
    </div>
  )
}
