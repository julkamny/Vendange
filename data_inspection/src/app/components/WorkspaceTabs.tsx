import { useState, useCallback, useEffect, useMemo, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { WorkspaceView } from './WorkspaceView'
import { SparqlWorkspaceView } from './SparqlWorkspaceView'
import type { WorkspaceTabState, WorkspaceTabStateWorkspace } from '../workspace/types'
import type { RecordRow } from '../types'
import {
  DEFAULT_WORKSPACE_STATE,
  createDefaultSparqlState,
  isSparqlTab,
  isWorkspaceTab,
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

let tabSequence = 0

function createWorkspaceTab(title: string, explicitId?: string): WorkspaceTabStateWorkspace {
  const id = explicitId ?? `tab-${++tabSequence}`
  return {
    ...DEFAULT_WORKSPACE_STATE,
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
  const { openWindow, closeWindow, getContainer, isOpen } = useDetachedWindows()
  const { showToast } = useToast()
  const curatedRecords = curated?.records ?? []
  const defaultWorkspaceTitle = useMemo(
    () => t('workspace.tabDefault', { defaultValue: 'Workspace' }),
    [t],
  )
  const defaultSparqlTitle = useMemo(() => t('workspace.sparqlTabDefault', { defaultValue: 'SPARQL' }), [t])
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

  const addTab = useCallback(() => {
    const newTab = createWorkspaceTab(defaultWorkspaceTitle)
    setTabs(prev => [...prev, newTab])
    setActiveId(newTab.id)
  }, [defaultWorkspaceTitle])

  const addSparqlTab = useCallback(() => {
    const newTab = createDefaultSparqlState(`tab-${++tabSequence}`, defaultSparqlTitle)
    setTabs(prev => [...prev, newTab])
    setActiveId(newTab.id)
  }, [defaultSparqlTitle])

  const openTabWithState = useCallback(
    (initializer: (base: WorkspaceTabStateWorkspace) => WorkspaceTabStateWorkspace) => {
      const base = createWorkspaceTab(defaultWorkspaceTitle)
      const configured = initializer ? initializer(base) : base
      setTabs(prev => [...prev, configured])
      setActiveId(configured.id)
    },
    [defaultWorkspaceTitle],
  )

  const closeTab = useCallback(
    (id: string) => {
      const tabToClose = tabs.find(tab => tab.id === id)
      if (tabToClose && isWorkspaceTab(tabToClose) && tabToClose.detachedWindowId) {
        closeWindow(tabToClose.detachedWindowId)
      }
      setTabs(prev => {
        if (prev.length <= 1) return prev
        const next = prev.filter(tab => tab.id !== id)
        if (!next.some(isWorkspaceTab)) {
          const replacement = createWorkspaceTab(defaultWorkspaceTitle)
          next.push(replacement)
          if (!next.some(tab => tab.id === activeId)) {
            setActiveId(replacement.id)
          }
          return next
        }
        if (!next.some(tab => tab.id === activeId)) {
          const fallback = next[next.length - 1]
          setActiveId(fallback.id)
        }
        return next
      })
    },
    [activeId, closeWindow, defaultWorkspaceTitle, tabs],
  )

  const activate = useCallback((id: string) => setActiveId(id), [])

  const updateTabState = useCallback((id: string, updater: (prev: WorkspaceTabState) => WorkspaceTabState) => {
    setTabs(prev => prev.map(tab => (tab.id === id ? updater(tab) : tab)))
  }, [])

  const activeTab = useMemo(() => tabs.find(tab => tab.id === activeId) ?? tabs[0], [tabs, activeId])!
  const fallbackWorkspace = useMemo(
    () => createWorkspaceTab(defaultWorkspaceTitle, '__fallback-workspace__'),
    [defaultWorkspaceTitle],
  )
  const firstWorkspaceTab = useMemo(
    () => tabs.find(isWorkspaceTab) ?? fallbackWorkspace,
    [tabs, fallbackWorkspace],
  )
  const workspaceSource = isWorkspaceTab(activeTab) ? activeTab : firstWorkspaceTab
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
    [recordIndexes, defaultWorkspaceTitle, defaultSparqlTitle, labelFromRecord],
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
        setActiveId(configured.id)
        return
      }
      const detachedState: WorkspaceTabStateWorkspace = {
        ...configured,
        mode: 'detached',
        detachedWindowId: windowId,
        intermarcFullView: true,
      }
      setTabs(prev => [...prev, detachedState])
      setActiveId(detachedState.id)
    },
    [defaultWorkspaceTitle, getWorkspaceLabel, openWindow, setTabs, setActiveId, showToast, t],
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
      setActiveId(tab.id)
    },
    [getWorkspaceLabel, openWindow, setTabs, showToast, t],
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

  const handleShortcutAction = useCallback(
    (action: ShortcutAction) => {
      if (!isWorkspaceTab(activeTab)) {
        if (action === 'nextWorkspace') {
          if (tabs.length <= 1) return
          const currentIndex = tabs.findIndex(tab => tab.id === activeTab.id)
          const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % tabs.length
          const nextTab = tabs[nextIndex]
          if (nextTab) setActiveId(nextTab.id)
        }
        return
      }
      if (action === 'focusUp') {
        updateTabState(activeTab.id, prev =>
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
      if (action === 'focusDown') {
        updateTabState(activeTab.id, prev =>
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
      tabs,
      setActiveId,
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
            detachStatus={isWorkspaceTab(tab) ? tab.mode : undefined}
            onToggleDetach={
              isWorkspaceTab(tab)
                ? () => (tab.mode === 'detached' ? dockWorkspaceTab(tab) : detachWorkspaceTab(tab))
                : undefined
            }
            detachLabel={t('workspace.detachTab', { defaultValue: 'Open tab in new window' })}
            dockLabel={t('workspace.redockTab', { defaultValue: 'Bring tab back here' })}
          />
        ))}
        <button
          type="button"
          className="workspace-tab add sparql"
          onClick={addSparqlTab}
          aria-label={t('workspace.addSparqlTab', { defaultValue: 'Add SPARQL tab' })}
        >
          SPARQL
        </button>
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
            />
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
      />
    </div>,
    container,
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

function navigateList(direction: NavigationDirection, state: WorkspaceTabStateWorkspace) {
  if (state.viewMode === 'works') {
    navigateWorkList(direction, state)
  } else if (state.viewMode === 'expressions') {
    navigateExpressionList(direction, state)
  } else if (state.viewMode === 'manifestations') {
    navigateManifestationList(direction, state)
  }
}

function navigateWorkList(direction: NavigationDirection, state: WorkspaceTabStateWorkspace) {
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

function navigateExpressionList(direction: NavigationDirection, state: WorkspaceTabStateWorkspace) {
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

function navigateManifestationList(direction: NavigationDirection, state: WorkspaceTabStateWorkspace) {
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
    entry.row.scrollIntoView({ block: 'center', behavior: 'auto' })
  }
}
