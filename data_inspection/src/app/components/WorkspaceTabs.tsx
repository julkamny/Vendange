import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { WorkspaceView } from './WorkspaceView'
import { SparqlWorkspaceView } from './SparqlWorkspaceView'
import type { WorkspaceTabState, WorkspaceTabStateWorkspace, AgentTabState } from '../workspace/types'
import type { RecordRow } from '../types'
import {
  DEFAULT_WORKSPACE_STATE,
  DEFAULT_AGENT_STATE,
  createDefaultSparqlState,
  isSparqlTab,
  isWorkspaceTab,
  isAgentTab,
  isWorkspaceLayoutTab,
} from '../workspace/types'
import { useTranslation } from '../hooks/useTranslation'
import { useShortcuts } from '../providers'
import { shortcutMatchesEvent, type ShortcutAction } from '../core/shortcuts'
import { useWorkspaceData } from '../workspace/useWorkspaceData'
import { useAppData } from '../providers'
import { focusTreeUp, focusTreeDown } from '../workspace/shortcutActions'
import { manifestationTitle, titleOf, expressionWorkArks } from '../core/entities'
import { useArkDecoratedText } from '../hooks/useArkDecoratedText'
import { useDetachedWindows } from '../providers'
import { useToast } from '../providers'
import { buildLabelFromIntermarc } from '../lib/intermarc'
import { AgentView } from '../agents/AgentView'

let tabSequence = 0

function createWorkspaceTab(title: string, explicitId?: string): WorkspaceTabStateWorkspace {
  const id = explicitId ?? `tab-${++tabSequence}`
  return {
    ...DEFAULT_WORKSPACE_STATE,
    id,
    title,
  }
}

function createAgentTab(title: string, explicitId?: string): AgentTabState {
  const id = explicitId ?? `agent-${++tabSequence}`
  return {
    ...DEFAULT_AGENT_STATE,
    id,
    title,
  }
}

type WorkspaceTabsProps = {
  shortcutModalOpen: boolean
}

export function WorkspaceTabs({ shortcutModalOpen }: WorkspaceTabsProps) {
  const { t } = useTranslation()
  const { bindings } = useShortcuts()
  const { clusters, curated } = useAppData()
  const { openWindow, closeWindow, getContainer, isOpen, arrangeWindows } = useDetachedWindows()
  const { showToast } = useToast()
  const curatedRecords = useMemo(() => curated?.records ?? [], [curated])
  const defaultWorkspaceTitle = useMemo(
    () => t('workspace.tabDefault', { defaultValue: 'Workspace' }),
    [t],
  )
  const defaultSparqlTitle = useMemo(() => t('workspace.sparqlTabDefault', { defaultValue: 'SPARQL' }), [t])
  const defaultAgentTitle = useMemo(() => t('workspace.agentsTabDefault', { defaultValue: 'Agents' }), [t])
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
  const [tabs, setTabs] = useState<WorkspaceTabState[]>(() => [createWorkspaceTab(defaultWorkspaceTitle)])
  const [activeId, setActiveId] = useState(() => tabs[0]?.id ?? '')
  const [shortcutTargetId, setShortcutTargetId] = useState(() => tabs[0]?.id ?? '')
  const setActive = useCallback(
    (id: string) => {
      setActiveId(id)
      setShortcutTargetId(id)
    },
    [setActiveId, setShortcutTargetId],
  )

  const addTab = useCallback(() => {
    const newTab = createWorkspaceTab(defaultWorkspaceTitle)
    setTabs(prev => [...prev, newTab])
    setActive(newTab.id)
  }, [defaultWorkspaceTitle, setActive])

  const addSparqlTab = useCallback(() => {
    const newTab = createDefaultSparqlState(`tab-${++tabSequence}`, defaultSparqlTitle)
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

  const updateTabState = useCallback((id: string, updater: (prev: WorkspaceTabState) => WorkspaceTabState) => {
    setTabs(prev => prev.map(tab => (tab.id === id ? updater(tab) : tab)))
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
  const labelFromRecord = useCallback(
    (record: RecordRow | null) => {
      if (!record) return null
      const intermarcLabel = buildLabelFromIntermarc(record.intermarc, record.type)
      return intermarcLabel || titleOf(record) || manifestationTitle(record) || record.id
    },
    [],
  )

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
        const label = labelFromRecord(record)
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
        const label = labelFromRecord(record)
        if (label) return label
        return entity.id
      }

      if (entity.entityType === 'work') {
        const record = findById(entity.id)
        const label = labelFromRecord(record)
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
        const label = labelFromRecord(workRecord) ?? labelFromRecord(expressionRecord)
        if (label) return label
        return entity.expressionId ?? entity.id
      }

      const record = findById(entity.id)
      const label = labelFromRecord(record)
      if (label) return label
      return fallbackLabel
    },
    [recordIndexes, defaultWorkspaceTitle, defaultSparqlTitle, labelFromRecord, defaultAgentTitle],
  )

  const openDetachedTabWithState = useCallback(
    (initializer: (base: WorkspaceTabStateWorkspace) => WorkspaceTabStateWorkspace) => {
      const base = createWorkspaceTab(defaultWorkspaceTitle)
      const configured = initializer ? initializer(base) : base
      const windowId = openWindow({
        title: getWorkspaceLabel(configured),
        classNames: ['vendange-detached-window'],
        onClose: () => {
          setTabs(prev =>
            prev.map(entry =>
              entry.id === configured.id && isWorkspaceTab(entry)
                ? { ...entry, mode: 'inline', detachedWindowId: null }
                : entry,
            ),
          )
        },
      })
      if (!windowId) {
        showToast(t('workspace.openWindowFailed', { defaultValue: 'Impossible d’ouvrir une nouvelle fenêtre.' }), {
          tone: 'error',
        })
        setTabs(prev => [...prev, configured])
        setActive(configured.id)
        return
      }
      const detachedState: WorkspaceTabStateWorkspace = {
        ...configured,
        mode: 'detached',
        detachedWindowId: windowId,
        intermarcFullView: true,
      }
      setTabs(prev => [...prev, detachedState])
      setActive(detachedState.id)
    },
    [defaultWorkspaceTitle, getWorkspaceLabel, openWindow, setActive, setTabs, showToast, t],
  )

  const openAgentDetachedTabWithState = useCallback(
    (initializer: (base: AgentTabState) => AgentTabState) => {
      const base = createAgentTab(defaultAgentTitle)
      const configured = initializer ? initializer(base) : base
      const windowId = openWindow({
        title: getWorkspaceLabel(configured),
        classNames: ['vendange-detached-window'],
        onClose: () => {
          setTabs(prev =>
            prev.map(entry =>
              entry.id === configured.id && isAgentTab(entry)
                ? { ...entry, mode: 'inline', detachedWindowId: null }
                : entry,
            ),
          )
        },
      })
      if (!windowId) {
        showToast(t('workspace.openWindowFailed', { defaultValue: 'Impossible d’ouvrir une nouvelle fenêtre.' }), {
          tone: 'error',
        })
        setTabs(prev => [...prev, configured])
        setActive(configured.id)
        return
      }
      const detachedState: AgentTabState = {
        ...configured,
        mode: 'detached',
        detachedWindowId: windowId,
        intermarcFullView: true,
      }
      setTabs(prev => [...prev, detachedState])
      setActive(detachedState.id)
    },
    [defaultAgentTitle, getWorkspaceLabel, openWindow, setActive, setTabs, showToast, t],
  )

  const detachWorkspaceTab = useCallback(
    (tab: WorkspaceTabStateWorkspace) => {
      if (tab.mode === 'detached') return
      const windowId = openWindow({
        title: getWorkspaceLabel(tab),
        classNames: ['vendange-detached-window'],
        onClose: () => {
          setTabs(prev =>
            prev.map(entry =>
              entry.id === tab.id && isWorkspaceTab(entry)
                ? { ...entry, mode: 'inline', detachedWindowId: null }
                : entry,
            ),
          )
        },
      })
      if (!windowId) {
        showToast(t('workspace.openWindowFailed', { defaultValue: 'Impossible d’ouvrir une nouvelle fenêtre.' }), {
          tone: 'error',
        })
        return
      }
      setTabs(prev =>
        prev.map(entry =>
          entry.id === tab.id && isWorkspaceTab(entry)
            ? { ...entry, mode: 'detached', detachedWindowId: windowId, intermarcFullView: true }
            : entry,
        ),
      )
      setActive(tab.id)
    },
    [getWorkspaceLabel, openWindow, setActive, setTabs, showToast, t],
  )

  const dockWorkspaceTab = useCallback(
    (tab: WorkspaceTabStateWorkspace) => {
      if (tab.mode !== 'detached' || !tab.detachedWindowId) return
      if (isOpen(tab.detachedWindowId)) {
        closeWindow(tab.detachedWindowId)
      } else {
        setTabs(prev =>
          prev.map(entry =>
            entry.id === tab.id && isWorkspaceTab(entry)
              ? { ...entry, mode: 'inline', detachedWindowId: null }
              : entry,
          ),
        )
      }
    },
    [closeWindow, isOpen, setTabs],
  )

  const detachAgentTab = useCallback(
    (tab: AgentTabState) => {
      if (tab.mode === 'detached') return
      const windowId = openWindow({
        title: getWorkspaceLabel(tab),
        classNames: ['vendange-detached-window'],
        onClose: () => {
          setTabs(prev =>
            prev.map(entry =>
              entry.id === tab.id && isAgentTab(entry)
                ? { ...entry, mode: 'inline', detachedWindowId: null }
                : entry,
            ),
          )
        },
      })
      if (!windowId) {
        showToast(t('workspace.openWindowFailed', { defaultValue: 'Impossible d’ouvrir une nouvelle fenêtre.' }), {
          tone: 'error',
        })
        return
      }
      setTabs(prev =>
        prev.map(entry =>
          entry.id === tab.id && isAgentTab(entry)
            ? { ...entry, mode: 'detached', detachedWindowId: windowId, intermarcFullView: true }
            : entry,
        ),
      )
      setActive(tab.id)
    },
    [getWorkspaceLabel, openWindow, setActive, setTabs, showToast, t],
  )

  const dockAgentTab = useCallback(
    (tab: AgentTabState) => {
      if (tab.mode !== 'detached' || !tab.detachedWindowId) return
      if (isOpen(tab.detachedWindowId)) {
        closeWindow(tab.detachedWindowId)
      } else {
        setTabs(prev =>
          prev.map(entry =>
            entry.id === tab.id && isAgentTab(entry)
              ? { ...entry, mode: 'inline', detachedWindowId: null }
              : entry,
          ),
        )
      }
    },
    [closeWindow, isOpen, setTabs],
  )

  const handleShortcutAction = useCallback(
    (action: ShortcutAction, sourceDocument: Document = document) => {
      const targetTab = shortcutTab
      const targetIsWorkspace = isWorkspaceTab(targetTab)
      const targetIsAgent = isAgentTab(targetTab)

      if (action === 'focusUp' && targetIsWorkspace) {
        updateTabState(targetTab.id, prev =>
          isWorkspaceTab(prev)
            ? focusTreeUp(prev, {
              clusters,
              activeCluster: workspace.activeCluster,
              activeClusterSource: workspace.activeClusterSource,
              inventoryWork: workspace.inventoryWork,
              indexes: workspace.indexes,
              curatedRecords,
            })
            : prev,
        )
        return
      }

      if (action === 'focusDown' && targetIsWorkspace) {
        updateTabState(targetTab.id, prev =>
          isWorkspaceTab(prev)
            ? focusTreeDown(prev, {
              clusters,
              activeCluster: workspace.activeCluster,
              activeClusterSource: workspace.activeClusterSource,
              inventoryWork: workspace.inventoryWork,
              indexes: workspace.indexes,
              curatedRecords,
            })
            : prev,
        )
        return
      }

      if (action === 'nextWorkspace' || action === 'previousWorkspace') {
        if (tabs.length <= 1) return
        const currentIndex = tabs.findIndex(tab => tab.id === targetTab.id)
        const delta = action === 'nextWorkspace' ? 1 : -1
        const nextIndex =
          currentIndex === -1
            ? 0
            : action === 'nextWorkspace'
              ? (currentIndex + delta) % tabs.length
              : currentIndex + delta < 0
                ? tabs.length - 1
                : currentIndex + delta
        const nextTab = tabs[nextIndex]
        if (nextTab) setActive(nextTab.id)
        return
      }

      if (action === 'listUp' || action === 'listDown') {
        if (targetIsWorkspace) {
          navigateList(action === 'listUp' ? 'up' : 'down', targetTab, sourceDocument)
        } else if (targetIsAgent) {
          navigateAgentList(action === 'listUp' ? 'up' : 'down', targetTab, setTabs, sourceDocument)
        }
        return
      }

      if (action === 'toggleBacklinks') {
        updateTabState(targetTab.id, prev => {
          if (!isWorkspaceLayoutTab(prev)) return prev
          const next = !prev.backlinksExpanded
          return {
            ...prev,
            backlinksExpanded: next,
            intermarcFullView: next && prev.intermarcFullView ? false : prev.intermarcFullView,
          }
        })
        return
      }

      if (action === 'toggleList') {
        updateTabState(targetTab.id, prev => {
          if (!isWorkspaceLayoutTab(prev)) return prev
          const next = !prev.listCollapsed
          return {
            ...prev,
            listCollapsed: next,
            intermarcFullView: next && prev.intermarcFullView ? false : prev.intermarcFullView,
          }
        })
        return
      }

      if (action === 'toggleIntermarc') {
        updateTabState(targetTab.id, prev => {
          if (!isWorkspaceLayoutTab(prev)) return prev
          const next = !prev.intermarcFullView
          return {
            ...prev,
            intermarcFullView: next,
            backlinksExpanded: next ? false : prev.backlinksExpanded,
          }
        })
        return
      }

      if (action === 'toggleDetachTab') {
        if (targetIsWorkspace) {
          if (targetTab.mode === 'detached') {
            dockWorkspaceTab(targetTab)
          } else {
            detachWorkspaceTab(targetTab)
          }
        } else if (targetIsAgent) {
          if (targetTab.mode === 'detached') {
            dockAgentTab(targetTab)
          } else {
            detachAgentTab(targetTab)
          }
        }
        return
      }

      if (action === 'arrangeTile') {
        arrangeWindows('tile')
        return
      }

      if (action === 'arrangeCascade') {
        arrangeWindows('cascade')
        return
      }
    },
    [
      arrangeWindows,
      clusters,
      curatedRecords,
      detachAgentTab,
      detachWorkspaceTab,
      dockAgentTab,
      dockWorkspaceTab,
      setActive,
      setTabs,
      shortcutTab,
      tabs,
      updateTabState,
      workspace.activeCluster,
      workspace.activeClusterSource,
      workspace.indexes,
      workspace.inventoryWork,
    ],
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
      const eventDocument = (event.target as Node | null)?.ownerDocument ?? event.view?.document ?? document
      handleShortcutAction(action, eventDocument)
    }

    const targets = new Set<Window>()
    const focusHandlers: Array<{ win: Window; handler: () => void }> = []
    targets.add(window)
    const mainFocusHandler = () => setShortcutTargetId(activeId)
    window.addEventListener('focus', mainFocusHandler)
    tabs.forEach(tab => {
      if (!isWorkspaceLayoutTab(tab)) return
      if (!tab.detachedWindowId) return
      const container = getContainer(tab.detachedWindowId)
      const win = container?.ownerDocument?.defaultView
      if (!win) return
      targets.add(win)
      const handler = () => setShortcutTargetId(tab.id)
      focusHandlers.push({ win, handler })
      win.addEventListener('focus', handler)
    })

    targets.forEach(win => win.addEventListener('keydown', handleKeydown))
    return () => {
      window.removeEventListener('focus', mainFocusHandler)
      targets.forEach(win => win.removeEventListener('keydown', handleKeydown))
      focusHandlers.forEach(({ win, handler }) => win.removeEventListener('focus', handler))
    }
  }, [activeId, bindings, getContainer, handleShortcutAction, setShortcutTargetId, shortcutModalOpen, tabs])

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
              dockLabel={t('workspace.redockTab', { defaultValue: 'Bring tab back here' })}
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
      <div className="workspace-tab-content" role="tabpanel">
        {activeTab ? (
          isWorkspaceTab(activeTab) ? (
            activeTab.mode === 'detached' ? (
              <DetachedTabPlaceholder
                label={getWorkspaceLabel(activeTab)}
                message={t('workspace.detachedPlaceholder', {
                  defaultValue: 'Cet onglet est affiché dans une autre fenêtre.',
                })}
                actionLabel={t('workspace.redockTab', { defaultValue: 'Ramener l’onglet ici' })}
                onDock={() => dockWorkspaceTab(activeTab)}
              />
            ) : (
              <WorkspaceView
                state={activeTab}
                mode="inline"
                onRequestDetach={() => detachWorkspaceTab(activeTab)}
                onStateChange={updater =>
                  updateTabState(activeTab.id, prev =>
                    isWorkspaceTab(prev) ? updater(prev) : prev,
                  )
                }
                onOpenTab={openTabWithState}
                onOpenDetachedTab={openDetachedTabWithState}
                onOpenAgentTab={openAgentTabWithState}
                onOpenAgentDetachedTab={openAgentDetachedTabWithState}
              />
            )
          ) : isSparqlTab(activeTab) ? (
            <SparqlWorkspaceView
              state={activeTab}
              onStateChange={updater =>
                updateTabState(activeTab.id, prev =>
                  isSparqlTab(prev) ? updater(prev) : prev,
                )
              }
              onOpenWorkspaceTab={openTabWithState}
              onOpenWorkspaceTabDetached={openDetachedTabWithState}
              onOpenAgentTab={openAgentTabWithState}
              onOpenAgentTabDetached={openAgentDetachedTabWithState}
            />
          ) : isAgentTab(activeTab) ? (
            activeTab.mode === 'detached' ? (
              <DetachedTabPlaceholder
                label={getWorkspaceLabel(activeTab)}
                message={t('workspace.detachedPlaceholder', {
                  defaultValue: 'Cet onglet est affiché dans une autre fenêtre.',
                })}
                actionLabel={t('workspace.redockTab', { defaultValue: 'Ramener l’onglet ici' })}
                onDock={() => dockAgentTab(activeTab)}
              />
            ) : (
              <AgentView
                state={activeTab}
                mode="inline"
                onRequestDetach={() => detachAgentTab(activeTab)}
                onStateChange={updater =>
                  updateTabState(activeTab.id, prev => (isAgentTab(prev) ? updater(prev) : prev))
                }
                onOpenTab={openTabWithState}
                onOpenAgentTab={openAgentTabWithState}
                onOpenAgentTabDetached={openAgentDetachedTabWithState}
              />
            )
          ) : null
        ) : null}
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
                dockLabel={t('workspace.redockTab', { defaultValue: 'Ramener l’onglet ici' })}
                label={getWorkspaceLabel(tab)}
                onStateChange={updater =>
                  updateTabState(tab.id, prev =>
                    isWorkspaceTab(prev) ? updater(prev) : prev,
                  )
                }
                onOpenTab={openTabWithState}
                onOpenDetachedTab={openDetachedTabWithState}
                onOpenAgentTab={openAgentTabWithState}
                onOpenAgentDetachedTab={openAgentDetachedTabWithState}
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
                dockLabel={t('workspace.redockTab', { defaultValue: 'Ramener l’onglet ici' })}
                label={getWorkspaceLabel(tab)}
                onStateChange={updater =>
                  updateTabState(tab.id, prev => (isAgentTab(prev) ? updater(prev) : prev))
                }
                onOpenTab={openTabWithState}
                onOpenAgentTab={openAgentTabWithState}
                onOpenAgentTabDetached={openAgentDetachedTabWithState}
              />
            )
            : null,
        )}
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
  detachStatus?: 'inline' | 'detached'
  onToggleDetach?: () => void
  detachLabel?: string
  dockLabel?: string
}

function WorkspaceTabButton({
  label,
  isActive,
  onActivate,
  onClose,
  closable,
  closeLabel,
  detachStatus,
  onToggleDetach,
  detachLabel,
  dockLabel,
}: WorkspaceTabButtonProps) {
  const decoratedLabel = useArkDecoratedText(label)
  const toggleLabel = detachStatus === 'detached' ? dockLabel ?? detachLabel : detachLabel

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onActivate()
    }
  }

  return (
    <div
      className={`workspace-tab${isActive ? ' is-active' : ''}`}
      role="tab"
      aria-selected={isActive}
      title={decoratedLabel}
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={handleKeyDown}
    >
      <span className="workspace-tab__label">{decoratedLabel}</span>
      {onToggleDetach && toggleLabel ? (
        <button
          type="button"
          className={`detach${detachStatus === 'detached' ? ' is-active' : ''}`}
          aria-label={toggleLabel}
          onClick={event => {
            event.stopPropagation()
            onToggleDetach()
          }}
        >
          {detachStatus === 'detached' ? '⬅' : '⤢'}
        </button>
      ) : null}
      {closable ? (
        <button
          type="button"
          className="close"
          aria-label={closeLabel}
          onClick={event => {
            event.stopPropagation()
            onClose()
          }}
        >
          ×
        </button>
      ) : null}
    </div>
  )
}

type DetachedTabPlaceholderProps = {
  label: string
  message: string
  actionLabel: string
  onDock: () => void
}

function DetachedTabPlaceholder({ label, message, actionLabel, onDock }: DetachedTabPlaceholderProps) {
  const decoratedLabel = useArkDecoratedText(label)
  return (
    <div className="detached-tab-placeholder">
      <p>{message}</p>
      <p className="detached-tab-placeholder__label">{decoratedLabel}</p>
      <button type="button" onClick={onDock}>
        {actionLabel}
      </button>
    </div>
  )
}

type DetachedWorkspacePortalProps = {
  tab: WorkspaceTabStateWorkspace
  container: HTMLDivElement | null
  label: string
  dockLabel: string
  onDock: () => void
  onStateChange: (updater: (prev: WorkspaceTabStateWorkspace) => WorkspaceTabStateWorkspace) => void
  onOpenTab: (initializer: (base: WorkspaceTabStateWorkspace) => WorkspaceTabStateWorkspace) => void
  onOpenDetachedTab: (initializer: (base: WorkspaceTabStateWorkspace) => WorkspaceTabStateWorkspace) => void
  onOpenAgentTab: (initializer: (base: AgentTabState) => AgentTabState) => void
  onOpenAgentDetachedTab: (initializer: (base: AgentTabState) => AgentTabState) => void
}

function DetachedWorkspacePortal({
  tab,
  container,
  label,
  dockLabel,
  onDock,
  onStateChange,
  onOpenTab,
  onOpenDetachedTab,
  onOpenAgentTab,
  onOpenAgentDetachedTab,
}: DetachedWorkspacePortalProps) {
  if (!container) return null
  return createPortal(
    <div className="detached-workspace-shell">
      <header className="detached-workspace-shell__header">
        <span>{label}</span>
        <button type="button" onClick={onDock}>
          {dockLabel}
        </button>
      </header>
      <WorkspaceView
        state={tab}
        mode="detached"
        onRequestDock={onDock}
        onStateChange={onStateChange}
        onOpenTab={onOpenTab}
        onOpenDetachedTab={onOpenDetachedTab}
        onOpenAgentTab={onOpenAgentTab}
        onOpenAgentDetachedTab={onOpenAgentDetachedTab}
      />
    </div>,
    container,
  )
}

type DetachedAgentPortalProps = {
  tab: AgentTabState
  container: HTMLDivElement | null
  label: string
  dockLabel: string
  onDock: () => void
  onStateChange: (updater: (prev: AgentTabState) => AgentTabState) => void
  onOpenTab: (initializer: (base: WorkspaceTabStateWorkspace) => WorkspaceTabStateWorkspace) => void
  onOpenAgentTab: (initializer: (base: AgentTabState) => AgentTabState) => void
  onOpenAgentTabDetached: (initializer: (base: AgentTabState) => AgentTabState) => void
}

function DetachedAgentPortal({
  tab,
  container,
  label,
  dockLabel,
  onDock,
  onStateChange,
  onOpenTab,
  onOpenAgentTab,
  onOpenAgentTabDetached,
}: DetachedAgentPortalProps) {
  if (!container) return null
  return createPortal(
    <div className="detached-workspace-shell">
      <header className="detached-workspace-shell__header">
        <span>{label}</span>
        <button type="button" onClick={onDock}>
          {dockLabel}
        </button>
      </header>
      <AgentView
        state={tab}
        mode="detached"
        onRequestDock={onDock}
        onStateChange={onStateChange}
        onOpenTab={onOpenTab}
        onOpenAgentTab={onOpenAgentTab}
        onOpenAgentTabDetached={onOpenAgentTabDetached}
      />
    </div>,
    container,
  )
}

type AddTabMenuProps = {
  onAddWorkspace: () => void
  onAddAgent: () => void
  onAddSparql: () => void
  label: string
  workspaceLabel: string
  agentLabel: string
  sparqlLabel: string
}

function AddTabMenu({ onAddWorkspace, onAddAgent, onAddSparql, label, workspaceLabel, agentLabel, sparqlLabel }: AddTabMenuProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const toggleRef = useRef<HTMLButtonElement | null>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const menuItems = useMemo(
    () => [
      { label: workspaceLabel, action: onAddWorkspace },
      { label: agentLabel, action: onAddAgent },
      { label: sparqlLabel, action: onAddSparql },
    ],
    [workspaceLabel, onAddWorkspace, agentLabel, onAddAgent, sparqlLabel, onAddSparql],
  )

  const closeMenu = useCallback(() => setOpen(false), [])

  const focusItem = useCallback((index: number) => {
    const el = itemRefs.current[index]
    if (el) el.focus()
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const handlePointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current) return
      if (!wrapperRef.current.contains(event.target as Node)) {
        closeMenu()
      }
    }
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMenu()
        toggleRef.current?.focus()
      }
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeydown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeydown)
    }
  }, [closeMenu, open])

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => {
      focusItem(0)
    })
  }, [focusItem, open])

  const handleToggleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setOpen(true)
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu()
    }
  }

  const handleItemKeyDown = (index: number, total: number) => (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const lastIndex = total - 1
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusItem(index === lastIndex ? 0 : index + 1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusItem(index === 0 ? lastIndex : index - 1)
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      focusItem(0)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      focusItem(lastIndex)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu()
      toggleRef.current?.focus()
      return
    }
    if (event.key === 'Tab') {
      closeMenu()
    }
  }

  const handleSelect = (action: () => void) => {
    closeMenu()
    action()
  }

  return (
    <div className="workspace-tab add menu" ref={wrapperRef}>
      <button
        type="button"
        className="workspace-tab add add-toggle workspace-add-toggle"
        onClick={() => setOpen(prev => !prev)}
        onKeyDown={handleToggleKeyDown}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls="workspace-add-menu"
        ref={toggleRef}
      >
        <span aria-hidden className="workspace-add-toggle__icon">+</span>
      </button>
      {open ? (
        <div className="workspace-add-menu" role="menu" id="workspace-add-menu">
          {menuItems.map((item, index) => (
            <button
              key={item.label}
              type="button"
              className="workspace-add-menu__item"
              role="menuitem"
              onClick={() => handleSelect(item.action)}
              onKeyDown={handleItemKeyDown(index, menuItems.length)}
              ref={el => {
                itemRefs.current[index] = el
              }}
            >
              <span className="workspace-add-menu__label">{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
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

type AgentListEntry = {
  row: HTMLElement
  trigger: HTMLElement
  agentId: string
}

function navigateList(direction: NavigationDirection, state: WorkspaceTabStateWorkspace, rootDocument: Document) {
  if (state.viewMode === 'works') {
    navigateWorkList(direction, state, rootDocument)
  } else if (state.viewMode === 'expressions') {
    navigateExpressionList(direction, state, rootDocument)
  } else if (state.viewMode === 'manifestations') {
    navigateManifestationList(direction, state, rootDocument)
  }
}

function navigateAgentList(
  direction: NavigationDirection,
  state: AgentTabState,
  setTabs: (updater: (prev: WorkspaceTabState[]) => WorkspaceTabState[]) => void,
  rootDocument: Document,
) {
  if (typeof document === 'undefined') return
  const panel = rootDocument.querySelector('.work-list-panel')
  if (!panel) return
  const rows = Array.from(panel.querySelectorAll<HTMLElement>('.entity-row'))
  if (!rows.length) return

  const entries: AgentListEntry[] = rows
    .map(row => {
      const trigger = row
      const agentId = row.dataset.agentId || ''
      if (!agentId) return null
      return { row, trigger, agentId }
    })
    .filter((entry): entry is AgentListEntry => !!entry && !!entry.agentId)

  if (!entries.length) return

  const currentId = state.selectedAgentId
  const currentIndex = currentId ? entries.findIndex(entry => entry.agentId === currentId) : -1
  const nextIndex = computeNextIndex(entries.length, currentIndex, direction)
  if (nextIndex === null) return
  const target = entries[nextIndex]
  activateEntry(target)
  setTabs(prev =>
    prev.map(tab => (isAgentTab(tab) && tab.id === state.id ? { ...tab, selectedAgentId: target.agentId } : tab)),
  )
}

function navigateWorkList(direction: NavigationDirection, state: WorkspaceTabStateWorkspace, rootDocument: Document) {
  if (typeof document === 'undefined') return
  const panel = rootDocument.querySelector('.work-list-panel')
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

function navigateExpressionList(
  direction: NavigationDirection,
  state: WorkspaceTabStateWorkspace,
  rootDocument: Document,
) {
  if (typeof document === 'undefined') return
  const panel = rootDocument.querySelector('.expression-groups')
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

function navigateManifestationList(
  direction: NavigationDirection,
  state: WorkspaceTabStateWorkspace,
  rootDocument: Document,
) {
  if (typeof document === 'undefined') return
  const panel = rootDocument.querySelector('.manifestation-panel')
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
    entry.row.scrollIntoView({ block: 'center', behavior: 'auto' })
  }
}
