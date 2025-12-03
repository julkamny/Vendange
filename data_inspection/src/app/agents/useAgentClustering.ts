import { useCallback, useMemo, useState } from 'react'
import { updateManualCluster, type WorkspaceUpdatePayload } from '../lib/api'
import type { AgentClusterDto, AgentListRowDto, WorkspaceAgentsResponse } from '../types'

type AgentEntry = {
  id: string
  ark?: string | null
  label?: string | null
  typeNorm?: string | null
  isAnchor: boolean
}

type AgentMembership = { anchorId: string }

type Params = {
  datasetId: string | null
  agentsDto: WorkspaceAgentsResponse | undefined
  applyServerWorkspaceUpdates: (payload: WorkspaceUpdatePayload) => void
  showToast: (message: string, options?: { tone: 'error' | 'info' | 'success' }) => void
  t: ReturnType<typeof import('../hooks/useTranslation').useTranslation>['t']
  closeContextMenu: () => void
}

function indexAgents(agentsDto?: WorkspaceAgentsResponse): {
  entries: Map<string, AgentEntry>
  memberships: Map<string, AgentMembership>
} {
  const entries = new Map<string, AgentEntry>()
  const memberships = new Map<string, AgentMembership>()

  const register = (keys: Array<string | undefined | null>, entry: AgentEntry) => {
    keys.filter(Boolean).forEach(key => {
      const safe = key as string
      if (!entries.has(safe)) entries.set(safe, entry)
    })
  }

  const registerMembership = (keys: Array<string | undefined | null>, membership: AgentMembership) => {
    keys.filter(Boolean).forEach(key => {
      const safe = key as string
      if (!memberships.has(safe)) memberships.set(safe, membership)
    })
  }

  const registerCluster = (cluster: AgentClusterDto) => {
    const anchorEntry: AgentEntry = {
      id: cluster.anchor_id,
      ark: cluster.anchor_ark,
      label: cluster.anchor_label,
      typeNorm: cluster.anchor_type_norm ?? undefined,
      isAnchor: true,
    }
    register([cluster.anchor_id, cluster.anchor_ark], anchorEntry)

    cluster.items.forEach(item => {
      const id = item.id ?? item.ark
      if (!id) return
      const entry: AgentEntry = {
        id,
        ark: item.ark,
        label: item.label,
        typeNorm: item.type_norm ?? undefined,
        isAnchor: false,
      }
      register([id, item.ark], entry)
      registerMembership([id, item.ark], { anchorId: cluster.anchor_id })
    })
  }

  agentsDto?.clusters.forEach(registerCluster)

  const registerUnclustered = (agent: AgentListRowDto) => {
    const entry: AgentEntry = {
      id: agent.id,
      ark: agent.ark,
      label: agent.label,
      typeNorm: agent.type_norm,
      isAnchor: false,
    }
    register([agent.id, agent.ark], entry)
  }

  agentsDto?.unclustered_agents.forEach(registerUnclustered)

  return { entries, memberships }
}

export function useAgentClustering({
  datasetId,
  agentsDto,
  applyServerWorkspaceUpdates,
  showToast,
  t,
  closeContextMenu,
}: Params) {
  const { entries, memberships } = useMemo(() => indexAgents(agentsDto), [agentsDto])
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null)
  const [pendingTarget, setPendingTarget] = useState<{ anchorId: string; sourceId: string } | null>(null)

  const getEntry = useCallback((key?: string | null) => {
    if (!key) return null
    return entries.get(key) ?? null
  }, [entries])

  const reset = useCallback(() => {
    setPendingSourceId(null)
    setPendingTarget(null)
  }, [])

  const prepareForClustering = useCallback(
    (entry: AgentEntry) => {
      if (!entry.ark) {
        showToast(t('agents.cluster.missingArk', { defaultValue: "Cannot cluster agent without an ARK." }), {
          tone: 'error',
        })
        closeContextMenu()
        return
      }
      if (entry.isAnchor) {
        showToast(t('agents.cluster.targetIsAnchor', { defaultValue: 'Cannot cluster: target is already a manual cluster anchor.' }), {
          tone: 'error',
        })
        closeContextMenu()
        return
      }
      setPendingSourceId(entry.id)
      closeContextMenu()
      showToast(t('agents.cluster.prepared', { defaultValue: 'Agent marked for clustering.' }), { tone: 'info' })
    },
    [closeContextMenu, showToast, t],
  )

  const requestClusterWith = useCallback(
    (anchor: AgentEntry) => {
      if (!pendingSourceId) return
      const source = getEntry(pendingSourceId)
      if (!source) {
        reset()
        return
      }
      if (source.id === anchor.id) {
        reset()
        return
      }
      if (!anchor.ark) {
        showToast(t('agents.cluster.missingArk', { defaultValue: 'Cannot cluster agent without an ARK.' }), {
          tone: 'error',
        })
        reset()
        return
      }
      if (source.isAnchor) {
        showToast(t('agents.cluster.targetIsAnchor', { defaultValue: 'Cannot cluster: target is already a manual cluster anchor.' }), {
          tone: 'error',
        })
        reset()
        return
      }
      if (source.typeNorm && anchor.typeNorm && source.typeNorm !== anchor.typeNorm) {
        showToast(t('agents.cluster.typeMismatch', { defaultValue: 'Agents must be of the same type.' }), {
          tone: 'error',
        })
        reset()
        return
      }
      const membership = memberships.get(source.id) || (source.ark ? memberships.get(source.ark) : null)
      if (membership && membership.anchorId !== anchor.id) {
        showToast(
          t('agents.cluster.pendingAlreadySelected', {
            defaultValue: 'Cannot proceed: this agent is already marked for another anchoring.',
          }),
          { tone: 'error' },
        )
        reset()
        return
      }
      setPendingTarget({ anchorId: anchor.id, sourceId: source.id })
      closeContextMenu()
    },
    [closeContextMenu, getEntry, memberships, pendingSourceId, reset, showToast, t],
  )

  const confirmPendingCluster = useCallback(async () => {
    if (!pendingTarget) return
    if (!datasetId) {
      showToast(t('works.cluster.noDataset', { defaultValue: 'Aucune base chargée.' }), { tone: 'error' })
      reset()
      return
    }
    try {
      const updates = await updateManualCluster(datasetId, {
        anchorId: pendingTarget.anchorId,
        targetId: pendingTarget.sourceId,
        accepted: true,
      })
      applyServerWorkspaceUpdates(updates)
      showToast(t('agents.cluster.success', { defaultValue: 'Agent added to cluster.' }), { tone: 'success' })
    } catch (error) {
      console.error(error)
      showToast(t('works.cluster.failed', { defaultValue: 'Échec de la clusterisation.' }), { tone: 'error' })
    } finally {
      reset()
    }
  }, [applyServerWorkspaceUpdates, datasetId, pendingTarget, reset, showToast, t])

  const toggleAgentClusterMembership = useCallback(
    async ({ anchorId, targetArk, targetId, accepted }: { anchorId: string; targetArk?: string | null; targetId?: string | null; accepted: boolean }) => {
      if (!datasetId) {
        showToast(t('works.cluster.noDataset', { defaultValue: 'Aucune base chargée.' }), { tone: 'error' })
        return
      }
      if (!targetArk) {
        showToast(t('agents.cluster.missingArk', { defaultValue: 'Cannot cluster agent without an ARK.' }), {
          tone: 'error',
        })
        return
      }
      if (accepted && !targetId) {
        showToast(t('agents.cluster.missingArk', { defaultValue: 'Cannot cluster agent without an ARK.' }), {
          tone: 'error',
        })
        return
      }
      try {
        const updates = await updateManualCluster(datasetId, {
          anchorId,
          targetArk,
          targetId: accepted ? targetId ?? undefined : undefined,
          accepted,
        })
        applyServerWorkspaceUpdates(updates)
        showToast(t('agents.cluster.success', { defaultValue: 'Agent added to cluster.' }), { tone: 'success' })
      } catch (error) {
        console.error(error)
        showToast(t('works.cluster.failed', { defaultValue: 'Échec de la clusterisation.' }), { tone: 'error' })
      }
    },
    [applyServerWorkspaceUpdates, datasetId, showToast, t],
  )

  return {
    pendingSourceId,
    pendingTarget,
    prepareForClustering,
    requestClusterWith,
    confirmPendingCluster,
    cancelPendingCluster: reset,
    toggleAgentClusterMembership,
    getEntry,
    memberships,
  }
}
