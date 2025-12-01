import { useQuery } from '@tanstack/react-query'
import { fetchWorkspaceWorks, fetchWorkCluster } from '../lib/api'
import type { WorkspaceWorksResponse, WorkClusterDto } from '../types'

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
