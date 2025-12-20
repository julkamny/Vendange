import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react'
import { shortcutMatchesEvent, type ShortcutAction, type ShortcutBindings } from '../../core/shortcuts'
import {
  isAgentTab,
  isWorkspaceLayoutTab,
  isWorkspaceTab,
  type AgentTabState,
  type WorkspaceTabState,
  type WorkspaceTabStateWorkspace,
} from '../../workspace/types'
import type { NavigationDirection, WorkspaceAgentsResponse } from '../../types'
import type { useWorkspaceData } from '../../workspace/useWorkspaceData'
import { navigateAgentList, navigateList } from './navigation'
import { focusTreeDown, focusTreeUp } from '../../workspace/shortcutActions'
import { buildArkAndIdSets } from '../../lib/arkFilters'
import { filterNavigationTargets, pickCyclicMatch } from '../../lib/filterNavigation'

type WorkspaceData = ReturnType<typeof useWorkspaceData>

type UseWorkspaceTabShortcutsParams = {
  bindings: ShortcutBindings
  shortcutModalOpen: boolean
  activeId: string
  tabs: WorkspaceTabState[]
  shortcutTab: WorkspaceTabState
  workspace: WorkspaceData
  clusters: WorkspaceData['clusters']
  setActive: (id: string) => void
  setTabs: Dispatch<SetStateAction<WorkspaceTabState[]>>
  updateTabState: (id: string, updater: (prev: WorkspaceTabState) => WorkspaceTabState) => void
  workArkFilter: string[]
  agentArkFilter: string[]
  workspaceAgents: WorkspaceAgentsResponse | undefined
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
  setActive,
  setTabs,
  updateTabState,
  workArkFilter,
  agentArkFilter,
  workspaceAgents,
  dockWorkspaceTab,
  detachWorkspaceTab,
  dockAgentTab,
  detachAgentTab,
  arrangeWindows,
  setShortcutTargetId,
  getContainer,
}: UseWorkspaceTabShortcutsParams) {
  const buildWorkspaceWorkCandidates = useCallback(() => {
    const candidates: Array<{ id: string; ark?: string | null; anchorId?: string | null; containerIndex: number }> = []
    if (workspace.orderedWorkEntries && workspace.orderedWorkEntries.length) {
      const clustersById = new Map(workspace.clusters.map(cluster => [cluster.anchorId, cluster]))
      const unclusteredSource =
        workspace.unclusteredWorkRows && workspace.unclusteredWorkRows.length
          ? workspace.unclusteredWorkRows
          : workspace.unclusteredWorks
      const unclusteredById = new Map(unclusteredSource.map(work => [work.id, work]))
      workspace.orderedWorkEntries.forEach((entry, containerIndex) => {
        if (entry.kind === 'cluster') {
          const cluster = clustersById.get(entry.id)
          if (!cluster) return
          candidates.push({
            id: cluster.anchorId,
            ark: cluster.anchorArk,
            anchorId: cluster.anchorId,
            containerIndex,
          })
          cluster.items.forEach(item => {
            if (!item.id) return
            candidates.push({
              id: String(item.id),
              ark: item.ark,
              anchorId: cluster.anchorId,
              containerIndex,
            })
          })
          return
        }
        const work = unclusteredById.get(entry.id)
        if (!work) return
        candidates.push({
          id: work.id,
          ark: work.ark,
          anchorId: null,
          containerIndex,
        })
      })
      return candidates
    }
    workspace.clusters.forEach((cluster, clusterIndex) => {
      candidates.push({
        id: cluster.anchorId,
        ark: cluster.anchorArk,
        anchorId: cluster.anchorId,
        containerIndex: clusterIndex,
      })
      cluster.items.forEach(item => {
        if (!item.id) return
        candidates.push({
          id: String(item.id),
          ark: item.ark,
          anchorId: cluster.anchorId,
          containerIndex: clusterIndex,
        })
      })
    })
    const offset = workspace.clusters.length
    const unclusteredSource =
      workspace.unclusteredWorkRows && workspace.unclusteredWorkRows.length
        ? workspace.unclusteredWorkRows
        : workspace.unclusteredWorks
    unclusteredSource.forEach((work, index) => {
      candidates.push({
        id: work.id,
        ark: work.ark,
        anchorId: null,
        containerIndex: offset + index,
      })
    })
    return candidates
  }, [workspace.clusters, workspace.orderedWorkEntries, workspace.unclusteredWorkRows, workspace.unclusteredWorks])

  const buildAgentEntries = useCallback(() => {
    if (!workspaceAgents) return [] as Array<{ kind: 'cluster'; anchorId: string; sortKey: string } | { kind: 'single'; agentId: string; sortKey: string }>
    const entries: Array<{ kind: 'cluster'; anchorId: string; sortKey: string } | { kind: 'single'; agentId: string; sortKey: string }> = []
    workspaceAgents.clusters.forEach(cluster => {
      const sortKey = cluster.sort_key ?? cluster.anchor_label ?? cluster.anchor_id
      entries.push({ kind: 'cluster', anchorId: cluster.anchor_id, sortKey })
    })
    workspaceAgents.unclustered_agents.forEach(agent => {
      const sortKey = agent.sort_key ?? agent.label ?? agent.id
      entries.push({ kind: 'single', agentId: agent.id, sortKey })
    })
    return entries.sort((a, b) => a.sortKey.localeCompare(b.sortKey, 'fr', { sensitivity: 'accent' }))
  }, [workspaceAgents])

  const buildAgentCandidates = useCallback(() => {
    if (!workspaceAgents) return [] as Array<{ id: string; ark?: string | null; anchorId?: string | null; containerIndex: number }>
    const entries = buildAgentEntries()
    const candidates: Array<{ id: string; ark?: string | null; anchorId?: string | null; containerIndex: number }> = []
    entries.forEach((entry, containerIndex) => {
      if (entry.kind === 'cluster') {
        const cluster = workspaceAgents.clusters.find(c => c.anchor_id === entry.anchorId)
        if (!cluster) return
        candidates.push({
          id: cluster.anchor_id,
          ark: cluster.anchor_ark,
          anchorId: cluster.anchor_id,
          containerIndex,
        })
        cluster.items.forEach(item => {
          if (!item.id) return
          candidates.push({
            id: String(item.id),
            ark: item.ark,
            anchorId: cluster.anchor_id,
            containerIndex,
          })
        })
        return
      }
      const agent = workspaceAgents.unclustered_agents.find(a => a.id === entry.agentId)
      if (!agent) return
      candidates.push({
        id: agent.id,
        ark: agent.ark,
        anchorId: null,
        containerIndex,
      })
    })
    return candidates
  }, [buildAgentEntries, workspaceAgents])

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

      if (action === 'nextFilterMatch' || action === 'previousFilterMatch') {
        const direction: NavigationDirection = action === 'nextFilterMatch' ? 'next' : 'previous'
        if (targetIsWorkspace) {
          const { ids: workFilterIds } = buildArkAndIdSets(workArkFilter ?? null)
          const candidates = buildWorkspaceWorkCandidates()
          const matches = filterNavigationTargets(candidates, workFilterIds)
          const current =
            targetTab.highlightedWorkId ??
            (targetTab.selectedEntity?.entityType === 'work' ? targetTab.selectedEntity.id : null)
          const next = pickCyclicMatch(matches, current, direction)
          if (!next) return
          updateTabState(targetTab.id, prev => {
            if (!isWorkspaceTab(prev)) return prev
            return {
              ...prev,
              viewMode: 'works',
              listScope: 'clusters',
              activeWorkAnchorId: next.anchorId ?? next.id ?? prev.activeWorkAnchorId,
              highlightedWorkId: next.id,
              highlightedWorkArk: next.ark ?? prev.highlightedWorkArk ?? null,
              selectedEntity: {
                id: next.id,
                source: 'workspace',
                entityType: 'work',
                workArk: next.ark ?? undefined,
              },
            }
          })
          return
        }
        if (targetIsAgent) {
          const { ids: agentFilterIds } = buildArkAndIdSets(agentArkFilter ?? null)
          const candidates = buildAgentCandidates()
          const matches = filterNavigationTargets(candidates, agentFilterIds)
          const current = targetTab.highlightedAgentId ?? targetTab.selectedAgentId
          const next = pickCyclicMatch(matches, current, direction)
          if (!next) return
          updateTabState(targetTab.id, prev => {
            if (!isAgentTab(prev)) return prev
            return {
              ...prev,
              highlightedAgentId: next.id,
              selectedAgentId: next.id,
            }
          })
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
      detachAgentTab,
      detachWorkspaceTab,
      dockAgentTab,
      dockWorkspaceTab,
      buildAgentCandidates,
      buildWorkspaceWorkCandidates,
      workArkFilter,
      agentArkFilter,
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
