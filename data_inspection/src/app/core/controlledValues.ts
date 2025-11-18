import type { RecordRow } from '../types'
import { findZones } from '../lib/intermarc'

export function extractControlledValueLabel(record?: RecordRow | null): string | undefined {
  if (!record) return undefined
  const zone = findZones(record.intermarc, '169')[0]
  if (!zone) return undefined
  const label = zone.sousZones.find(sz => sz.code === '169$a')?.valeur
  const trimmed = typeof label === 'string' ? label.trim() : ''
  return trimmed.length ? trimmed : undefined
}
