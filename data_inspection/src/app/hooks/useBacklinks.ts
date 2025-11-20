import { useCallback, useMemo } from 'react'
import { useAppData } from '../providers/AppDataContext'
import type { RecordRow } from '../types'
import { findZones } from '../lib/intermarc'
import { isGeneralRelationshipZone } from '../core/generalRelationships'

export type BacklinkInfo = {
  record: RecordRow
  fields: string[]
}

type BacklinkIndex = Map<string, BacklinkInfo[]>

const WEM_TYPES = new Set(['oeuvre', 'expression', 'manifestation'])

function normalizeArk(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!trimmed.toLowerCase().startsWith('ark:/')) return null
  return trimmed.toLowerCase()
}

function collectRecordArks(record: RecordRow): string[] {
  const values = new Set<string>()
  if (record.ark) {
    values.add(record.ark.toLowerCase())
  }
  const zone = findZones(record.intermarc, '001')[0]
  if (zone) {
    zone.sousZones.forEach(sub => {
      if (sub.code !== '001$a') return
      const normalized = normalizeArk(sub.valeur)
      if (normalized) values.add(normalized)
    })
  }
  return [...values]
}

function buildBacklinkIndex(records: RecordRow[]): BacklinkIndex {
  const index = new Map<string, Map<string, { record: RecordRow; fields: Set<string> }>>()

  records.forEach(record => {
    const normalizedType = record.typeNorm.toLowerCase()
    if (!WEM_TYPES.has(normalizedType)) return

    record.intermarc.zones.forEach(zone => {
      const zoneCode = zone.code
      zone.sousZones.forEach(sub => {
        const normalizedArk = normalizeArk(sub.valeur)
        if (!normalizedArk) return
        if (!index.has(normalizedArk)) {
          index.set(normalizedArk, new Map())
        }
        const recordMap = index.get(normalizedArk)!
        const key = record.id
        if (!recordMap.has(key)) {
          recordMap.set(key, { record, fields: new Set([zoneCode]) })
        } else {
          recordMap.get(key)!.fields.add(zoneCode)
        }
      })
    })
  })

  const finalIndex: BacklinkIndex = new Map()
  index.forEach((recordMap, ark) => {
    const entries = Array.from(recordMap.values()).map(item => ({
      record: item.record,
      fields: Array.from(item.fields).sort(),
    }))
    finalIndex.set(ark, entries)
  })
  return finalIndex
}

function mergeBacklinkEntries(entries: BacklinkInfo[]): BacklinkInfo[] {
  const map = new Map<string, { record: RecordRow; fields: Set<string> }>()
  entries.forEach(entry => {
    const key = entry.record.id
    if (!map.has(key)) {
      map.set(key, { record: entry.record, fields: new Set(entry.fields) })
    } else {
      entry.fields.forEach(field => map.get(key)!.fields.add(field))
    }
  })
  return Array.from(map.values()).map(item => ({
    record: item.record,
    fields: Array.from(item.fields).sort(),
  }))
}

function sortBacklinks(entries: BacklinkInfo[]): BacklinkInfo[] {
  return [...entries].sort((a, b) => {
    const typeA = a.record.typeNorm.toLowerCase()
    const typeB = b.record.typeNorm.toLowerCase()
    if (typeA !== typeB) return typeA.localeCompare(typeB)
    return (a.record.id || '').localeCompare(b.record.id || '')
  })
}

export function useBacklinks() {
  const { curated } = useAppData()

  const records = useMemo(() => curated?.records ?? [], [curated?.records])

  const index = useMemo(() => buildBacklinkIndex(records), [records])

  const getBacklinksForRecord = useCallback(
    (record: RecordRow | null | undefined): BacklinkInfo[] => {
      if (!record) return []
      const targets = collectRecordArks(record)
      if (!targets.length) return []
      const collected: BacklinkInfo[] = []
      targets.forEach(target => {
        const entries = index.get(target)
        if (!entries) return
        collected.push(
          ...entries.filter(entry => entry.record.id !== record.id),
        )
      })
      if (!collected.length) return []
      return sortBacklinks(mergeBacklinkEntries(collected))
    },
    [index],
  )

  const countIncomingRelationships = useCallback(
    (record: RecordRow | null | undefined): number => {
      if (!record) return 0
      const targets = collectRecordArks(record)
      if (!targets.length) return 0
      const seen = new Set<string>()
      targets.forEach(target => {
        const entries = index.get(target)
        if (!entries) return
        entries.forEach(entry => {
          if (entry.record.id === record.id) return
          const hasRelationshipField = entry.fields.some(field =>
            isGeneralRelationshipZone(entry.record.typeNorm.toLowerCase(), field),
          )
          if (!hasRelationshipField) return
          seen.add(entry.record.id)
        })
      })
      return seen.size
    },
    [index],
  )

  return {
    getBacklinksForRecord,
    countIncomingRelationships,
  }
}
