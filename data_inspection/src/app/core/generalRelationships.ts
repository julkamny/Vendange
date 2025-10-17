import type { RecordRow } from '../types'
import { findZones } from '../lib/intermarc'

const GENERAL_RELATIONSHIP_CODES: Record<string, readonly string[]> = {
  oeuvre: [
    '500',
    '501',
    '506',
    '509',
    '50N',
    '54T',
    '550',
    '551',
    '552',
    '553',
    '554',
    '555',
    '556',
    '557',
    '559',
    '55A',
    '55B',
    '55C',
    '55E',
    '55F',
    '55M',
    '55P',
    '55R',
    '55S',
    '55Z',
  ],
  expression: ['501', '506', '509', '50N', '540', '541', '542', '543', '544', '547', '54C', '54P', '54T'],
  manifestation: ['501', '506', '509', '50N', '530', '531', '532', '533', '534', '535', '536', '537', '538', '53M'],
}

export function countGeneralRelationships(record: RecordRow): number {
  if (!record?.intermarc || !record.typeNorm) return 0
  const normalized = record.typeNorm.toLowerCase()
  const zoneCodes = GENERAL_RELATIONSHIP_CODES[normalized]
  if (!zoneCodes || !zoneCodes.length) return 0

  const related = new Set<string>()

  for (const code of zoneCodes) {
    const zones = findZones(record.intermarc, code)
    if (!zones.length) continue
    const targetCode = `${code}$3`
    for (const zone of zones) {
      for (const sub of zone.sousZones) {
        if (sub.code !== targetCode) continue
        const value = typeof sub.valeur === 'string' ? sub.valeur.trim() : ''
        if (!value) continue
        related.add(value)
      }
    }
  }

  return related.size
}
