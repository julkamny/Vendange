import { parseIntermarc, findZones } from '../lib/intermarc'
import { parseCsv } from '../lib/csv'
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
  const idIdx = headers.findIndex(h => stripQuotes(h) === 'id_entitelrm')
  const typeIdx = headers.findIndex(h => stripQuotes(h) === 'type_entite')
  const intIdx = headers.findIndex(h => stripQuotes(h) === 'intermarc')
  if (idIdx < 0 || typeIdx < 0 || intIdx < 0) throw new Error('Missing expected headers')
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
  return table.headers.findIndex(h => stripQuotes(h) === 'intermarc')
}

function stripQuotes(value: string): string {
  return value.replace(/\"/g, '').replace(/"/g, '').trim()
}
