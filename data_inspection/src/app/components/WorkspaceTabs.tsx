import { useCallback, useEffect, useMemo, useState } from 'react'
import { WorkspaceView } from './WorkspaceView'
import { SparqlWorkspaceView } from './SparqlWorkspaceView'
import type {
  WorkspaceTabState,
  WorkspaceTabStateWorkspace,
  AgentTabState,
  GlobalArkFilterState,
  ArkFilterPayload,
} from '../workspace/types'
import { createDefaultSparqlState, isSparqlTab, isWorkspaceTab, isAgentTab } from '../workspace/types'
import { useTranslation } from '../hooks/useTranslation'
import { useShortcuts } from '../providers'
import { useWorkspaceData } from '../workspace/useWorkspaceData'
import { useAppData } from '../providers'
import { manifestationTitle, titleOf, expressionWorkArks } from '../core/entities'
import { useDetachedWindows } from '../providers'
import { useToast } from '../providers'
import { labelFromRecord } from '../lib/intermarc'
import { AgentView } from '../agents/AgentView'
import { WorkspaceTabButton } from './workspaceTabs/WorkspaceTabButton'
import { DetachedTabPlaceholder } from './workspaceTabs/DetachedTabPlaceholder'
import { DetachedWorkspacePortal } from './workspaceTabs/DetachedWorkspacePortal'
import { DetachedAgentPortal } from './workspaceTabs/DetachedAgentPortal'
import { AddTabMenu } from './workspaceTabs/AddTabMenu'
import { useTabDetachment } from './workspaceTabs/useTabDetachment'
import { useWorkspaceTabShortcuts } from './workspaceTabs/useWorkspaceTabShortcuts'
import type { RecordRow } from '../types'
import { createAgentTab, createWorkspaceTab, nextTabId } from './workspaceTabs/tabFactories'
import { normalizeArkList } from '../lib/arkFilters'

type WorkspaceTabsProps = {
  shortcutModalOpen: boolean
}

export function WorkspaceTabs({ shortcutModalOpen }: WorkspaceTabsProps) {
  const { t } = useTranslation()
  const { bindings } = useShortcuts()
  const { clusters, curated, datasetId } = useAppData()
  const { openWindow, closeWindow, getContainer, isOpen, arrangeWindows } = useDetachedWindows()
  const { showToast } = useToast()
  const curatedRecords = useMemo(() => curated?.records ?? [], [curated])

  const defaultWorkspaceTitle = useMemo(
    () => t('workspace.tabDefault', { defaultValue: 'Workspace' }),
    [t],
  )
  const defaultSparqlTitle = useMemo(
    () => t('workspace.sparqlTabDefault', { defaultValue: 'SPARQL' }),
    [t],
  )
  const defaultAgentTitle = useMemo(
    () => t('workspace.agentsTabDefault', { defaultValue: 'Agents' }),
    [t],
  )
  const dockLabelInline = useMemo(
    () => t('workspace.redockTab', { defaultValue: 'Ramener l’onglet ici' }),
    [t],
  )
  const dockLabelDetached = useMemo(
    () => t('workspace.redockTabMainApp', { defaultValue: "Ramener l'onglet dans l'application centrale" }),
    [t],
  )

  const recordIndexes = useMemo(() => {
    const byId = new Map<string, RecordRow>()
    const byArk = new Map<string, RecordRow>()
    const addRecords = (records: RecordRow[]) => {
      for (const rec of records) {
        byId.set(rec.id, rec)
        if (rec.ark) byArk.set(rec.ark, rec)
      }
    }
    addRecords(curatedRecords)
    return { byId, byArk }
  }, [curatedRecords])

  const [pendingManifestationId, setPendingManifestationId] = useState<string | null>(null)
  const [arkFilter, setArkFilter] = useState<GlobalArkFilterState>({
    workArks: [],
    agentArks: [],
    source: null,
  })
  const [tabs, setTabs] = useState<WorkspaceTabState[]>(() => [createWorkspaceTab(defaultWorkspaceTitle)])
  const [activeId, setActiveId] = useState(() => tabs[0]?.id ?? '')
  const [shortcutTargetId, setShortcutTargetId] = useState(() => tabs[0]?.id ?? '')

  useEffect(() => {
    setArkFilter({ workArks: [], agentArks: [], source: null })
  }, [datasetId])

  const setActive = useCallback(
    (id: string) => {
      setActiveId(id)
      setShortcutTargetId(id)
    },
    [],
  )

  const addTab = useCallback(() => {
    const newTab = createWorkspaceTab(defaultWorkspaceTitle)
    setTabs(prev => [...prev, newTab])
    setActive(newTab.id)
  }, [defaultWorkspaceTitle, setActive])

  const addSparqlTab = useCallback(() => {
    const newTab = createDefaultSparqlState(nextTabId('tab'), defaultSparqlTitle)
    setTabs(prev => [...prev, newTab])
    setActive(newTab.id)
  }, [defaultSparqlTitle, setActive])

  const addAgentTab = useCallback(() => {
    const newTab = createAgentTab(defaultAgentTitle)
    setTabs(prev => [...prev, newTab])
    setActive(newTab.id)
  }, [defaultAgentTitle, setActive])

  const openTabWithState = useCallback(
    (initializer: (base: WorkspaceTabStateWorkspace) => WorkspaceTabStateWorkspace) => {
      const base = createWorkspaceTab(defaultWorkspaceTitle)
      const configured = initializer ? initializer(base) : base
      setTabs(prev => [...prev, configured])
      setActive(configured.id)
    },
    [defaultWorkspaceTitle, setActive],
  )

  const openAgentTabWithState = useCallback(
    (initializer: (base: AgentTabState) => AgentTabState) => {
      const base = createAgentTab(defaultAgentTitle)
      const configured = initializer ? initializer(base) : base
      setTabs(prev => [...prev, configured])
      setActive(configured.id)
    },
    [defaultAgentTitle, setActive],
  )

  const closeTab = useCallback(
    (id: string) => {
      const tabToClose = tabs.find(tab => tab.id === id)
      if (tabToClose && (isWorkspaceTab(tabToClose) || isAgentTab(tabToClose)) && tabToClose.detachedWindowId) {
        closeWindow(tabToClose.detachedWindowId)
      }
      setTabs(prev => {
        if (prev.length <= 1) return prev
        const next = prev.filter(tab => tab.id !== id)
        if (!next.some(isWorkspaceTab)) {
          const replacement = createWorkspaceTab(defaultWorkspaceTitle)
          next.push(replacement)
          if (!next.some(tab => tab.id === activeId)) {
            setActive(replacement.id)
          }
          return next
        }
        if (!next.some(tab => tab.id === activeId)) {
          const fallback = next[next.length - 1]
          setActive(fallback.id)
        }
        return next
      })
    },
    [activeId, closeWindow, defaultWorkspaceTitle, setActive, tabs],
  )

  const activate = useCallback((id: string) => setActive(id), [setActive])

  const updateTabState = useCallback(
    (id: string, updater: (prev: WorkspaceTabState) => WorkspaceTabState) => {
      setTabs(prev => prev.map(tab => (tab.id === id ? updater(tab) : tab)))
    },
    [],
  )

  const applyGlobalArkFilter = useCallback((payload: ArkFilterPayload) => {
    const workArks = normalizeArkList(payload.workArks)
    const agentArks = normalizeArkList(payload.agentArks)
    const hasAny = workArks.length || agentArks.length
    setArkFilter({
      workArks,
      agentArks,
      source: hasAny
        ? {
            tabId: payload.source.tabId,
            tabTitle: payload.source.tabTitle,
            workColumns: payload.source.workColumns,
            agentColumns: payload.source.agentColumns,
          }
        : null,
    })
  }, [])

  const clearWorkArkFilter = useCallback(() => {
    setArkFilter(prev => {
      const next = { ...prev, workArks: [] }
      if (!next.agentArks.length) {
        return { workArks: [], agentArks: [], source: null }
      }
      return next
    })
  }, [])

  const clearAgentArkFilter = useCallback(() => {
    setArkFilter(prev => {
      const next = { ...prev, agentArks: [] }
      if (!next.workArks.length) {
        return { workArks: [], agentArks: [], source: null }
      }
      return next
    })
  }, [])

  const activeTab = useMemo(() => tabs.find(tab => tab.id === activeId) ?? tabs[0], [tabs, activeId])!
  const shortcutTab = useMemo(
    () => tabs.find(tab => tab.id === shortcutTargetId) ?? activeTab,
    [activeTab, shortcutTargetId, tabs],
  )
  const fallbackWorkspace = useMemo(
    () => createWorkspaceTab(defaultWorkspaceTitle, '__fallback-workspace__'),
    [defaultWorkspaceTitle],
  )
  const firstWorkspaceTab = useMemo(
    () => tabs.find(isWorkspaceTab) ?? fallbackWorkspace,
    [tabs, fallbackWorkspace],
  )
  const workspaceSource = isWorkspaceTab(shortcutTab) ? shortcutTab : firstWorkspaceTab
  const workspace = useWorkspaceData(workspaceSource)

  const labelForTabRecord = useCallback((record: RecordRow | null) => {
    if (!record) return null
    const intermarcLabel = labelFromRecord(record)
    return intermarcLabel || titleOf(record) || manifestationTitle(record) || record.id
  }, [])

  const getWorkspaceLabel = useCallback(
    (tab: WorkspaceTabState) => {
      if (isSparqlTab(tab)) {
        const trimmed = tab.query.trim()
        if (trimmed.length) {
          const firstLine = trimmed.split(/\r?\n/, 1)[0]
          return firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine
        }
        return tab.title || defaultSparqlTitle
      }

      if (isAgentTab(tab)) {
        const entityId = tab.selectedAgentId
        const record = entityId ? recordIndexes.byId.get(entityId) ?? null : null
        const label = labelForTabRecord(record)
        if (label) return label
        return tab.title || defaultAgentTitle
      }

      const fallbackLabel = tab.title || defaultWorkspaceTitle
      const entity = tab.selectedEntity
      if (!entity) return fallbackLabel

      const findById = (id?: string | null) => (id ? recordIndexes.byId.get(id) ?? null : null)
      const findByArk = (ark?: string | null) => (ark ? recordIndexes.byArk.get(ark) ?? null : null)

      if (entity.entityType === 'manifestation') {
        const record = findById(entity.id)
        const label = labelForTabRecord(record)
        if (label) return label
        return entity.id
      }

      if (entity.entityType === 'work') {
        const record = findById(entity.id)
        const label = labelForTabRecord(record)
        if (label) return label
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
        const label = labelForTabRecord(workRecord) ?? labelForTabRecord(expressionRecord)
        if (label) return label
        return entity.expressionId ?? entity.id
      }

      const record = findById(entity.id)
      const label = labelForTabRecord(record)
      if (label) return label
      return fallbackLabel
    },
    [recordIndexes, defaultWorkspaceTitle, defaultSparqlTitle, labelForTabRecord, defaultAgentTitle],
  )

  const {
    openDetachedTabWithState,
    openAgentDetachedTabWithState,
    detachWorkspaceTab,
    dockWorkspaceTab,
    detachAgentTab,
    dockAgentTab,
  } = useTabDetachment({
    defaultWorkspaceTitle,
    defaultAgentTitle,
    getWorkspaceLabel,
    openWindow,
    closeWindow,
    isOpen,
    showToast,
    t,
    setTabs,
  })

  useWorkspaceTabShortcuts({
    bindings,
    shortcutModalOpen,
    activeId,
    tabs,
    shortcutTab,
    workspace,
    clusters,
    curatedRecords,
    setActive,
    setTabs,
    updateTabState,
    dockWorkspaceTab,
    detachWorkspaceTab,
    dockAgentTab,
    detachAgentTab,
    arrangeWindows,
    setShortcutTargetId,
    getContainer,
  })

  return (
    <div className="workspace-tabs">
      <div className="workspace-tab-row">
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
              detachStatus={isWorkspaceTab(tab) || isAgentTab(tab) ? tab.mode : undefined}
              onToggleDetach={
                isWorkspaceTab(tab)
                  ? () => (tab.mode === 'detached' ? dockWorkspaceTab(tab) : detachWorkspaceTab(tab))
                  : isAgentTab(tab)
                    ? () => (tab.mode === 'detached' ? dockAgentTab(tab) : detachAgentTab(tab))
                    : undefined
              }
              detachLabel={t('workspace.detachTab', { defaultValue: 'Open tab in new window' })}
              dockLabel={dockLabelInline}
            />
          ))}
        </div>
        <AddTabMenu
          onAddWorkspace={addTab}
          onAddAgent={addAgentTab}
          onAddSparql={addSparqlTab}
          label={t('workspace.addTab', { defaultValue: 'Add tab' })}
          workspaceLabel={t('workspace.tabDefault', { defaultValue: 'Workspace' })}
          agentLabel={t('workspace.agentsTabDefault', { defaultValue: 'Agents' })}
          sparqlLabel={t('workspace.sparqlTabDefault', { defaultValue: 'SPARQL' })}
        />
      </div>
      <div className="workspace-tab-content">
        {tabs.map(tab => {
          const isActive = tab.id === activeTab?.id
          return (
            <div
              key={tab.id}
              role="tabpanel"
              hidden={!isActive}
              aria-hidden={!isActive}
              className="workspace-tab-panel"
              data-tab-id={tab.id}
            >
              {isWorkspaceTab(tab) ? (
                tab.mode === 'detached' ? (
                  <DetachedTabPlaceholder
                    label={getWorkspaceLabel(tab)}
                    message={t('workspace.detachedPlaceholder', {
                      defaultValue: 'Cet onglet est affiché dans une autre fenêtre.',
                    })}
                    actionLabel={dockLabelInline}
                    onDock={() => dockWorkspaceTab(tab)}
                  />
                ) : (
                  <WorkspaceView
                    state={tab}
                    mode="inline"
                    onRequestDetach={() => detachWorkspaceTab(tab)}
                    onStateChange={updater =>
                      updateTabState(tab.id, prev => (isWorkspaceTab(prev) ? updater(prev) : prev))
                    }
                    onOpenTab={openTabWithState}
                    onOpenDetachedTab={openDetachedTabWithState}
                    onOpenAgentTab={openAgentTabWithState}
                    onOpenAgentDetachedTab={openAgentDetachedTabWithState}
                    sharedPendingManifestationId={pendingManifestationId}
                    setSharedPendingManifestationId={setPendingManifestationId}
                    workArkFilter={arkFilter.workArks.length ? arkFilter.workArks : null}
                    workArkFilterSource={
                      arkFilter.source && arkFilter.workArks.length ? arkFilter.source : null
                    }
                    onClearWorkArkFilter={clearWorkArkFilter}
                  />
                )
              ) : isSparqlTab(tab) ? (
                <SparqlWorkspaceView
                  state={tab}
                  onStateChange={updater =>
                    updateTabState(tab.id, prev => (isSparqlTab(prev) ? updater(prev) : prev))
                  }
                  onOpenWorkspaceTab={openTabWithState}
                  onOpenWorkspaceTabDetached={openDetachedTabWithState}
                  onOpenAgentTab={openAgentTabWithState}
                  onOpenAgentTabDetached={openAgentDetachedTabWithState}
                  onApplyArkFilter={applyGlobalArkFilter}
                />
              ) : isAgentTab(tab) ? (
                tab.mode === 'detached' ? (
                  <DetachedTabPlaceholder
                    label={getWorkspaceLabel(tab)}
                    message={t('workspace.detachedPlaceholder', {
                      defaultValue: 'Cet onglet est affiché dans une autre fenêtre.',
                    })}
                    actionLabel={dockLabelInline}
                    onDock={() => dockAgentTab(tab)}
                  />
                ) : (
                  <AgentView
                    state={tab}
                    mode="inline"
                    onRequestDetach={() => detachAgentTab(tab)}
                    onStateChange={updater =>
                      updateTabState(tab.id, prev => (isAgentTab(prev) ? updater(prev) : prev))
                    }
                    onOpenTab={openTabWithState}
                    onOpenAgentTab={openAgentTabWithState}
                    onOpenAgentTabDetached={openAgentDetachedTabWithState}
                    agentArkFilter={arkFilter.agentArks.length ? arkFilter.agentArks : null}
                    agentArkFilterSource={
                      arkFilter.source && arkFilter.agentArks.length ? arkFilter.source : null
                    }
                    onClearAgentArkFilter={clearAgentArkFilter}
                  />
                )
              ) : null}
            </div>
          )
        })}
      </div>
      {tabs
        .filter(isWorkspaceTab)
        .map(tab =>
          tab.mode === 'detached' && tab.detachedWindowId
            ? (
              <DetachedWorkspacePortal
                key={tab.detachedWindowId}
                tab={tab}
                container={getContainer(tab.detachedWindowId)}
                onDock={() => dockWorkspaceTab(tab)}
                dockLabel={dockLabelDetached}
                onStateChange={updater =>
                  updateTabState(tab.id, prev => (isWorkspaceTab(prev) ? updater(prev) : prev))
                }
                onOpenTab={openTabWithState}
                onOpenDetachedTab={openDetachedTabWithState}
                onOpenAgentTab={openAgentTabWithState}
                onOpenAgentDetachedTab={openAgentDetachedTabWithState}
                sharedPendingManifestationId={pendingManifestationId}
                setSharedPendingManifestationId={setPendingManifestationId}
                workArkFilter={arkFilter.workArks.length ? arkFilter.workArks : null}
                workArkFilterSource={
                  arkFilter.source && arkFilter.workArks.length ? arkFilter.source : null
                }
                onClearWorkArkFilter={clearWorkArkFilter}
              />
            )
            : null,
        )}
      {tabs
        .filter(isAgentTab)
        .map(tab =>
          tab.mode === 'detached' && tab.detachedWindowId
            ? (
              <DetachedAgentPortal
                key={tab.detachedWindowId}
                tab={tab}
                container={getContainer(tab.detachedWindowId)}
                onDock={() => dockAgentTab(tab)}
                dockLabel={dockLabelDetached}
                onStateChange={updater => updateTabState(tab.id, prev => (isAgentTab(prev) ? updater(prev) : prev))}
                onOpenTab={openTabWithState}
                onOpenAgentTab={openAgentTabWithState}
                onOpenAgentTabDetached={openAgentDetachedTabWithState}
                agentArkFilter={arkFilter.agentArks.length ? arkFilter.agentArks : null}
                agentArkFilterSource={
                  arkFilter.source && arkFilter.agentArks.length ? arkFilter.source : null
                }
                onClearAgentArkFilter={clearAgentArkFilter}
              />
            )
            : null,
        )}
    </div>
  )
}
