import type { RecordRow } from '../types'

export function isAgentRecord(record: RecordRow | null | undefined): record is RecordRow {
  if (!record) return false
  const norm = record.typeNorm?.toLowerCase()
  return norm === 'identite publique de personne' || norm === 'collectivite' || norm === 'famille'
}