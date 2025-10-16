import { useState, useCallback, useEffect, useMemo, type MouseEvent } from 'react'
import { WorkspaceView } from './WorkspaceView'
import type { WorkspaceTabState } from '../workspace/types'
import { DEFAULT_WORKSPACE_STATE } from '../workspace/types'
import { useTranslation } from '../hooks/useTranslation'
import { useShortcuts } from '../providers/ShortcutContext'
import { shortcutMatchesEvent, type ShortcutAction } from '../core/shortcuts'
import { useWorkspaceData } from '../workspace/useWorkspaceData'
import { useAppData } from '../providers/AppDataContext'
import { focusTreeUp, focusTreeDown } from '../workspace/shortcutActions'

let tabSequence = 0

function createTab(title: string): WorkspaceTabState {
  return {
    id: `tab-${++tabSequence}`,
    title,
    ...DEFAULT_WORKSPACE_STATE,
  }
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

  const handleShortcutAction = useCallback(
    (action: ShortcutAction) => {
      if (action === 'focusUp') {
        updateTabState(activeTab.id, prev =>
          focusTreeUp(prev, {
            clusters,
            activeCluster: workspace.activeCluster,
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
            curatedRecords,
            originalRecords,
          }),
        )
        return
      }
      if (action === 'listUp' || action === 'listDown') {
        navigateList(action === 'listUp' ? 'up' : 'down', activeTab)
        return
      }
      if (action === 'openExpressionFilter') {
        openExpressionFilterSelect()
        return
      }
      if (action === 'openWorkFilter') {
        openWorkFilterSelect()
      }
    },
    [activeTab, updateTabState, clusters, workspace.activeCluster, curatedRecords, originalRecords],
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
          <button
            key={tab.id}
            className={`workspace-tab${tab.id === activeTab?.id ? ' is-active' : ''}`}
            role="tab"
            aria-selected={tab.id === activeTab?.id}
            onClick={() => activate(tab.id)}
          >
            <span>{tab.title}</span>
            {tabs.length > 1 && (
              <span
                className="close"
                role="button"
                aria-label={t('workspace.closeTab', { defaultValue: 'Close tab' })}
                onClick={(event: MouseEvent<HTMLSpanElement>) => {
                  event.stopPropagation()
                  closeTab(tab.id)
                }}
              >
                ×
              </span>
            )}
          </button>
        ))}
        <button className="workspace-tab add" onClick={addTab} aria-label={t('workspace.addTab', { defaultValue: 'Add tab' })}>
          +
        </button>
      </div>
      <div className="workspace-tab-content" role="tabpanel">
        {activeTab ? (
          <WorkspaceView
            state={activeTab}
            onStateChange={updater => updateTabState(activeTab.id, updater)}
          />
        ) : null}
      </div>
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

function navigateList(direction: NavigationDirection, state: WorkspaceTabState) {
  if (state.listScope === 'inventory') return
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

function openExpressionFilterSelect() {
  focusSelectElement(document.querySelector<HTMLSelectElement>('.expression-filter-select'))
}

function openWorkFilterSelect() {
  focusSelectElement(document.querySelector<HTMLSelectElement>('.cluster-banner.work-banner select.work-selector'))
}

function focusSelectElement(select: HTMLSelectElement | null) {
  if (!select) return
  select.focus()
  try {
    if (typeof (select as any).showPicker === 'function') {
      ;(select as any).showPicker()
    }
  } catch {
    // no-op
  }
}
