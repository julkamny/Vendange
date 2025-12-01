import type { RefObject } from 'react'
import { IntermarcEditor } from '../../components/IntermarcEditor'
import { IntermarcView } from '../../components/IntermarcView'
import { BacklinksPanel } from '../../components/BacklinksPanel'
import { WorkspaceContextMenu, type MenuAction } from '../../components/WorkspaceContextMenu'
import { WorkspaceBreadcrumbs } from './WorkspaceBreadcrumbs'
import { ConfirmExpressionClusterModal, ConfirmWorkClusterModal } from './ClusterModals'
import { AnchorSwapModal } from './AnchorSwapModal'
import { OriginalitySwapModal } from './OriginalitySwapModal'
import { ManifestationUprootModal } from './ManifestationUprootModal'
import type { WorkspaceTabStateWorkspace } from '../../workspace/types'
import type { RecordRow } from '../../types'
import type { BacklinkInfo } from '../../hooks/useBacklinks'
import type { WorkspaceContextMenuState } from './types'

type Props = {
  mode: 'inline' | 'detached'
  state: WorkspaceTabStateWorkspace
  workspaceClassName: string
  activeOperation: 'work-cluster' | 'expression-cluster' | 'anchor-swap' | 'manifestation-uproot' | 'originality-swap' | null
  breadcrumbs: string[]
  record: RecordRow | null
  getById: (id: string) => RecordRow | null
  getByArk: (ark: string) => RecordRow | null
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
  prepareUprootLabel: string
  attachManifestationLabel: string
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
  getWorkAnchorSwapAction: (record: RecordRow | null) => MenuAction | null
  getExpressionAnchorSwapAction: (record: RecordRow | null) => MenuAction | null
  getOriginalitySwapAction: (record: RecordRow | null) => MenuAction | null
  pendingWorkAnchorSwapSourceRecord: RecordRow | null
  pendingWorkAnchorSwapTarget: { anchorId: string; sourceId: string } | null
  pendingExpressionAnchorSwapSourceRecord: RecordRow | null
  pendingExpressionAnchorSwapTarget: { anchorId: string; sourceId: string } | null
  pendingOriginalitySourceRecord: RecordRow | null
  pendingOriginalityTarget: { sourceId: string; targetId: string } | null
  confirmPendingWorkAnchorSwap: () => void
  cancelPendingWorkAnchorSwap: () => void
  confirmPendingExpressionAnchorSwap: () => void
  cancelPendingExpressionAnchorSwap: () => void
  confirmPendingOriginalitySwap: () => void
  cancelPendingOriginalitySwap: () => void
  setBacklinksExpandedLabel: string
  pendingManifestationRecord: RecordRow | null
  pendingManifestationAttach: {
    manifestationId: string
    targetExpressionId: string | null
    targetExpressionArk: string | null
    detachableArks: string[]
    selectedArks: string[]
    partial: boolean
  } | null
  prepareManifestationForUprooting: (target: RecordRow) => void
  requestAttachToExpression: (target: RecordRow) => void
  toggleDetachSelection: (ark: string, checked: boolean) => void
  togglePartialAttach: (checked: boolean) => void
  cancelPendingAttach: () => void
  confirmAttach: () => void
}

export function WorkspaceViewLayout(props: Props) {
  const {
    mode,
    state,
    workspaceClassName,
    activeOperation,
    breadcrumbs,
    record,
    getById,
    getByArk,
    renderListPanel,
    listPanelRef,
    detailsPanelRef,
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
    prepareUprootLabel,
    attachManifestationLabel,
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
    getWorkAnchorSwapAction,
    getExpressionAnchorSwapAction,
    getOriginalitySwapAction,
    pendingWorkAnchorSwapSourceRecord,
    pendingWorkAnchorSwapTarget,
    pendingExpressionAnchorSwapSourceRecord,
    pendingExpressionAnchorSwapTarget,
    pendingOriginalitySourceRecord,
    pendingOriginalityTarget,
    confirmPendingWorkAnchorSwap,
    cancelPendingWorkAnchorSwap,
    confirmPendingExpressionAnchorSwap,
    cancelPendingExpressionAnchorSwap,
    confirmPendingOriginalitySwap,
    cancelPendingOriginalitySwap,
    setBacklinksExpandedLabel,
    pendingManifestationRecord,
    pendingManifestationAttach,
    prepareManifestationForUprooting,
    requestAttachToExpression,
    toggleDetachSelection,
    togglePartialAttach,
    cancelPendingAttach,
    confirmAttach,
  } = props

  const buildClusterAction = (target: RecordRow): MenuAction | null => {
    const clusterLocked =
      target.typeNorm === 'oeuvre'
        ? Boolean(activeOperation && activeOperation !== 'work-cluster')
        : Boolean(activeOperation && activeOperation !== 'expression-cluster')
    const disabled = Boolean(
      clusterLocked ||
        (pendingClusterSourceRecord &&
          pendingClusterSourceRecord.id !== target.id &&
          pendingClusterSourceRecord.typeNorm !== target.typeNorm) ||
        (pendingExpressionClusterSourceRecord &&
          pendingExpressionClusterSourceRecord.id !== target.id &&
          pendingExpressionClusterSourceRecord.typeNorm !== target.typeNorm),
    )

    if (target.typeNorm === 'oeuvre') {
      if (!pendingClusterSourceRecord) {
        return {
          label: prepareWorkLabel,
          disabled,
          onSelect: () => prepareForClustering(target),
        }
      }
      if (pendingClusterSourceRecord.id !== target.id && pendingClusterSourceRecord.typeNorm === target.typeNorm) {
        return {
          label: clusterWorkLabel,
          disabled,
          onSelect: () => requestClusterWith(target),
        }
      }
    } else if (target.typeNorm === 'expression') {
      if (!pendingExpressionClusterSourceRecord) {
        return {
          label: prepareExpressionLabel,
          disabled,
          onSelect: () => prepareExpressionForClustering(target),
        }
      }
      if (
        pendingExpressionClusterSourceRecord.id !== target.id &&
        pendingExpressionClusterSourceRecord.typeNorm === target.typeNorm
      ) {
        return {
          label: clusterExpressionLabel,
          disabled,
          onSelect: () => requestExpressionClusterWith(target),
        }
      }
    }
    return null
  }

  return (
    <>
      <div className={workspaceClassName}>
        <header className="workspace-view__header">
          <WorkspaceBreadcrumbs items={breadcrumbs} ariaLabel={toolbarAriaLabel} />
        </header>
        <div className="workspace-view__body">
          {!listCollapsed ? (
            <aside
              className="workspace-panel workspace-panel--list"
              ref={listPanelRef}
              style={{
                height: 'calc(100vh - var(--app-sticky-offset) - 1.5rem)',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
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
        (() => {
          const actions: MenuAction[] = []
          const uprootAction =
            contextMenu.record.typeNorm === 'manifestation'
              ? {
                  label: prepareUprootLabel,
                  disabled: Boolean(
                    (activeOperation && activeOperation !== 'manifestation-uproot') ||
                      (pendingManifestationRecord && pendingManifestationRecord.id !== contextMenu.record.id),
                  ),
                  onSelect: () => prepareManifestationForUprooting(contextMenu.record),
                }
              : null
          if (uprootAction) actions.push(uprootAction)
          const attachAction =
            pendingManifestationRecord && contextMenu.record.typeNorm === 'expression'
              ? {
                  label: attachManifestationLabel,
                  disabled:
                    !contextMenu.record.ark || Boolean(activeOperation && activeOperation !== 'manifestation-uproot'),
                  onSelect: () => requestAttachToExpression(contextMenu.record),
                }
              : null
          if (attachAction) actions.push(attachAction)
          const clusterAction = buildClusterAction(contextMenu.record)
          if (clusterAction) actions.push(clusterAction)
          let swapAction =
            contextMenu.record.typeNorm === 'oeuvre'
              ? getWorkAnchorSwapAction(contextMenu.record)
              : contextMenu.record.typeNorm === 'expression'
                ? getExpressionAnchorSwapAction(contextMenu.record)
                : null
          if (swapAction && activeOperation && activeOperation !== 'anchor-swap') {
            swapAction = { ...swapAction, disabled: true }
          }
          if (swapAction) actions.push(swapAction)

          let originalityAction =
            contextMenu.record.typeNorm === 'oeuvre' ? getOriginalitySwapAction(contextMenu.record) : null
          if (originalityAction && activeOperation && activeOperation !== 'originality-swap') {
            originalityAction = { ...originalityAction, disabled: true }
          }
          if (originalityAction) actions.push(originalityAction)

          return (
        <WorkspaceContextMenu
          position={contextMenu.position}
          openLabel={openTabLabel}
          openDetachedLabel={openDetachedLabel}
          extraActions={actions}
          onOpen={() => {
            openRecordForArk(contextMenu.record.ark ?? contextMenu.record.id)
            setContextMenu(null)
          }}
          onOpenDetached={() => {
            openRecordForArk(contextMenu.record.ark ?? contextMenu.record.id, { detach: true })
            setContextMenu(null)
          }}
        />
          )
        })()
      ) : null}

      {pendingClusterTarget ? (
        <ConfirmWorkClusterModal
          source={pendingClusterSourceRecord}
          anchor={pendingClusterTarget ? getById(pendingClusterTarget.anchorId) : null}
          onConfirm={confirmPendingCluster}
          onCancel={cancelPendingCluster}
        />
      ) : null}

      {pendingExpressionClusterTarget ? (
        <ConfirmExpressionClusterModal
          source={pendingExpressionClusterSourceRecord}
          anchor={pendingExpressionClusterTarget ? getById(pendingExpressionClusterTarget.anchorId) : null}
          onConfirm={confirmPendingExpressionCluster}
          onCancel={cancelPendingExpressionCluster}
        />
      ) : null}

      {pendingWorkAnchorSwapTarget ? (
        <AnchorSwapModal
          kind="work"
          source={pendingWorkAnchorSwapSourceRecord}
          anchor={getById(pendingWorkAnchorSwapTarget.anchorId)}
          onConfirm={confirmPendingWorkAnchorSwap}
          onCancel={cancelPendingWorkAnchorSwap}
        />
      ) : null}

      {pendingExpressionAnchorSwapTarget ? (
        <AnchorSwapModal
          kind="expression"
          source={pendingExpressionAnchorSwapSourceRecord}
          anchor={getById(pendingExpressionAnchorSwapTarget.anchorId)}
          onConfirm={confirmPendingExpressionAnchorSwap}
          onCancel={cancelPendingExpressionAnchorSwap}
        />
      ) : null}

      {pendingOriginalityTarget ? (
        <OriginalitySwapModal
          source={pendingOriginalitySourceRecord}
          target={getById(pendingOriginalityTarget.targetId)}
          onConfirm={confirmPendingOriginalitySwap}
          onCancel={cancelPendingOriginalitySwap}
        />
      ) : null}

      {pendingManifestationAttach ? (
        <ManifestationUprootModal
          manifestation={getById(pendingManifestationAttach.manifestationId)}
          targetExpression={
            getById(pendingManifestationAttach.targetExpressionId ?? '') ||
            (pendingManifestationAttach.targetExpressionArk
              ? getByArk(pendingManifestationAttach.targetExpressionArk)
              : null)
          }
          detachableArks={pendingManifestationAttach.detachableArks}
          selectedArks={pendingManifestationAttach.selectedArks}
          lookupExpressionByArk={ark => getByArk(ark)}
          onToggle={toggleDetachSelection}
          partial={pendingManifestationAttach.partial}
          onPartialToggle={togglePartialAttach}
          onConfirm={confirmAttach}
          onCancel={cancelPendingAttach}
        />
      ) : null}
    </>
  )
}
