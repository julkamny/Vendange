import type { RecordRow } from '../types'
import { CLUSTER_NOTE, MANUAL_CLUSTER_NOTE } from '../core/constants'

export type SousZone = { code: string; valeur: string; affectedByCuration?: string }
export type Zone = {
  code: string
  sousZones: SousZone[]
  fieldCompactValue?: string
  affectedByCuration?: string
}
export type Intermarc = { zones: Zone[] }

export const COMPACT_FIELD_CODES = new Set(['990', '907', '90H', '901', '991'])

const ARK_PREFIX = 'ark:/'

const arkLabelByIdCache = new Map<string, string>()
const arkLabelByArkCache = new Map<string, string | null>()

export type PrettyIntermarcLineMark = {
  from: number
  to: number
  className: string
  attributes?: Record<string, string>
}

export type PrettyIntermarcLine = {
  text: string
  marks: PrettyIntermarcLineMark[]
}

export type PrettyIntermarcResult = {
  text: string
  lines: PrettyIntermarcLine[]
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

function getCachedArkLabel(ark: string | undefined | null): string | undefined {
  if (!ark) return undefined
  if (arkLabelByArkCache.has(ark)) return arkLabelByArkCache.get(ark) ?? undefined
  const normalized = ark.toLowerCase()
  if (arkLabelByArkCache.has(normalized)) return arkLabelByArkCache.get(normalized) ?? undefined
  return undefined
}

export function buildLabelFromIntermarc(im: Intermarc, type: string): string | undefined {
  const normalizedType = normalizeTypeName(type)
  switch (normalizedType) {
    case 'œuvre': {
      const title = getFirstSubZoneValue(im, '150', '150$a')
      return title ?? getFirstSubZoneValue(im, '001', '001$a')
    }
    case 'identite publique de personne': {
      const parts = [
        getFirstSubZoneValue(im, '100', '100$a'),
        getFirstSubZoneValue(im, '100', '100$m'),
        getFirstSubZoneValue(im, '100', '100$d'),
      ].filter((p): p is string => !!p)
      return parts.length ? parts.join(' ') : undefined
    }
    case 'collectivite': {
      const main = getFirstSubZoneValue(im, '110', '110$a')
      const qualifier = getFirstSubZoneValue(im, '110', '110$q')
      if (main && qualifier) return `${main} — ${qualifier}`
      return main
    }
    case 'manifestation':
      return getFirstSubZoneValue(im, '245', '245$a')
    case 'expression': {
      const zone = findZones(im, '140')[0]
      if (zone) {
        const parts: string[] = []
        zone.sousZones.forEach(sub => {
          let value = typeof sub.valeur === 'string' ? sub.valeur.trim() : ''
          if (!value) return
          if (sub.code === '140$3') {
            const resolved = getCachedArkLabel(value)
            value = resolved ?? value
          }
          parts.push(value)
        })
        if (parts.length) return parts.join(' — ')
      }
      return getFirstSubZoneValue(im, '150', '150$a') ?? getFirstSubZoneValue(im, '245', '245$a')
    }
    case 'valeur controlee':
      return getFirstSubZoneValue(im, '169', '169$a')
    case 'marque':
      return getFirstSubZoneValue(im, '163', '163$a')
    case 'famille': {
      const parts = [
        getFirstSubZoneValue(im, '120', '120$a'),
        getFirstSubZoneValue(im, '120', '120$m'),
        getFirstSubZoneValue(im, '120', '120$e'),
      ].filter((value): value is string => !!value && value.trim().length > 0)
      return parts.length ? parts.join(' ') : undefined
    }
    case 'concept dewey': {
      const main = getFirstSubZoneValue(im, '186', '186$i')
      const subtitle = getFirstSubZoneValue(im, '186', '186$a')
      if (main && subtitle) return `${main} — ${subtitle}`
      return main ?? subtitle
    }
    default:
      return undefined
  }
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

  arkLabelByArkCache.set(ark, null)
  return undefined
}

type DisplayValueResult = { text: string; ark?: string }

async function displayValue(
  zoneCode: string,
  _subCode: string,
  valeur: string,
  resolveLabels: boolean,
): Promise<DisplayValueResult> {
  if (!resolveLabels) return { text: valeur }
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
    type RawSubZone = { code?: unknown; valeur?: unknown; affectedByCuration?: unknown }
    type RawZone = {
      code?: unknown
      sousZones?: RawSubZone[]
      fieldCompactValue?: unknown
      affectedByCuration?: unknown
    }
    const rawZones = obj.zones as RawZone[]
    return {
      zones: rawZones.map(z => ({
        code: String(z.code ?? ''),
        fieldCompactValue: z.fieldCompactValue != null ? String(z.fieldCompactValue) : undefined,
        affectedByCuration: typeof z.affectedByCuration === 'string' ? z.affectedByCuration : undefined,
        sousZones: (Array.isArray(z.sousZones) ? z.sousZones : []).map(sz => ({
          code: String(sz.code ?? ''),
          valeur: sz.valeur != null ? String(sz.valeur) : '',
          affectedByCuration: typeof sz.affectedByCuration === 'string' ? sz.affectedByCuration : undefined,
        })),
      })),
    }
  } catch (e) {
    console.error('Failed to parse intermarc:', e)
    return { zones: [] }
  }
}

type PrettyPrintOptions = {
  resolveLabels?: boolean
}

function curationClass(flag?: string): string {
  if (!flag) return ''
  const normalized = flag.toLowerCase()
  if (normalized === 'manual') return ' curation-created'
  if (normalized === 'created') return ' curation-created'
  if (normalized === 'deleted') return ' curation-deleted'
  return ''
}

export async function prettyPrintIntermarc(
  im: Intermarc,
  options: PrettyPrintOptions = {},
): Promise<PrettyIntermarcResult> {
  const resolveLabels = options.resolveLabels ?? true
  const lineEntries: PrettyIntermarcLine[] = []

  for (const z of im.zones) {
    let lineText = z.code ?? ''
    const marks: PrettyIntermarcLineMark[] = []
    if (lineText.length) {
      marks.push({ className: `intermarc-zone${curationClass(z.affectedByCuration)}`, from: 0, to: lineText.length })
    }

    const compactValue = z.fieldCompactValue
    if (compactValue !== undefined && compactValue !== null) {
      if (lineText.length) lineText += ' '
      const compactStart = lineText.length
      lineText += compactValue
      const highlight = curationClass(z.affectedByCuration)
      marks.push({
        className: `intermarc-subfield intermarc-compact-value${highlight}`,
        from: compactStart,
        to: lineText.length,
      })
      lineEntries.push({ text: lineText, marks })
      continue
    }

    for (const sz of z.sousZones) {
      const { text: shown, ark } = await displayValue(z.code, sz.code, sz.valeur, resolveLabels)
      const label = formatSubLabel(z.code, sz.code)
      const displayCode = label.startsWith('$') ? label : `$${label}`
      const subfieldStart = lineText.length
      if (lineText.length) lineText += ' '
      lineText += displayCode
      const codeStart = lineText.length - displayCode.length
      const codeEnd = lineText.length
      const highlight = curationClass(sz.affectedByCuration ?? z.affectedByCuration)
      marks.push({ className: `intermarc-subfield-code${highlight}`, from: codeStart, to: codeEnd })

      if (shown && shown.length) {
        lineText += ' '
        const valueStart = lineText.length
        lineText += shown
        if (ark) {
          marks.push({
            className: `ark-link has-tooltip${highlight}`,
            from: valueStart,
            to: lineText.length,
            attributes: {
              'data-ark': ark,
              'data-tooltip': ark,
              'aria-label': ark,
              'data-tooltip-placement': 'above',
              tabindex: '0',
              'data-zone': z.code,
              'data-subfield': sz.code,
              role: 'button',
            },
          })
        }
      }

      const subfieldEnd = lineText.length
      marks.push({ className: `intermarc-subfield${highlight}`, from: subfieldStart, to: subfieldEnd })
    }

    lineEntries.push({ text: lineText, marks })
  }

  const text = lineEntries.map(entry => entry.text).join('\n')
  return { text, lines: lineEntries }
}

export function parsePrettyPrintedIntermarc(text: string): Intermarc {
  const zones: Zone[] = []
  const lines = text.split(/\r?\n/)
  for (const rawLine of lines) {
    const trimmed = rawLine.trim()
    if (!trimmed) continue
    const match = trimmed.match(/^(\S+)(?:\s+(.*))?$/)
    if (!match) {
      throw new Error(`Invalid line "${rawLine}"`)
    }
    const zoneCode = match[1]
    const remainder = match[2]?.trim() ?? ''
    const sousZones: SousZone[] = []
    let fieldCompactValue: string | undefined
    if (remainder && COMPACT_FIELD_CODES.has(zoneCode) && !remainder.includes('$')) {
      fieldCompactValue = remainder
    } else if (remainder) {
      const segments = remainder.split(' $')
      segments.forEach((segment, index) => {
        const cleaned = (index === 0 ? segment : `$${segment}`).trim()
        if (!cleaned) return
        const spaceIndex = cleaned.indexOf(' ')
        const codeSegment = (spaceIndex >= 0 ? cleaned.slice(0, spaceIndex) : cleaned).trim()
        const valueSegment = spaceIndex >= 0 ? cleaned.slice(spaceIndex + 1).trim() : ''
        if (!codeSegment) return
        const normalizedCode = codeSegment.startsWith('$')
          ? `${zoneCode}${codeSegment}`
          : codeSegment.includes('$')
            ? codeSegment
            : `${zoneCode}$${codeSegment}`
        sousZones.push({ code: normalizedCode, valeur: valueSegment })
      })
    }
    zones.push({ code: zoneCode, sousZones, ...(fieldCompactValue !== undefined ? { fieldCompactValue } : {}) })
  }
  return { zones }
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
      affectedByCuration: 'created',
      sousZones: [
        { code: '90F$a', valeur: e.ark, affectedByCuration: 'created' },
        { code: '90F$q', valeur: e.note, affectedByCuration: 'created' },
        { code: '90F$d', valeur: e.date, affectedByCuration: 'created' },
      ],
    })
  }
  return { zones: filtered }
}

export function addManualAgent90FEntries(im: Intermarc, entries: { ark: string }[]): Intermarc {
  const zones = im.zones.slice()
  const filtered = zones.filter(
    z => !(z.code === '90F' && z.sousZones.some(sz => sz.code === '90F$q' && sz.valeur === 'Clusterisation manuelle')),
  )

  for (const entry of entries) {
    filtered.push({
      code: '90F',
      affectedByCuration: 'manual',
      sousZones: [
        { code: '90F$3', valeur: entry.ark, affectedByCuration: 'manual' },
        { code: '90F$q', valeur: 'Clusterisation manuelle', affectedByCuration: 'manual' },
      ],
    })
  }

  return { zones: filtered }
}

export function addManualWork90FEntries(im: Intermarc, entries: { ark: string }[]): Intermarc {
  const zones = im.zones.slice()
  const filtered = zones.filter(
    z => !(z.code === '90F' && z.sousZones.some(sz => sz.code === '90F$q' && sz.valeur === MANUAL_CLUSTER_NOTE)),
  )

  for (const entry of entries) {
    filtered.push({
      code: '90F',
      affectedByCuration: 'manual',
      sousZones: [
        { code: '90F$3', valeur: entry.ark, affectedByCuration: 'manual' },
        { code: '90F$q', valeur: MANUAL_CLUSTER_NOTE, affectedByCuration: 'manual' },
      ],
    })
  }

  return { zones: filtered }
}

export function rebuildWorkCluster90FEntries(
  im: Intermarc,
  items: { ark: string; origin: 'script' | 'manual'; date?: string }[],
  options: { defaultDate?: string } = {},
): Intermarc {
  const defaultDate = options.defaultDate ?? new Date().toISOString().slice(0, 10)
  const zones = im.zones.slice()
  const filtered = zones.filter(
    z =>
      !(
        z.code === '90F' &&
        z.sousZones.some(
          sz => sz.code === '90F$q' && (sz.valeur === CLUSTER_NOTE || sz.valeur === MANUAL_CLUSTER_NOTE),
        )
      ),
  )

  items.forEach(item => {
    if (!item.ark) return
    if (item.origin === 'script') {
      const date = item.date ?? defaultDate
      filtered.push({
        code: '90F',
        affectedByCuration: 'created',
        sousZones: [
          { code: '90F$a', valeur: item.ark, affectedByCuration: 'created' },
          { code: '90F$q', valeur: CLUSTER_NOTE, affectedByCuration: 'created' },
          { code: '90F$d', valeur: date, affectedByCuration: 'created' },
        ],
      })
      return
    }

    filtered.push({
      code: '90F',
      affectedByCuration: 'manual',
      sousZones: [
        { code: '90F$3', valeur: item.ark, affectedByCuration: 'manual' },
        { code: '90F$q', valeur: MANUAL_CLUSTER_NOTE, affectedByCuration: 'manual' },
      ],
    })
  })

  return { zones: filtered }
}

export function addManualExpression90FEntries(im: Intermarc, entries: { ark: string }[]): Intermarc {
  const zones = im.zones.slice()
  const filtered = zones.filter(
    z => !(z.code === '90F' && z.sousZones.some(sz => sz.code === '90F$q' && sz.valeur === MANUAL_CLUSTER_NOTE)),
  )

  entries.forEach(entry => {
    filtered.push({
      code: '90F',
      affectedByCuration: 'manual',
      sousZones: [
        { code: '90F$3', valeur: entry.ark, affectedByCuration: 'manual' },
        { code: '90F$q', valeur: MANUAL_CLUSTER_NOTE, affectedByCuration: 'manual' },
      ],
    })
  })

  return { zones: filtered }
}

export function rebuildExpressionCluster90FEntries(
  im: Intermarc,
  items: { ark: string; origin: 'script' | 'manual'; date?: string }[],
  options: { defaultDate?: string } = {},
): Intermarc {
  const defaultDate = options.defaultDate ?? new Date().toISOString().slice(0, 10)
  const zones = im.zones.slice()
  const filtered = zones.filter(
    z =>
      !(
        z.code === '90F' &&
        z.sousZones.some(
          sz => sz.code === '90F$q' && (sz.valeur === CLUSTER_NOTE || sz.valeur === MANUAL_CLUSTER_NOTE),
        )
      ),
  )

  items.forEach(item => {
    if (!item.ark) return
    if (item.origin === 'script') {
      const date = item.date ?? defaultDate
      filtered.push({
        code: '90F',
        affectedByCuration: 'created',
        sousZones: [
          { code: '90F$a', valeur: item.ark, affectedByCuration: 'created' },
          { code: '90F$q', valeur: CLUSTER_NOTE, affectedByCuration: 'created' },
          { code: '90F$d', valeur: date, affectedByCuration: 'created' },
        ],
      })
      return
    }

    filtered.push({
      code: '90F',
      affectedByCuration: 'manual',
      sousZones: [
        { code: '90F$3', valeur: item.ark, affectedByCuration: 'manual' },
        { code: '90F$q', valeur: MANUAL_CLUSTER_NOTE, affectedByCuration: 'manual' },
      ],
    })
  })

  return { zones: filtered }
}

export function extractWorkClusterTargets(im: Intermarc): string[] {
  const zones = findZones(im, '90F')
  const targets = new Set<string>()
  zones.forEach(zone => {
    const note = zone.sousZones.find(sz => sz.code === '90F$q')?.valeur?.trim()
    if (!note || (note !== CLUSTER_NOTE && note !== MANUAL_CLUSTER_NOTE)) return
    const target =
      zone.sousZones.find(sz => sz.code === (note === CLUSTER_NOTE ? '90F$a' : '90F$3'))?.valeur?.trim() ||
      zone.sousZones.find(sz => sz.code === '90F$a')?.valeur?.trim() ||
      zone.sousZones.find(sz => sz.code === '90F$3')?.valeur?.trim()
    if (target) targets.add(target)
  })
  return [...targets]
}

export function extractExpressionClusterTargets(im: Intermarc): string[] {
  const zones = findZones(im, '90F')
  const targets = new Set<string>()
  zones.forEach(zone => {
    const note = zone.sousZones.find(sz => sz.code === '90F$q')?.valeur?.trim()
    if (!note || (note !== CLUSTER_NOTE && note !== MANUAL_CLUSTER_NOTE)) return
    const target =
      note === CLUSTER_NOTE
        ? zone.sousZones.find(sz => sz.code === '90F$a')?.valeur?.trim()
        : zone.sousZones.find(sz => sz.code === '90F$3')?.valeur?.trim() ||
          zone.sousZones.find(sz => sz.code === '90F$a')?.valeur?.trim()
    if (target) targets.add(target)
  })
  return [...targets]
}

export function isClusterAnchorCreated(im: Intermarc): boolean {
  const zones = findZones(im, '90F')
  for (const zone of zones) {
    const note = zone.sousZones.find(sz => sz.code === '90F$q')?.valeur?.trim()
    if (!note || (note !== CLUSTER_NOTE && note !== MANUAL_CLUSTER_NOTE)) continue
    const flags: string[] = [
      zone.affectedByCuration,
      ...zone.sousZones.map(sz => sz.affectedByCuration),
    ].filter((flag): flag is string => typeof flag === 'string' && flag.length > 0)
    if (flags.some(flag => ['created', 'manual'].includes(flag.toLowerCase()))) return true
  }
  return false
}

export function resetArkLabelCache(): void {
  arkLabelByIdCache.clear()
  arkLabelByArkCache.clear()
}

export function registerArkLabelForRecord(record: RecordRow): void {
  const label = buildLabelFromIntermarc(record.intermarc, record.type)
  if (!label) return
  arkLabelByIdCache.set(record.id, label)
  if (record.ark) {
    const ark = record.ark
    arkLabelByArkCache.set(ark, label)
    const normalized = ark.toLowerCase()
    if (normalized !== ark) arkLabelByArkCache.set(normalized, label)
  } else {
    const ark = getFirstSubZoneValue(record.intermarc, '001', '001$a')
    if (ark) {
      arkLabelByArkCache.set(ark, label)
      const normalized = ark.toLowerCase()
      if (normalized !== ark) arkLabelByArkCache.set(normalized, label)
    }
  }
}

export function primeArkLabelCache(records: RecordRow[]): void {
  records.forEach(record => {
    const normalized = record.typeNorm?.toLowerCase()
    if (normalized === 'oeuvre') registerArkLabelForRecord(record)
  })
  records.forEach(record => {
    const normalized = record.typeNorm?.toLowerCase()
    if (normalized === 'expression') registerArkLabelForRecord(record)
  })
  records.forEach(record => {
    const normalized = record.typeNorm?.toLowerCase()
    if (normalized !== 'oeuvre' && normalized !== 'expression') registerArkLabelForRecord(record)
  })
}
