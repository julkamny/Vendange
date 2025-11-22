import type { RefObject } from 'react'
import { IntermarcEditor } from '../../components/IntermarcEditor'
import { IntermarcView } from '../../components/IntermarcView'
import { BacklinksPanel } from '../../components/BacklinksPanel'
import { WorkspaceContextMenu } from '../../components/WorkspaceContextMenu'
import { WorkspaceBreadcrumbs } from './WorkspaceBreadcrumbs'
import { ConfirmExpressionClusterModal, ConfirmWorkClusterModal } from './ClusterModals'
import type { WorkspaceTabStateWorkspace } from '../../workspace/types'
import type { RecordRow } from '../../types'
import type { BacklinkInfo } from '../../hooks/useBacklinks'
import type { WorkspaceContextMenuState } from './types'

type Props = {
  mode: 'inline' | 'detached'
  state: WorkspaceTabStateWorkspace
  workspaceClassName: string
  breadcrumbs: string[]
  record: RecordRow | null
  renderListPanel: (viewMode: WorkspaceTabStateWorkspace['viewMode']) => JSX.Element
  listPanelRef: RefObject<HTMLElement>
  detailsPanelRef: RefObject<HTMLElement>
  handleListScroll: (event: React.UIEvent<HTMLElement>) => void
  handleDetailsScroll: (event: React.UIEvent<HTMLElement>) => void
  handleRecordContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void
  handleArkClick: (ark: string, context: { zone: string; subfield: string }) => void
  handleIntermarcSave: (targetRecord: RecordRow, next: unknown) => void
  editingRecord: boolean
  setEditingRecord: (next: boolean) => void
  canEditRecord: boolean
  readOnlyReason: string | null
  backlinks: BacklinkInfo[]
  openRecordForArk: (ark: string, options?: { detach?: boolean }) => void
  getCuratedBaselineRecord: (id: string) => RecordRow | null
  lookupWorkByArk: (ark: string) => RecordRow | undefined
  listCollapsed: boolean
  intermarcFullView: boolean
  backlinksExpanded: boolean
  setIntermarcFullView: (next: boolean | ((prev: boolean) => boolean)) => void
  setListCollapsed: (updater: (prev: boolean) => boolean) => void
  setBacklinksExpanded: (next: boolean | ((prev: boolean) => boolean)) => void
  onRequestDetach?: () => void
  onRequestDock?: () => void
  detachLabelFull: string
  dockLabelFull: string
  toggleFullLabelFull: string
  toolbarAriaLabel: string
  listShowLabel: string
  listHideLabel: string
  backlinksShowLabel: string
  backlinksHideLabel: string
  selectPrompt: string
  openTabLabel: string
  openDetachedLabel: string
  prepareWorkLabel: string
  clusterWorkLabel: string
  prepareExpressionLabel: string
  clusterExpressionLabel: string
  backlinksTitle: string
  contextMenu: WorkspaceContextMenuState | null
  setContextMenu: (next: WorkspaceContextMenuState | null) => void
  pendingClusterSourceRecord: RecordRow | null
  pendingClusterTarget: { anchorId: string; sourceId: string } | null
  confirmPendingCluster: () => void
  cancelPendingCluster: () => void
  pendingExpressionClusterSourceRecord: RecordRow | null
  pendingExpressionClusterTarget: { anchorId: string; sourceId: string } | null
  confirmPendingExpressionCluster: () => void
  cancelPendingExpressionCluster: () => void
  prepareForClustering: (target: RecordRow) => void
  requestClusterWith: (anchor: RecordRow) => void
  prepareExpressionForClustering: (target: RecordRow) => void
  requestExpressionClusterWith: (anchor: RecordRow) => void
  setBacklinksExpandedLabel: string
}

export function WorkspaceViewLayout(props: Props) {
  const {
    mode,
    state,
    workspaceClassName,
    breadcrumbs,
    record,
    renderListPanel,
    listPanelRef,
    detailsPanelRef,
    handleListScroll,
    handleDetailsScroll,
    handleRecordContextMenu,
    handleArkClick,
    handleIntermarcSave,
    editingRecord,
    setEditingRecord,
    canEditRecord,
    readOnlyReason,
    backlinks,
    openRecordForArk,
    getCuratedBaselineRecord,
    lookupWorkByArk,
    listCollapsed,
    intermarcFullView,
    backlinksExpanded,
    setIntermarcFullView,
    setListCollapsed,
    setBacklinksExpanded,
    onRequestDetach,
    onRequestDock,
    detachLabelFull,
    dockLabelFull,
    toggleFullLabelFull,
    toolbarAriaLabel,
    listHideLabel,
    listShowLabel,
    backlinksHideLabel,
    backlinksShowLabel,
    selectPrompt,
    openTabLabel,
    openDetachedLabel,
    prepareWorkLabel,
    clusterWorkLabel,
    prepareExpressionLabel,
    clusterExpressionLabel,
    backlinksTitle,
    contextMenu,
    setContextMenu,
    pendingClusterSourceRecord,
    pendingClusterTarget,
    confirmPendingCluster,
    cancelPendingCluster,
    pendingExpressionClusterSourceRecord,
    pendingExpressionClusterTarget,
    confirmPendingExpressionCluster,
    cancelPendingExpressionCluster,
    prepareForClustering,
    requestClusterWith,
    prepareExpressionForClustering,
    requestExpressionClusterWith,
    setBacklinksExpandedLabel,
  } = props

  return (
    <>
      <div className={workspaceClassName}>
        <header className="workspace-view__header">
          <WorkspaceBreadcrumbs items={breadcrumbs} ariaLabel={toolbarAriaLabel} />
        </header>
        <div className="workspace-view__body">
          {!listCollapsed ? (
            <aside className="workspace-panel workspace-panel--list" ref={listPanelRef} onScroll={handleListScroll}>
              {renderListPanel(state.viewMode)}
            </aside>
          ) : null}
          <section
            className="workspace-panel workspace-panel--details"
            ref={detailsPanelRef}
            onScroll={handleDetailsScroll}
          >
            {record ? (
              <>
                <div className="record-details" onContextMenu={handleRecordContextMenu}>
                  <header className="record-details__header">
                    <h3>{record.id}</h3>
                    <span>{record.type}</span>
                  </header>
                  {editingRecord && canEditRecord ? (
                    <IntermarcEditor
                      record={record}
                      baselineRecord={getCuratedBaselineRecord(record.id) ?? undefined}
                      onSave={next => handleIntermarcSave(record, next)}
                      onCancel={() => setEditingRecord(false)}
                    />
                  ) : (
                    <>
                      <IntermarcView record={record} onArkClick={handleArkClick} />
                      {readOnlyReason ? <p className="record-editor__note">{readOnlyReason}</p> : null}
                      {canEditRecord ? (
                        <div className="editor-actions">
                          <button type="button" onClick={() => setEditingRecord(true)}>
                            Modify record
                          </button>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
                {!backlinksExpanded ? (
                  <BacklinksPanel backlinks={backlinks} onOpenArk={openRecordForArk} lookupWorkByArk={lookupWorkByArk} />
                ) : null}
              </>
            ) : (
              <p>{selectPrompt}</p>
            )}
          </section>
          {record && backlinksExpanded ? (
            <section className="workspace-panel workspace-panel--backlinks" aria-label={backlinksTitle}>
              <BacklinksPanel backlinks={backlinks} onOpenArk={openRecordForArk} lookupWorkByArk={lookupWorkByArk} />
            </section>
          ) : null}
        </div>
        {record ? (
          <div className="workspace-side-toolbar" aria-label={toolbarAriaLabel}>
            {mode === 'inline' && onRequestDetach ? (
              <button type="button" className="workspace-side-toolbar__button" onClick={onRequestDetach} aria-label={detachLabelFull}>
                <span aria-hidden="true" className="workspace-side-toolbar__icon">🪟</span>
                <span className="workspace-side-toolbar__label">Pop</span>
              </button>
            ) : null}
            {mode === 'detached' && onRequestDock ? (
              <button type="button" className="workspace-side-toolbar__button" onClick={onRequestDock} aria-label={dockLabelFull}>
                <span aria-hidden="true" className="workspace-side-toolbar__icon">↩️</span>
                <span className="workspace-side-toolbar__label">Dock</span>
              </button>
            ) : null}
            <button
              type="button"
              className="workspace-side-toolbar__button"
              onClick={() =>
                setIntermarcFullView(prev => {
                  const next = typeof prev === 'function' ? true : !prev
                  if (next) setBacklinksExpanded(false)
                  return next
                })
              }
              aria-label={toggleFullLabelFull}
            >
              <span aria-hidden="true" className="workspace-side-toolbar__icon">🖥️</span>
              <span className="workspace-side-toolbar__label">{intermarcFullView ? 'Split' : 'Full'}</span>
            </button>
            <button
              type="button"
              className="workspace-side-toolbar__button"
              onClick={() => {
                if (intermarcFullView) setIntermarcFullView(false)
                setListCollapsed(prev => !prev)
              }}
              aria-pressed={listCollapsed}
              aria-label={listCollapsed ? listShowLabel : listHideLabel}
            >
              <span aria-hidden="true" className="workspace-side-toolbar__icon">{listCollapsed ? '📚' : '🗂️'}</span>
              <span className="workspace-side-toolbar__label">{listCollapsed ? listShowLabel : listHideLabel}</span>
            </button>
            <button
              type="button"
              className="workspace-side-toolbar__button workspace-side-toolbar__button--primary"
              onClick={() =>
                setBacklinksExpanded(prev => {
                  const next = typeof prev === 'function' ? true : !prev
                  if (next && intermarcFullView) setIntermarcFullView(false)
                  return next
                })
              }
              aria-pressed={backlinksExpanded}
              aria-label={backlinksExpanded ? backlinksHideLabel : backlinksShowLabel}
            >
              <span aria-hidden="true" className="workspace-side-toolbar__icon">{backlinksExpanded ? '⬇️' : '🔗'}</span>
              <span className="workspace-side-toolbar__label">{backlinksExpanded ? backlinksHideLabel : setBacklinksExpandedLabel}</span>
            </button>
          </div>
        ) : null}
      </div>

      {contextMenu ? (
        <WorkspaceContextMenu
          position={contextMenu.position}
          openLabel={openTabLabel}
          openDetachedLabel={openDetachedLabel}
          extraActionLabel={
            contextMenu.record.typeNorm === 'oeuvre'
              ? !pendingClusterSourceRecord
                ? prepareWorkLabel
                : pendingClusterSourceRecord.id !== contextMenu.record.id &&
                  pendingClusterSourceRecord.typeNorm === contextMenu.record.typeNorm
                  ? clusterWorkLabel
                  : undefined
              : contextMenu.record.typeNorm === 'expression'
                ? !pendingExpressionClusterSourceRecord
                  ? prepareExpressionLabel
                  : pendingExpressionClusterSourceRecord.id !== contextMenu.record.id &&
                    pendingExpressionClusterSourceRecord.typeNorm === contextMenu.record.typeNorm
                    ? clusterExpressionLabel
                    : undefined
                : undefined
          }
          extraActionDisabled={
            Boolean(
              (pendingClusterSourceRecord &&
                pendingClusterSourceRecord.id !== contextMenu.record.id &&
                pendingClusterSourceRecord.typeNorm !== contextMenu.record.typeNorm) ||
              (pendingExpressionClusterSourceRecord &&
                pendingExpressionClusterSourceRecord.id !== contextMenu.record.id &&
                pendingExpressionClusterSourceRecord.typeNorm !== contextMenu.record.typeNorm),
            )
          }
          onExtraAction={() => {
            if (contextMenu.record.typeNorm === 'oeuvre') {
              if (!pendingClusterSourceRecord) {
                prepareForClustering(contextMenu.record)
              } else if (
                pendingClusterSourceRecord.id !== contextMenu.record.id &&
                pendingClusterSourceRecord.typeNorm === contextMenu.record.typeNorm
              ) {
                requestClusterWith(contextMenu.record)
              }
            } else if (contextMenu.record.typeNorm === 'expression') {
              if (!pendingExpressionClusterSourceRecord) {
                prepareExpressionForClustering(contextMenu.record)
              } else if (
                pendingExpressionClusterSourceRecord.id !== contextMenu.record.id &&
                pendingExpressionClusterSourceRecord.typeNorm === contextMenu.record.typeNorm
              ) {
                requestExpressionClusterWith(contextMenu.record)
              }
            }
          }}
          onOpen={() => {
            openRecordForArk(contextMenu.record.ark ?? contextMenu.record.id)
            setContextMenu(null)
          }}
          onOpenDetached={() => {
            openRecordForArk(contextMenu.record.ark ?? contextMenu.record.id, { detach: true })
            setContextMenu(null)
          }}
        />
      ) : null}

      {pendingClusterTarget ? (
        <ConfirmWorkClusterModal
          source={pendingClusterSourceRecord}
          anchor={contextMenu?.record ?? null}
          onConfirm={confirmPendingCluster}
          onCancel={cancelPendingCluster}
        />
      ) : null}

      {pendingExpressionClusterTarget ? (
        <ConfirmExpressionClusterModal
          source={pendingExpressionClusterSourceRecord}
          anchor={contextMenu?.record ?? null}
          onConfirm={confirmPendingExpressionCluster}
          onCancel={cancelPendingExpressionCluster}
        />
      ) : null}
    </>
  )
}
