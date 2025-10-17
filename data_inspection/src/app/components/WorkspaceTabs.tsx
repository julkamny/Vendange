import { useState, useCallback, useEffect, useMemo } from 'react'
import { WorkspaceView } from './WorkspaceView'
import type { WorkspaceTabState } from '../workspace/types'
import type { RecordRow, SelectedEntity, Cluster } from '../types'
import { DEFAULT_WORKSPACE_STATE } from '../workspace/types'
import { useTranslation } from '../hooks/useTranslation'
import { useShortcuts } from '../providers/ShortcutContext'
import { shortcutMatchesEvent, type ShortcutAction } from '../core/shortcuts'
import { useWorkspaceData } from '../workspace/useWorkspaceData'
import { useAppData } from '../providers/AppDataContext'
import { focusTreeUp, focusTreeDown } from '../workspace/shortcutActions'
import { manifestationTitle, titleOf, expressionWorkArks, manifestationExpressionArks } from '../core/entities'
import { useArkDecoratedText } from '../hooks/useArkDecoratedText'

let tabSequence = 0

function createTab(title: string): WorkspaceTabState {
  return {
    id: `tab-${++tabSequence}`,
    title,
    ...DEFAULT_WORKSPACE_STATE,
  }
}

type TabContext = {
  clusters: Cluster[]
  recordIndexes: { byId: Map<string, RecordRow>; byArk: Map<string, RecordRow> }
  curatedRecords: RecordRow[]
}

function configureTabForEntity(
  tab: WorkspaceTabState,
  entity: SelectedEntity,
  context: TabContext,
): WorkspaceTabState {
  const next: WorkspaceTabState = {
    ...tab,
    ...DEFAULT_WORKSPACE_STATE,
    id: tab.id,
    title: tab.title,
  }
  const curatedIds = new Set(context.curatedRecords.map(record => record.id))
  const recordById = context.recordIndexes.byId
  const recordByArk = context.recordIndexes.byArk
  const source: 'curated' | 'original' =
    entity.source ?? (curatedIds.has(entity.id) ? 'curated' : 'original')

  if (entity.entityType === 'work') {
    const record = recordById.get(entity.id) || (entity.workArk ? recordByArk.get(entity.workArk) : undefined)
    const workArk = entity.workArk ?? record?.ark ?? undefined
    const clusterMatch = context.clusters.find(cluster => {
      if (cluster.anchorId === entity.id) return true
      if (workArk && cluster.anchorArk === workArk) return true
      return cluster.items.some(item => {
        if (item.id && item.id === entity.id) return true
        if (workArk && item.ark === workArk) return true
        return false
      })
    })
    next.selectedEntity = {
      id: entity.id,
      source,
      entityType: 'work',
      workArk,
    }
    if (clusterMatch) {
      next.viewMode = 'works'
      next.listScope = 'clusters'
      next.activeWorkAnchorId = clusterMatch.anchorId
      next.highlightedWorkArk = workArk ?? null
    } else {
      next.viewMode = 'works'
      next.listScope = 'inventory'
      next.inventoryFocusWorkId = entity.id
      next.highlightedWorkArk = workArk ?? null
    }
    return next
  }

  if (entity.entityType === 'expression') {
    const expressionId = entity.expressionId ?? entity.id
    const expressionRecord =
      recordById.get(expressionId) || (entity.expressionArk ? recordByArk.get(entity.expressionArk) : undefined)
    const expressionArk = entity.expressionArk ?? expressionRecord?.ark ?? undefined
    const workArk = entity.workArk ?? (expressionRecord ? expressionWorkArks(expressionRecord)[0] : undefined)

    let matchedCluster: Cluster | null = null
    let anchorExpressionId: string | null = null
    let isIndependent = false

    for (const cluster of context.clusters) {
      let found = false
      for (const group of cluster.expressionGroups) {
        if (group.anchor.id === expressionId || (expressionArk && group.anchor.ark === expressionArk)) {
          matchedCluster = cluster
          anchorExpressionId = group.anchor.id
          found = true
          break
        }
        if (
          group.clustered.some(
            expr => expr.id === expressionId || (expressionArk && expr.ark === expressionArk),
          )
        ) {
          matchedCluster = cluster
          anchorExpressionId = group.anchor.id
          found = true
          break
        }
      }
      if (found) break
      const independentMatch = cluster.independentExpressions.find(
        expr => expr.id === expressionId || (expressionArk && expr.ark === expressionArk),
      )
      if (independentMatch) {
        matchedCluster = cluster
        anchorExpressionId = independentMatch.id
        isIndependent = true
        break
      }
    }

    next.selectedEntity = {
      id: expressionId,
      source,
      entityType: 'expression',
      workArk,
      expressionId,
      expressionArk,
    }

    next.highlightedWorkArk = workArk ?? null
    next.highlightedExpressionArk = expressionArk ?? null

    if (matchedCluster) {
      next.viewMode = 'expressions'
      next.listScope = 'clusters'
      next.activeWorkAnchorId = matchedCluster.anchorId
      next.activeExpressionAnchorId = isIndependent ? null : anchorExpressionId
    } else {
      next.viewMode = 'expressions'
      next.listScope = 'inventory'
      next.inventoryFocusExpressionId = expressionId
      next.inventoryExpressionFilterArk = expressionArk ?? null
    }
    return next
  }

  if (entity.entityType === 'manifestation') {
    const manifestationRecord = recordById.get(entity.id)
    const expressionArk =
      entity.expressionArk ?? (manifestationRecord ? manifestationExpressionArks(manifestationRecord)[0] : undefined)
    const expressionRecord = expressionArk ? recordByArk.get(expressionArk) : undefined
    const expressionId = entity.expressionId ?? expressionRecord?.id
    const workArk = entity.workArk ?? (expressionRecord ? expressionWorkArks(expressionRecord)[0] : undefined)

    let matchedCluster: Cluster | null = null
    let anchorExpressionId: string | null = null
    let manifestationExpressionId = expressionId ?? null
    let fromIndependent = false

    for (const cluster of context.clusters) {
      let found = false
      for (const group of cluster.expressionGroups) {
        if (group.anchor.manifestations.some(item => item.id === entity.id)) {
          matchedCluster = cluster
          anchorExpressionId = group.anchor.id
          manifestationExpressionId = group.anchor.id
          found = true
          break
        }
        const clusteredMatch = group.clustered.find(expr => expr.manifestations.some(item => item.id === entity.id))
        if (clusteredMatch) {
          matchedCluster = cluster
          anchorExpressionId = group.anchor.id
          manifestationExpressionId = clusteredMatch.id
          found = true
          break
        }
      }
      if (found) break
      const independentMatch = cluster.independentExpressions.find(expr =>
        expr.manifestations.some(item => item.id === entity.id),
      )
      if (independentMatch) {
        matchedCluster = cluster
        anchorExpressionId = independentMatch.id
        manifestationExpressionId = independentMatch.id
        fromIndependent = true
        break
      }
    }

    next.selectedEntity = {
      id: entity.id,
      source,
      entityType: 'manifestation',
      expressionId: manifestationExpressionId ?? undefined,
      expressionArk,
      workArk,
    }

    next.highlightedExpressionArk = expressionArk ?? null

    if (matchedCluster) {
      next.viewMode = 'manifestations'
      next.listScope = 'clusters'
      next.activeWorkAnchorId = matchedCluster.anchorId
      next.activeExpressionAnchorId = fromIndependent ? null : anchorExpressionId
    } else {
      next.viewMode = 'manifestations'
      next.listScope = 'inventory'
      if (expressionId) next.inventoryFocusExpressionId = expressionId
      next.inventoryExpressionFilterArk = expressionArk ?? null
    }
    return next
  }

  next.selectedEntity = { ...entity, source }
  return next
}

type WorkspaceTabsProps = {
  shortcutModalOpen: boolean
}

export function WorkspaceTabs({ shortcutModalOpen }: WorkspaceTabsProps) {
  const { t } = useTranslation()
  const { bindings } = useShortcuts()
  const { clusters, original, curated } = useAppData()
  const originalRecords = original?.records ?? []
  const curatedRecords = curated?.records ?? []
  const recordIndexes = useMemo(() => {
    const byId = new Map<string, RecordRow>()
    const byArk = new Map<string, RecordRow>()
    const addRecords = (records: RecordRow[]) => {
      for (const rec of records) {
        byId.set(rec.id, rec)
        if (rec.ark) byArk.set(rec.ark, rec)
      }
    }
    addRecords(originalRecords)
    addRecords(curatedRecords)
    return { byId, byArk }
  }, [originalRecords, curatedRecords])
  const [tabs, setTabs] = useState<WorkspaceTabState[]>(() => [createTab(t('workspace.tabDefault', { defaultValue: 'Workspace' }))])
  const [activeId, setActiveId] = useState(() => tabs[0]?.id ?? '')

  const addTab = useCallback(() => {
    const newTab = createTab(t('workspace.tabDefault', { defaultValue: 'Workspace' }))
    setTabs(prev => [...prev, newTab])
    setActiveId(newTab.id)
  }, [t])

  const closeTab = useCallback(
    (id: string) => {
      setTabs(prev => {
        if (prev.length <= 1) return prev
        const next = prev.filter(tab => tab.id !== id)
        if (!next.some(tab => tab.id === activeId)) {
          const fallback = next[next.length - 1]
          setActiveId(fallback.id)
        }
        return next
      })
    },
    [activeId],
  )

  const activate = useCallback((id: string) => setActiveId(id), [])

  const updateTabState = useCallback((id: string, updater: (prev: WorkspaceTabState) => WorkspaceTabState) => {
    setTabs(prev => prev.map(tab => (tab.id === id ? updater(tab) : tab)))
  }, [])

  const activeTab = useMemo(() => tabs.find(tab => tab.id === activeId) ?? tabs[0], [tabs, activeId])!
  const workspace = useWorkspaceData(activeTab)
  const getWorkspaceLabel = useCallback(
    (tab: WorkspaceTabState) => {
      const fallbackLabel = tab.title || t('workspace.tabDefault', { defaultValue: 'Workspace' })
      const entity = tab.selectedEntity
      if (!entity) return fallbackLabel

      const findById = (id?: string | null) => (id ? recordIndexes.byId.get(id) ?? null : null)
      const findByArk = (ark?: string | null) => (ark ? recordIndexes.byArk.get(ark) ?? null : null)

      if (entity.entityType === 'manifestation') {
        const record = findById(entity.id)
        if (record) {
          const label = manifestationTitle(record) || titleOf(record)
          return label || record.id
        }
        return entity.id
      }

      if (entity.entityType === 'work') {
        const record = findById(entity.id)
        if (record) {
          const label = titleOf(record)
          return label || record.id
        }
        return entity.id
      }

      if (entity.entityType === 'expression') {
        const expressionRecord = findById(entity.expressionId ?? entity.id)
        let workArk = entity.workArk ?? null
        if (!workArk && expressionRecord) {
          const candidates = expressionWorkArks(expressionRecord)
          if (candidates.length) workArk = candidates[0]
        }
        const workRecord = findByArk(workArk)
        if (workRecord) {
          const label = titleOf(workRecord)
          return label || workRecord.id
        }
        if (expressionRecord) {
          const label = titleOf(expressionRecord)
          return label || expressionRecord.id
        }
        return entity.expressionId ?? entity.id
      }

      const record = findById(entity.id)
      if (record) {
        const label = titleOf(record) || manifestationTitle(record)
        return label || record.id
      }
      return fallbackLabel
    },
    [recordIndexes, t],
  )

  const handleShortcutAction = useCallback(
    (action: ShortcutAction) => {
      if (action === 'focusUp') {
        updateTabState(activeTab.id, prev =>
          focusTreeUp(prev, {
            clusters,
            activeCluster: workspace.activeCluster,
            activeClusterSource: workspace.activeClusterSource,
            inventoryWork: workspace.inventoryWork,
            indexes: workspace.indexes,
            curatedRecords,
            originalRecords,
          }),
        )
        return
      }
      if (action === 'focusDown') {
        updateTabState(activeTab.id, prev =>
          focusTreeDown(prev, {
            clusters,
            activeCluster: workspace.activeCluster,
            activeClusterSource: workspace.activeClusterSource,
            inventoryWork: workspace.inventoryWork,
            indexes: workspace.indexes,
            curatedRecords,
            originalRecords,
          }),
        )
        return
      }
      if (action === 'nextWorkspace') {
        if (tabs.length <= 1) return
        const currentIndex = tabs.findIndex(tab => tab.id === activeTab.id)
        const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % tabs.length
        const nextTab = tabs[nextIndex]
        if (nextTab) setActiveId(nextTab.id)
        return
      }
      if (action === 'listUp' || action === 'listDown') {
        navigateList(action === 'listUp' ? 'up' : 'down', activeTab)
        return
      }
    },
    [
      activeTab,
      updateTabState,
      clusters,
      workspace.activeCluster,
      workspace.activeClusterSource,
      workspace.inventoryWork,
      workspace.indexes,
      curatedRecords,
      originalRecords,
      tabs,
      setActiveId,
    ],
  )

  const openEntityInNewTab = useCallback(
    (entity: SelectedEntity) => {
      const newTab = createTab(t('workspace.tabDefault', { defaultValue: 'Workspace' }))
      const configured = configureTabForEntity(newTab, entity, {
        clusters,
        recordIndexes,
        curatedRecords,
      })
      setTabs(prev => [...prev, configured])
      setActiveId(configured.id)
    },
    [clusters, recordIndexes, curatedRecords, t, setTabs, setActiveId],
  )

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (shortcutModalOpen) return
      if (event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      if (target) {
        const tagName = target.tagName
        if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return
        if (target.isContentEditable) return
      }
      const action = (Object.keys(bindings) as ShortcutAction[]).find(act => {
        const binding = bindings[act]
        return binding ? shortcutMatchesEvent(binding, event) : false
      })
      if (!action) return
      event.preventDefault()
      handleShortcutAction(action)
    }

    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [bindings, shortcutModalOpen, handleShortcutAction])

  return (
    <div className="workspace-tabs">
      <div className="workspace-tab-bar" role="tablist">
        {tabs.map(tab => (
          <WorkspaceTabButton
            key={tab.id}
            label={getWorkspaceLabel(tab)}
            isActive={tab.id === activeTab?.id}
            onActivate={() => activate(tab.id)}
            onClose={() => closeTab(tab.id)}
            closable={tabs.length > 1}
            closeLabel={t('workspace.closeTab', { defaultValue: 'Close tab' })}
          />
        ))}
        <button
          type="button"
          className="workspace-tab add"
          onClick={addTab}
          aria-label={t('workspace.addTab', { defaultValue: 'Add tab' })}
        >
          +
        </button>
      </div>
      <div className="workspace-tab-content" role="tabpanel">
        {activeTab ? (
          <WorkspaceView
            state={activeTab}
            onStateChange={updater => updateTabState(activeTab.id, updater)}
            onOpenWorkspaceTab={openEntityInNewTab}
          />
        ) : null}
      </div>
    </div>
  )
}

type WorkspaceTabButtonProps = {
  label: string
  isActive: boolean
  onActivate: () => void
  onClose: () => void
  closable: boolean
  closeLabel: string
}

function WorkspaceTabButton({ label, isActive, onActivate, onClose, closable, closeLabel }: WorkspaceTabButtonProps) {
  const decoratedLabel = useArkDecoratedText(label)

  return (
    <button
      type="button"
      className={`workspace-tab${isActive ? ' is-active' : ''}`}
      role="tab"
      aria-selected={isActive}
      title={decoratedLabel}
      onClick={onActivate}
    >
      <span className="workspace-tab__label">{decoratedLabel}</span>
      {closable ? (
        <span
          className="close"
          role="button"
          aria-label={closeLabel}
          onClick={event => {
            event.stopPropagation()
            onClose()
          }}
        >
          ×
        </span>
      ) : null}
    </button>
  )
}

type NavigationDirection = 'up' | 'down'

type WorkListEntry = {
  row: HTMLElement
  trigger: HTMLElement
  workId: string
  workArk: string
}

type ExpressionListEntry = {
  row: HTMLElement
  trigger: HTMLElement
  expressionId: string
  expressionArk: string
}

type ManifestationListEntry = {
  row: HTMLElement
  trigger: HTMLElement
  manifestationId: string
}

function navigateList(direction: NavigationDirection, state: WorkspaceTabState) {
  if (state.viewMode === 'works') {
    navigateWorkList(direction, state)
  } else if (state.viewMode === 'expressions') {
    navigateExpressionList(direction, state)
  } else if (state.viewMode === 'manifestations') {
    navigateManifestationList(direction, state)
  }
}

function navigateWorkList(direction: NavigationDirection, state: WorkspaceTabState) {
  if (typeof document === 'undefined') return
  const panel = document.querySelector('.work-list-panel')
  if (!panel) return
  const rows = Array.from(panel.querySelectorAll<HTMLElement>('.entity-row--work'))
  if (!rows.length) return

  const entries = rows
    .map(row => {
      const trigger =
        row.classList.contains('cluster-header-row') ? row.querySelector<HTMLElement>('.cluster-header') : row
      if (!trigger) return null
      return {
        row,
        trigger,
        workId: row.dataset.workId || '',
        workArk: row.dataset.workArk || '',
      }
    })
    .filter((entry): entry is WorkListEntry => !!entry && (!!entry.workId || !!entry.workArk))

  if (!entries.length) return

  const currentWorkId = state.selectedEntity?.entityType === 'work' ? state.selectedEntity.id : null
  const currentWorkArk =
    state.selectedEntity?.entityType === 'work'
      ? state.selectedEntity.workArk ?? null
      : state.highlightedWorkArk ?? null

  const currentIndex = entries.findIndex(entry => {
    if (currentWorkId && entry.workId === currentWorkId) return true
    if (currentWorkArk && entry.workArk === currentWorkArk) return true
    return false
  })

  const nextIndex = computeNextIndex(entries.length, currentIndex, direction)
  if (nextIndex === null) return
  activateEntry(entries[nextIndex])
}

function navigateExpressionList(direction: NavigationDirection, state: WorkspaceTabState) {
  if (typeof document === 'undefined') return
  const panel = document.querySelector('.expression-groups')
  if (!panel) return
  const rows = Array.from(panel.querySelectorAll<HTMLElement>('.entity-row--expression'))
  if (!rows.length) return

  const entries = rows
    .map(row => ({
      row,
      trigger: row,
      expressionId: row.dataset.expressionId || '',
      expressionArk: row.dataset.expressionArk || '',
    }))
    .filter((entry): entry is ExpressionListEntry => !!entry.expressionId || !!entry.expressionArk)

  if (!entries.length) return

  let currentExpressionId: string | null = null
  let currentExpressionArk: string | null = null
  const selected = state.selectedEntity
  if (selected?.entityType === 'expression') {
    currentExpressionId = selected.expressionId ?? selected.id
    currentExpressionArk = selected.expressionArk ?? null
  } else if (selected?.entityType === 'manifestation') {
    currentExpressionId = selected.expressionId ?? null
    currentExpressionArk = selected.expressionArk ?? null
  } else {
    currentExpressionArk = state.highlightedExpressionArk ?? null
  }

  const currentIndex = entries.findIndex(entry => {
    if (currentExpressionId && entry.expressionId === currentExpressionId) return true
    if (currentExpressionArk && entry.expressionArk === currentExpressionArk) return true
    return false
  })

  const nextIndex = computeNextIndex(entries.length, currentIndex, direction)
  if (nextIndex === null) return
  activateEntry(entries[nextIndex])
}

function navigateManifestationList(direction: NavigationDirection, state: WorkspaceTabState) {
  if (typeof document === 'undefined') return
  const panel = document.querySelector('.manifestation-panel')
  if (!panel) return
  const rows = Array.from(panel.querySelectorAll<HTMLElement>('.entity-row--manifestation'))
  if (!rows.length) return

  const entries = rows
    .map(row => {
      const trigger = row.querySelector<HTMLElement>('.manifestation-item__main') ?? row
      if (!trigger) return null
      return {
        row,
        trigger,
        manifestationId: row.dataset.manifestationId || '',
      }
    })
    .filter((entry): entry is ManifestationListEntry => !!entry && !!entry.manifestationId)

  if (!entries.length) return

  const currentId = state.selectedEntity?.entityType === 'manifestation' ? state.selectedEntity.id : null
  const currentIndex = currentId ? entries.findIndex(entry => entry.manifestationId === currentId) : -1
  const nextIndex = computeNextIndex(entries.length, currentIndex, direction)
  if (nextIndex === null) return
  activateEntry(entries[nextIndex])
}

function computeNextIndex(length: number, currentIndex: number, direction: NavigationDirection): number | null {
  if (!length) return null
  const delta = direction === 'down' ? 1 : -1
  let index = currentIndex
  if (index === -1) index = direction === 'down' ? -1 : length
  let next = index + delta
  if (next < 0) next = 0
  if (next >= length) next = length - 1
  if (currentIndex >= 0 && next === currentIndex) return null
  return next
}

function activateEntry(entry: { row: HTMLElement; trigger: HTMLElement }) {
  entry.trigger.click()
  if (entry.row.scrollIntoView) {
    entry.row.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
}
