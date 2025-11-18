import type { RecordRow } from '../types'
import { findZones } from '../lib/intermarc'
import { extractControlledValueLabel } from './controlledValues'

export type MediaKind = { emoji: string; label: string }

type MediaDefinition = { emoji: string; label: string }

type LookupRecord = (ark: string) => RecordRow | undefined

const MEDIA_MAP: Record<string, MediaDefinition> = {
  texte: { emoji: '📖', label: 'Texte' },
  'texte note': { emoji: '📝', label: 'Texte noté' },
  'image fixe': { emoji: '🖼️', label: 'Image fixe' },
  'image animee': { emoji: '🎬', label: 'Image animée' },
  'parole enoncee': { emoji: '🗣️', label: 'Parole énoncée' },
  musique: { emoji: '🎵', label: 'Musique' },
  'musique executee': { emoji: '🎶', label: 'Musique exécutée' },
  'musique notee': { emoji: '🎼', label: 'Musique notée' },
  'expression performative': { emoji: '🎭', label: 'Expression performative' },
}

function normalizeLabel(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

const AGGREGATE_CONTROLLED_LABEL = normalizeLabel('agrégat éditorial')
const AGGREGATE_MEDIA_KIND: MediaDefinition = { emoji: '🧺', label: 'Agrégat éditorial' }

function isEditorialAggregate(record: RecordRow | undefined): boolean {
  if (!record) return false
  const label = extractControlledValueLabel(record)
  if (!label) return false
  return normalizeLabel(label) === AGGREGATE_CONTROLLED_LABEL
}

function hasEditorialAggregate(record: RecordRow, lookup: LookupRecord): boolean {
  const zones = findZones(record.intermarc, '010')
  for (const zone of zones) {
    for (const sz of zone.sousZones) {
      if (sz.code !== '010$g') continue
      const ark = typeof sz.valeur === 'string' ? sz.valeur.trim() : ''
      if (!ark) continue
      if (isEditorialAggregate(lookup(ark))) return true
    }
  }
  return false
}

export function extractMediaKinds(
  record: RecordRow,
  options: { lookupRecordByArk: LookupRecord },
): MediaKind[] {
  const zones = findZones(record.intermarc, '051')
  const kinds: MediaKind[] = []
  if (hasEditorialAggregate(record, options.lookupRecordByArk)) {
    kinds.push(AGGREGATE_MEDIA_KIND)
  }
  if (!zones.length) return kinds
  const byEmoji = new Map<string, MediaKind>()
  for (const zone of zones) {
    for (const sz of zone.sousZones) {
      if (sz.code !== '051$a' || typeof sz.valeur !== 'string') continue
      const ark = sz.valeur.trim()
      if (!ark) continue
      const label = extractControlledValueLabel(options.lookupRecordByArk(ark))
      if (!label) continue
      const definition = MEDIA_MAP[normalizeLabel(label)]
      if (!definition) continue
      if (!byEmoji.has(definition.emoji)) {
        byEmoji.set(definition.emoji, definition)
      }
    }
  }
  return kinds.concat(Array.from(byEmoji.values()))
}
