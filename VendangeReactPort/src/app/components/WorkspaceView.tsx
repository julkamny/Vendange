import { useEffect, useMemo, useState } from 'react'
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

type WorkspaceViewProps = {
  state: WorkspaceTabState
  onStateChange: (updater: (prev: WorkspaceTabState) => WorkspaceTabState) => void
}

function findRecord(id: string, curated: RecordRow[], original: RecordRow[]): RecordRow | null {
  return curated.find(rec => rec.id === id) || original.find(rec => rec.id === id) || null
}

export function WorkspaceView({ state, onStateChange }: WorkspaceViewProps) {
  const {
    clusters,
    original,
    curated,
    setWorkAccepted,
    setExpressionAccepted,
    moveManifestation,
    updateRecordIntermarc,
  } = useAppData()
  const workspace = useWorkspaceData(state)
  const { t } = useTranslation()
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
  const handleSelectWork = ({ workId, workArk }: { workId: string; workArk?: string | null }) => {
    const hasCuratedRecord = !!findRecord(workId, curated?.records ?? [], [])
    onStateChange(prev => ({
      ...prev,
      activeWorkAnchorId: workId,
      highlightedWorkArk: workArk ?? null,
      viewMode: 'works',
      listScope: 'clusters',
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
          onOpenExpressions={({ workId, workArk }) =>
            onStateChange(prev => ({
              ...prev,
              activeWorkAnchorId: workId,
              highlightedWorkArk: workArk ?? null,
              viewMode: 'expressions',
              selectedEntity: {
                id: workId,
                source: findRecord(workId, curated?.records ?? [], []) ? 'curated' : 'original',
                entityType: 'work',
                workArk: workArk ?? undefined,
              },
            }))
          }
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
            onStateChange(prev => ({
              ...prev,
              viewMode: 'expressions',
              activeExpressionAnchorId: anchorId ?? expressionId,
              highlightedExpressionArk: expressionArk ?? null,
              selectedEntity: {
                id: expressionId,
                source: 'curated',
                entityType: 'expression',
                workArk: workArk ?? undefined,
                expressionId,
                expressionArk,
              },
            }))
          }
          onToggleExpression={({ anchorExpressionId, expressionArk, accepted }) => {
            if (!workspace.activeCluster) return
            setExpressionAccepted(workspace.activeCluster.anchorId, anchorExpressionId, expressionArk, accepted)
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
              source: 'curated',
              entityType: 'manifestation',
              expressionId,
              expressionArk,
            },
          }))
        }
        onAssignManifestation={({ manifestationId, anchorExpressionId, expressionArk, expressionId }) => {
          if (!workspace.activeCluster || !expressionArk) return
          moveManifestation(workspace.activeCluster.anchorId, manifestationId, {
            anchorExpressionId,
            expressionArk,
            expressionId,
          })
        }}
      />
    )
  }

  return (
    <div className="workspace-view">
      <header className="workspace-view__header">
        <h2>{state.title}</h2>
        <span>
          {t('workspace.summary', {
            defaultValue: '{{clusters}} clusters · {{original}} original records · {{curated}} curated records',
            clusters: clusters.length,
            original: original?.records.length ?? 0,
            curated: curated?.records.length ?? 0,
          })}
        </span>
      </header>
      <div className="workspace-view__body">
        <aside className="workspace-panel workspace-panel--list">
          {renderListPanel(state.viewMode)}
        </aside>
        <section className="workspace-panel workspace-panel--details">
          {record ? (
            <div className="record-details">
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
            </div>
          ) : (
            <p>{t('layout.selectPrompt')}</p>
          )}
        </section>
      </div>
    </div>
  )
}
