import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchWorkspaceBacklinks } from '../lib/api'
import { normalizeType } from '../core/records'
import type { BacklinkItem, BacklinksResponse } from '../types'

export function useBacklinks(datasetId?: string | null, recordKey?: string | null) {
  const query = useQuery<BacklinksResponse>({
    queryKey: ['workspace', 'backlinks', datasetId, recordKey],
    queryFn: () => fetchWorkspaceBacklinks(datasetId as string, recordKey as string),
    enabled: Boolean(datasetId && recordKey),
  })

  const backlinks = useMemo<BacklinkItem[]>(() => {
    if (!query.data) return []
    return (query.data.backlinks || [])
      .map(item => ({
        id: item.id,
        ark: item.ark ?? undefined,
        type: item.type,
        typeNorm: normalizeType(item.type_norm ?? item.type),
        title: item.title || item.id,
        titleSegments: item.title_segments ?? [],
        fields: [...(item.fields ?? [])].sort(),
      }))
      .sort((a, b) => {
        if (a.typeNorm !== b.typeNorm) return a.typeNorm.localeCompare(b.typeNorm)
        return (a.title || a.id).localeCompare(b.title || b.id)
      })
  }, [query.data])

  return { ...query, backlinks }
}
