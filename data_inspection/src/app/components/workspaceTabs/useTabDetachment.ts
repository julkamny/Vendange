import { useCallback, type Dispatch, type SetStateAction } from 'react'
import type { AgentTabState, WorkspaceTabState, WorkspaceTabStateWorkspace } from '../../workspace/types'
import { isAgentTab, isWorkspaceTab } from '../../workspace/types'
import { createAgentTab, createWorkspaceTab } from './tabFactories'

type UseTabDetachmentParams = {
  defaultWorkspaceTitle: string
  defaultAgentTitle: string
  getWorkspaceLabel: (tab: WorkspaceTabState) => string
  openWindow: (options: { title: string; classNames?: string[]; onClose: () => void }) => string | null
  closeWindow: (id: string) => void
  isOpen: (id: string) => boolean
  showToast: (message: string, options?: { tone?: 'error' | 'info' | 'success' | 'warning' }) => void
  t: (key: string, options?: Record<string, unknown>) => string
  setTabs: Dispatch<SetStateAction<WorkspaceTabState[]>>
}

type UseTabDetachmentResult = {
  openDetachedTabWithState: (initializer: (base: WorkspaceTabStateWorkspace) => WorkspaceTabStateWorkspace) => void
  openAgentDetachedTabWithState: (initializer: (base: AgentTabState) => AgentTabState) => void
  detachWorkspaceTab: (tab: WorkspaceTabStateWorkspace) => void
  dockWorkspaceTab: (tab: WorkspaceTabStateWorkspace) => void
  detachAgentTab: (tab: AgentTabState) => void
  dockAgentTab: (tab: AgentTabState) => void
}

export function useTabDetachment({
  defaultWorkspaceTitle,
  defaultAgentTitle,
  getWorkspaceLabel,
  openWindow,
  closeWindow,
  isOpen,
  showToast,
  t,
  setTabs,
}: UseTabDetachmentParams): UseTabDetachmentResult {
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
        return
      }
      const detachedState: WorkspaceTabStateWorkspace = {
        ...configured,
        mode: 'detached',
        detachedWindowId: windowId,
        intermarcFullView: true,
        listCollapsed: true,
        backlinksExpanded: false,
      }
      setTabs(prev => [...prev, detachedState])
    },
    [defaultWorkspaceTitle, getWorkspaceLabel, openWindow, setTabs, showToast, t],
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
        return
      }
      const detachedState: AgentTabState = {
        ...configured,
        mode: 'detached',
        detachedWindowId: windowId,
        intermarcFullView: true,
        listCollapsed: true,
        backlinksExpanded: false,
      }
      setTabs(prev => [...prev, detachedState])
    },
    [defaultAgentTitle, getWorkspaceLabel, openWindow, setTabs, showToast, t],
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
            ? {
                ...entry,
                mode: 'detached',
                detachedWindowId: windowId,
                intermarcFullView: true,
                listCollapsed: true,
                backlinksExpanded: false,
              }
            : entry,
        ),
      )
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
            ? {
                ...entry,
                mode: 'detached',
                detachedWindowId: windowId,
                intermarcFullView: true,
                listCollapsed: true,
                backlinksExpanded: false,
              }
            : entry,
        ),
      )
    },
    [getWorkspaceLabel, openWindow, setTabs, showToast, t],
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

  return {
    openDetachedTabWithState,
    openAgentDetachedTabWithState,
    detachWorkspaceTab,
    dockWorkspaceTab,
    detachAgentTab,
    dockAgentTab,
  }
}
