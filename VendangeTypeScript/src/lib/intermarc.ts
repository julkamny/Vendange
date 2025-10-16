import { parseCsv } from './csv'

export type SousZone = { code: string; valeur: string }
export type Zone = { code: string; sousZones: SousZone[] }
export type Intermarc = { zones: Zone[] }

const CURRENT_EXPORT_PATH = '/data/current_export.csv'
const ARK_PREFIX = 'ark:/'

type ArkLabelMap = Map<string, string>
const arkLabelByIdCache = new Map<string, string>()
const arkLabelByArkCache = new Map<string, string | null>()
let arkLabelLoadPromise: Promise<ArkLabelMap> | null = null

export const ARK_TOKEN_START = '\uE000'
export const ARK_TOKEN_END = '\uE001'

export type PrettyIntermarcToken = {
  index: number
  ark: string
}

export type PrettyIntermarcResult = {
  text: string
  tokens: PrettyIntermarcToken[]
}

function looksLikeArk(value: string): boolean {
  return typeof value === 'string' && value.startsWith(ARK_PREFIX)
}

function arkToId(ark: string): string | null {
  const lower = ark.toLowerCase()
  const marker = '/cb'
  const idx = lower.lastIndexOf(marker)
  if (idx === -1) return null
  const tail = ark.slice(idx + marker.length)
  if (tail.length < 2) return null
  return tail.slice(0, -1)
}

function stripBom(value: string): string {
  return value.replace(/^\uFEFF/, '')
}

function stripQuotes(value: string): string {
  if (!value) return ''
  const noBom = stripBom(value)
  return noBom.replace(/\"/g, '').replace(/"/g, '').trim()
}

function normalizeTypeName(type: string): string {
  return type
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function getFirstSubZoneValue(im: Intermarc, zoneCode: string, subCode: string): string | undefined {
  for (const zone of im.zones) {
    if (zone.code !== zoneCode) continue
    const match = zone.sousZones.find(sz => sz.code === subCode)
    if (match && match.valeur) return match.valeur
  }
  return undefined
}

function buildLabelFromIntermarc(im: Intermarc, type: string): string | undefined {
  const normalizedType = normalizeTypeName(type)
  switch (normalizedType) {
    case 'œuvre':
      const parts = [getFirstSubZoneValue(im, '001', '001$a'),
        getFirstSubZoneValue(im, '150', '150$a')]
      return parts.join(' → ')
    case 'identite publique de personne': {
      const parts = [
        getFirstSubZoneValue(im, '100', '100$a'),
        getFirstSubZoneValue(im, '100', '100$m'),
      ].filter((p): p is string => !!p)
      return parts.length ? parts.join(' ') : undefined
    }
    case 'collectivite':
      return getFirstSubZoneValue(im, '110', '110$a')
    case 'manifestation':
      return getFirstSubZoneValue(im, '245', '245$a')
    case 'valeur controlee':
      return getFirstSubZoneValue(im, '169', '169$a')
    default:
      return undefined
  }
}

async function loadArkLabels(): Promise<ArkLabelMap> {
  if (arkLabelLoadPromise) return arkLabelLoadPromise
  arkLabelLoadPromise = (async () => {
    try {
      const resp = await fetch(CURRENT_EXPORT_PATH)
      if (!resp.ok) throw new Error(`Failed to load ${CURRENT_EXPORT_PATH}: ${resp.status}`)
      const text = await resp.text()
      const delimiter = guessDelimiter(text)
      const parsed = parseCsv(text, delimiter)
      const headers = parsed.headers
      const idIdx = headers.findIndex(h => stripQuotes(h) === 'id_entitelrm')
      const typeIdx = headers.findIndex(h => stripQuotes(h) === 'type_entite')
      const interIdx = headers.findIndex(h => stripQuotes(h) === 'intermarc')
      if (idIdx === -1 || typeIdx === -1 || interIdx === -1) {
        console.error('current_export.csv is missing expected headers')
        return new Map<string, string>()
      }
      const result = new Map<string, string>()
      for (const row of parsed.rows.slice(1)) {
        if (!row || row.length === 0) continue
        const rawId = row[idIdx]?.trim()
        const type = row[typeIdx]?.trim()
        const inter = row[interIdx]
        if (!rawId || !type || !inter) continue
        const intermarc = parseIntermarc(inter)
        const label = buildLabelFromIntermarc(intermarc, type)
        if (!label) continue
        result.set(rawId, label)
        const arkValue = getFirstSubZoneValue(intermarc, '001', '001$a')
        if (arkValue) {
          arkLabelByArkCache.set(arkValue, label)
        }
      }
      return result
    } catch (err) {
      console.error('Failed to build ARK label index from current_export.csv', err)
      return new Map<string, string>()
    }
  })()
  arkLabelLoadPromise.then(map => {
    map.forEach((value, key) => arkLabelByIdCache.set(key, value))
  })
  return arkLabelLoadPromise
}

function guessDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] || ''
  const count = (ch: string) => (firstLine.match(new RegExp(`\\${ch}`, 'g')) || []).length
  const semi = count(';')
  const comma = count(',')
  if (semi === 0 && comma === 0) return ';'
  return semi >= comma ? ';' : ','
}

export async function resolveArkLabel(ark: string): Promise<string | undefined> {
  if (arkLabelByArkCache.has(ark)) {
    const cached = arkLabelByArkCache.get(ark)
    return cached === null ? undefined : cached
  }

  const id = arkToId(ark)
  if (!id) {
    arkLabelByArkCache.set(ark, null)
    return undefined
  }

  if (arkLabelByIdCache.has(id)) {
    const cached = arkLabelByIdCache.get(id)!
    arkLabelByArkCache.set(ark, cached)
    return cached
  }

  const labels = await loadArkLabels()
  const label = labels.get(id) ?? undefined
  arkLabelByArkCache.set(ark, label ?? null)
  if (label) arkLabelByIdCache.set(id, label)
  return label
}

type DisplayValueResult = { text: string; ark?: string }

async function displayValue(zoneCode: string, _subCode: string, valeur: string): Promise<DisplayValueResult> {
  if (!looksLikeArk(valeur)) return { text: valeur }
  try {
    const resolved = await resolveArkLabel(valeur)
    if (resolved && resolved !== valeur) {
      return { text: resolved, ark: valeur }
    }
    return { text: valeur }
  } catch (err) {
    console.error('Failed to resolve ARK label', { zoneCode, valeur, err })
    return { text: valeur }
  }
}

function formatSubLabel(zoneCode: string, rawCode: string): string {
  if (!rawCode) return ''
  if (rawCode.startsWith(zoneCode)) {
    const remainder = rawCode.slice(zoneCode.length)
    return remainder.startsWith('$') ? remainder.slice(1) : remainder
  }
  const dollarIndex = rawCode.indexOf('$')
  if (dollarIndex >= 0 && dollarIndex + 1 < rawCode.length) {
    return rawCode.slice(dollarIndex + 1)
  }
  return rawCode
}

export function parseIntermarc(s: string): Intermarc {
  if (!s || !String(s).trim()) return { zones: [] }
  try {
    const cleaned = stripBom(String(s)).trim()
    const obj = JSON.parse(cleaned)
    if (!obj || !Array.isArray(obj.zones)) throw new Error('Invalid intermarc')
    // Normalize shape
    return { zones: obj.zones.map((z: any) => ({ code: String(z.code), sousZones: (z.sousZones || []).map((sz: any) => ({ code: String(sz.code), valeur: String(sz.valeur) })) })) }
  } catch (e) {
    console.error('Failed to parse intermarc:', e)
    return { zones: [] }
  }
}

export async function prettyPrintIntermarc(im: Intermarc): Promise<PrettyIntermarcResult> {
  const lines: string[] = []
  const tokens: PrettyIntermarcToken[] = []

  const wrapArkLabel = (label: string, ark: string): string => {
    const index = tokens.length
    tokens.push({ index, ark })
    return `${ARK_TOKEN_START}${index}|${label}${ARK_TOKEN_END}`
  }

  for (const z of im.zones) {
    const subs = await Promise.all(
      z.sousZones.map(async sz => {
        const { text: shown, ark } = await displayValue(z.code, sz.code, sz.valeur)
        const label = formatSubLabel(z.code, sz.code)
        const displayCode = label.startsWith('$') ? label : `$${label}`
        const prefix = `${displayCode}`
        if (!shown) return prefix
        const rendered = ark ? wrapArkLabel(shown, sz.valeur) : shown
        return `${prefix} ${rendered}`
      }),
    )
    const suffix = subs.length ? ' ' + subs.join(' ') : ''
    lines.push(`${z.code}${suffix}`)
  }
  return { text: lines.join('\n'), tokens }
}

export function findZones(im: Intermarc, code: string): Zone[] {
  return im.zones.filter(z => z.code === code)
}

export function add90FEntries(im: Intermarc, entries: { ark: string; date: string; note: string }[]): Intermarc {
  const zones = im.zones.slice()
  // Remove existing 90F with our note, then add according to entries
  const filtered = zones.filter(z => !(z.code === '90F' && z.sousZones.some(sz => sz.code === '90F$q' && sz.valeur === 'Clusterisation script')))
  for (const e of entries) {
    filtered.push({
      code: '90F',
      sousZones: [
        { code: '90F$a', valeur: e.ark },
        { code: '90F$q', valeur: e.note },
        { code: '90F$d', valeur: e.date },
      ],
    })
  }
  return { zones: filtered }
}
