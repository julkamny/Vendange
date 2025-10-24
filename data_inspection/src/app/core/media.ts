import type { RecordRow } from '../types'
import { findZones } from '../lib/intermarc'

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

function extractControlledLabel(record: RecordRow | undefined): string | undefined {
  if (!record) return undefined
  const zone169 = findZones(record.intermarc, '169')[0]
  if (!zone169) return undefined
  const label = zone169.sousZones.find(
    sz => sz.code === '169$a' && typeof sz.valeur === 'string' && sz.valeur.trim().length > 0,
  )?.valeur
  return label?.trim()
}

export function extractMediaKinds(
  record: RecordRow,
  options: { lookupRecordByArk: LookupRecord },
): MediaKind[] {
  const zones = findZones(record.intermarc, '051')
  if (!zones.length) return []
  const byEmoji = new Map<string, MediaKind>()
  for (const zone of zones) {
    for (const sz of zone.sousZones) {
      if (sz.code !== '051$a' || typeof sz.valeur !== 'string') continue
      const ark = sz.valeur.trim()
      if (!ark) continue
      const label = extractControlledLabel(options.lookupRecordByArk(ark))
      if (!label) continue
      const definition = MEDIA_MAP[normalizeLabel(label)]
      if (!definition) continue
      if (!byEmoji.has(definition.emoji)) {
        byEmoji.set(definition.emoji, definition)
      }
    }
  }
  return Array.from(byEmoji.values())
}
