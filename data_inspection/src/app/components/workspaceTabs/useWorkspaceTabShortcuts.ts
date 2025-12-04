import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react'
import { shortcutMatchesEvent, type ShortcutAction, type ShortcutBindings } from '../../core/shortcuts'
import {
  isAgentTab,
  isWorkspaceLayoutTab,
  isWorkspaceTab,
  type AgentTabState,
  type WorkspaceTabState,
  type WorkspaceTabStateWorkspace,
} from '../workspace/types'
import type { RecordRow } from '../../types'
import type { useWorkspaceData } from '../../workspace/useWorkspaceData'
import { navigateAgentList, navigateList } from './navigation'
import { focusTreeDown, focusTreeUp } from '../../workspace/shortcutActions'

type WorkspaceData = ReturnType<typeof useWorkspaceData>

type UseWorkspaceTabShortcutsParams = {
  bindings: ShortcutBindings
  shortcutModalOpen: boolean
  activeId: string
  tabs: WorkspaceTabState[]
  shortcutTab: WorkspaceTabState
  workspace: WorkspaceData
  clusters: WorkspaceData['clusters']
  curatedRecords: RecordRow[]
  setActive: (id: string) => void
  setTabs: Dispatch<SetStateAction<WorkspaceTabState[]>>
  updateTabState: (id: string, updater: (prev: WorkspaceTabState) => WorkspaceTabState) => void
  dockWorkspaceTab: (tab: WorkspaceTabStateWorkspace) => void
  detachWorkspaceTab: (tab: WorkspaceTabStateWorkspace) => void
  dockAgentTab: (tab: AgentTabState) => void
  detachAgentTab: (tab: AgentTabState) => void
  arrangeWindows: (mode: 'tile' | 'cascade') => void
  setShortcutTargetId: (id: string) => void
  getContainer: (id: string) => HTMLDivElement | null
}

export function useWorkspaceTabShortcuts({
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
}: UseWorkspaceTabShortcutsParams) {
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
}
