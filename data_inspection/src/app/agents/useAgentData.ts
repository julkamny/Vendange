import { useMemo } from 'react'
import { useAppData } from '../providers/AppDataContext'
import type { RecordRow } from '../types'
import { buildLabelFromIntermarc } from '../lib/intermarc'
import { titleOf } from '../core/entities'

export function isAgentRecord(record: RecordRow | null | undefined): record is RecordRow {
  if (!record) return false
  const norm = record.typeNorm?.toLowerCase()
  return norm === 'identite publique de personne' || norm === 'collectivite' || norm === 'famille'
}

export function useAgentData() {
  const { curated } = useAppData()

  const agents = useMemo(() => {
    const source = curated?.records ?? []
    const filtered = source.filter(isAgentRecord)
    return filtered.sort((a, b) => {
      const aLabel = buildLabelFromIntermarc(a.intermarc, a.type) || titleOf(a) || a.id
      const bLabel = buildLabelFromIntermarc(b.intermarc, b.type) || titleOf(b) || b.id
      return aLabel.localeCompare(bLabel, 'fr', { sensitivity: 'accent' })
    })
  }, [curated?.records])

  return { agents }
}
