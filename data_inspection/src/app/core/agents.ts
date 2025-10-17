import { findZones } from '../lib/intermarc'
import type { RecordRow } from '../types'
import { titleOf } from './entities'

const AGENT_ZONE_CODES = new Set(['700', '701', '702', '710', '711', '712'])
const AGENT_NAME_SUBCODES = new Set(['a', 'b', 'c', 'd', 'f', 'g', 'h', 'm', 'n', 'p', 'q'])
const AGENT_REFERENCE_SUBCODES = new Set(['0', '3'])

function subCodeOf(raw: string): string | undefined {
  const dollarIdx = raw.indexOf('$')
  if (dollarIdx === -1 || dollarIdx + 1 >= raw.length) return undefined
  return raw.slice(dollarIdx + 1).toLowerCase()
}

function normalizeArkForLookup(ark?: string | null): string | undefined {
  if (!ark) return undefined
  return ark.toLowerCase()
}

function labelForAgentRecord(rec: RecordRow): string {
  if (rec.typeNorm === 'identite publique de personne') {
    const zone = findZones(rec.intermarc, '100')[0]
    if (zone) {
      const parts = zone.sousZones
        .map(sub => {
          const code = subCodeOf(sub.code)
          if (!code) return null
          if (['a', 'b', 'c', 'd', 'm', 'n', 'p', 'q'].includes(code)) {
            const value = sub.valeur?.trim()
            return value && value.length ? value : null
          }
          return null
        })
        .filter((part): part is string => !!part)
      if (parts.length) return parts.join(' ')
    }
  }
  if (rec.typeNorm === 'collectivite') {
    const zone = findZones(rec.intermarc, '110')[0]
    const value = zone?.sousZones.find(sub => sub.code === '110$a')?.valeur?.trim()
    if (value) return value
  }
  return titleOf(rec) || rec.id
}

export function extractAgentNames(
  record: RecordRow,
  options: { lookupRecordByArk?: (ark: string) => RecordRow | undefined } = {},
): string[] {
  if (!record) return []
  const names = new Set<string>()
  for (const zone of record.intermarc.zones) {
    if (!AGENT_ZONE_CODES.has(zone.code)) continue
    const parts = zone.sousZones
      .map(sub => {
        const subCode = subCodeOf(sub.code)
        if (!subCode) return null
        if (AGENT_NAME_SUBCODES.has(subCode)) {
          const value = sub.valeur?.trim()
          if (value) return value
        }
        return null
      })
      .filter((part): part is string => !!part)
    let label = parts.join(' ').trim()
    if (!label && options.lookupRecordByArk) {
      const reference = zone.sousZones.find(sub => {
        const code = subCodeOf(sub.code)
        return code ? AGENT_REFERENCE_SUBCODES.has(code) : false
      })?.valeur
      if (reference) {
        const normalized = normalizeArkForLookup(reference)
        const target =
          (normalized && options.lookupRecordByArk(normalized)) || options.lookupRecordByArk(reference)
        if (target) {
          label = labelForAgentRecord(target)
        }
      }
    }
    if (label) names.add(label)
  }
  return [...names]
}
