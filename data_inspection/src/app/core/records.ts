import { parseIntermarc, findZones } from '../lib/intermarc'
import { parseCsv } from '../lib/csv'
import { buildHeaderLookup, normalizeHeaderName } from '../lib/csvHeaders'
import type { CsvTable, RecordRow } from '../types'

export function normalizeType(value: string): string {
  if (!value) return ''
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/œ/gi, 'oe')
    .toLowerCase()
    .trim()
}

export function parseCsvText(text: string): CsvTable {
  return parseCsv(text)
}

export function indexRecords(table: CsvTable): RecordRow[] {
  const headers = table.headers
  const headerLookup = buildHeaderLookup(headers)
  const idIdx = headerLookup.get('id_entitelrm') ?? -1
  const typeIdx = headerLookup.get('type_entite') ?? -1
  const intIdx = headerLookup.get('intermarc') ?? -1
  if (idIdx < 0 || typeIdx < 0 || intIdx < 0) {
    const available = headers.map(normalizeHeaderName).filter(Boolean).join(', ') || 'none'
    throw new Error(`Missing expected headers (available: ${available})`)
  }
  const records: RecordRow[] = table.rows.slice(1).map((row, idx) => {
    const intermarcStr = row[intIdx]
    const intermarc = parseIntermarc(intermarcStr)
    const arkZone = findZones(intermarc, '001')[0]
    const ark = arkZone?.sousZones.find(sz => sz.code === '001$a')?.valeur
    return {
      id: row[idIdx],
      type: row[typeIdx],
      typeNorm: normalizeType(row[typeIdx]),
      rowIndex: idx + 1,
      intermarcStr,
      intermarc,
      ark,
      raw: row,
    }
  })
  return records
}

export function findIntermarcColumnIndex(table: CsvTable): number {
  const headerLookup = buildHeaderLookup(table.headers)
  return headerLookup.get('intermarc') ?? -1
}
