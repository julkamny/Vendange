import { useQuery } from '@tanstack/react-query'
import { fetchWorkspaceAgents, fetchWorkspaceRecord, fetchWorkspaceWorks, fetchWorkCluster } from '../lib/api'
import type {
  WorkspaceWorksResponse,
  WorkClusterDto,
  WorkspaceAgentsResponse,
  WorkRecordPayload,
} from '../types'

export function useWorkspaceWorks(datasetId?: string | null) {
  return useQuery<WorkspaceWorksResponse>({
    queryKey: ['workspace', 'works', datasetId],
    queryFn: () => fetchWorkspaceWorks(datasetId as string),
    enabled: Boolean(datasetId),
  })
}

export function useWorkCluster(datasetId?: string | null, anchorKey?: string | null) {
  return useQuery<WorkClusterDto>({
    queryKey: ['workspace', 'work', datasetId, anchorKey],
    queryFn: () => fetchWorkCluster(datasetId as string, anchorKey as string),
    enabled: Boolean(datasetId && anchorKey),
  })
}

export function useWorkspaceAgents(datasetId?: string | null) {
  return useQuery<WorkspaceAgentsResponse>({
    queryKey: ['workspace', 'agents', datasetId],
    queryFn: () => fetchWorkspaceAgents(datasetId as string),
    enabled: Boolean(datasetId),
  })
}

export function useWorkspaceRecord(datasetId?: string | null, recordKey?: string | null) {
  return useQuery<WorkRecordPayload>({
    queryKey: ['workspace', 'record', datasetId, recordKey],
    queryFn: () => fetchWorkspaceRecord(datasetId as string, recordKey as string),
    enabled: Boolean(datasetId && recordKey),
  })
}
