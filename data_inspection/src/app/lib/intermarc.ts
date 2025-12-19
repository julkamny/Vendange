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

const ARK_PREFIX = 'ark:/'

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
        let parent: string | undefined
        const modifiers: string[] = []
        zone.sousZones.forEach(sub => {
          const value = typeof sub.valeur === 'string' ? sub.valeur.trim() : ''
          if (!value) return
          const code = subfieldCode(sub.code)
          if (code === '3' && !parent) {
            parent = value
            return
          }
          if (code === '9') return
          modifiers.push(value)
        })
        if (parent || modifiers.length) return [parent, ...modifiers].filter(Boolean).join(' ')
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

export function labelFromRecord(record: RecordRow): string | undefined {
  const ark = record.ark?.trim()
  if (ark && record.arkLabels) {
    const direct = record.arkLabels[ark] ?? record.arkLabels[ark.toLowerCase()]
    if (direct) return direct
  }
  if (record.typeNorm === 'oeuvre') {
    return buildIntermarcWorkLabel(record.intermarc, record.arkLabels) ?? buildLabelFromIntermarc(record.intermarc, record.type)
  }
  if (record.typeNorm === 'expression') {
    return buildIntermarcExpressionLabel(record.intermarc, record.arkLabels) ?? buildLabelFromIntermarc(record.intermarc, record.type)
  }
  return buildLabelFromIntermarc(record.intermarc, record.type)
}

function subfieldCode(raw: string): string {
  if (!raw) return ''
  const dollar = raw.lastIndexOf('$')
  if (dollar >= 0 && dollar + 1 < raw.length) return raw.slice(dollar + 1)
  const sIndex = raw.lastIndexOf('s')
  if (sIndex >= 0 && sIndex + 1 < raw.length && /^[0-9A-Za-z]{3}s/.test(raw)) return raw.slice(sIndex + 1)
  if (raw.length > 3 && raw.startsWith('150')) return raw.slice(3)
  return raw
}

export function buildIntermarcWorkLabel(
  im: Intermarc,
  arkLabels?: Record<string, string>,
): string | undefined {
  const zones = findZones(im, '150')
  if (!zones.length) return undefined
  const parts: string[] = []
  const targetZone = zones[0]
  for (const sub of targetZone.sousZones) {
    const code = subfieldCode(sub.code)
    if (code === '9') continue
    let value = typeof sub.valeur === 'string' ? sub.valeur.trim() : ''
    if (!value) continue
    if (code === '3' && arkLabels) {
      const lower = value.toLowerCase()
      const resolved = arkLabels[value] ?? arkLabels[lower] ?? null
      if (resolved) value = resolved
    }
    parts.push(value)
  }
  return parts.length ? parts.join(' ') : undefined
}

export function buildIntermarcExpressionLabel(
  im: Intermarc,
  arkLabels?: Record<string, string>,
  resolveByArk?: (ark: string) => string | undefined,
): string | undefined {
  const zone = findZones(im, '140')[0]
  if (!zone) return undefined

  let parentLabel: string | undefined
  const modifiers: string[] = []

  for (const sub of zone.sousZones) {
    const value = typeof sub.valeur === 'string' ? sub.valeur.trim() : ''
    if (!value) continue
    const code = subfieldCode(sub.code)
    if (code === '9') continue
    if (code === '3' && !parentLabel) {
      parentLabel =
        arkLabels?.[value] ??
        (value.toLowerCase() !== value ? arkLabels?.[value.toLowerCase()] : undefined) ??
        resolveByArk?.(value) ??
        value
      continue
    }
    modifiers.push(value)
  }

  const parts = parentLabel ? [parentLabel, ...modifiers] : modifiers
  return parts.length ? parts.join(' ') : undefined
}

export function makeArkLabelResolver(
  getByArk: (ark: string) => { arkLabels?: Record<string, string>; intermarc: Intermarc; typeNorm: string } | null,
): (ark: string) => string | undefined {
  return (ark: string) => {
    const target = getByArk(ark)
    if (!target) return undefined
    const direct = target.arkLabels?.[ark] ?? target.arkLabels?.[ark.toLowerCase()]
    if (direct) return direct
    const resolveByArk = (candidate: string) => {
      const normalized = candidate.trim()
      if (!normalized) return undefined
      const record = getByArk(normalized)
      if (!record) return undefined
      const map = record.arkLabels ?? {}
      return (
        map[normalized] ??
        (normalized.toLowerCase() !== normalized ? map[normalized.toLowerCase()] : undefined) ??
        buildLabelFromIntermarc(record.intermarc, record.typeNorm)
      )
    }

    const inferredExpression =
      target.typeNorm === 'expression'
        ? buildIntermarcExpressionLabel(target.intermarc, target.arkLabels, resolveByArk)
        : undefined
    const inferredWork =
      target.typeNorm === 'oeuvre' ? buildIntermarcWorkLabel(target.intermarc, target.arkLabels) : undefined
    return inferredExpression ?? buildLabelFromIntermarc(target.intermarc, target.typeNorm) ?? inferredWork ?? undefined
  }
}

type DisplayValueResult = { text: string; ark?: string; tooltip?: string }

async function displayValue(
  zoneCode: string,
  _subCode: string,
  valeur: string,
  resolveLabels: boolean,
  arkLabels?: Record<string, string>,
  labelResolver?: (ark: string) => string | undefined,
): Promise<DisplayValueResult> {
  if (!resolveLabels) return { text: valeur }
  if (!looksLikeArk(valeur)) return { text: valeur }
  const trimmed = valeur.trim()
  const providedLabel =
    arkLabels?.[trimmed] ??
    (trimmed.toLowerCase() !== trimmed ? arkLabels?.[trimmed.toLowerCase()] : undefined) ??
    labelResolver?.(trimmed)
  if (providedLabel) {
    const tooltip = trimmed
    return { text: providedLabel, ark: trimmed, tooltip }
  }
  return { text: trimmed }
}

function formatSubLabel(zoneCode: string, rawCode: string): string {
  if (!rawCode) return ''
  if (rawCode.startsWith(zoneCode)) {
    const remainder = rawCode.slice(zoneCode.length)
    if (remainder.startsWith('$')) return remainder.slice(1)
    if (remainder.startsWith('s')) return remainder.slice(1)
    return remainder
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
  arkLabels?: Record<string, string>
  labelResolver?: (ark: string) => string | undefined
}

export function curationClass(flag?: string): string {
  if (!flag) return ''
  const normalized = flag.toLowerCase()
  if (normalized === 'manual') return ' curation-created'
  if (normalized === 'edit') return ' curation-created'
  if (normalized === 'created') return ' curation-created'
  if (normalized === 'deleted') return ' curation-deleted'
  if (normalized === 'clusterfieldgrafting') return ' curation-grafting'
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

    let subZones: SousZone[] = z.sousZones
    let compactParsedToSubzones = false
    if ((!subZones || subZones.length === 0) && z.fieldCompactValue) {
      try {
        type CompactEntry = { code?: unknown; valeur?: unknown; affectedByCuration?: unknown }
        const parsed = JSON.parse(z.fieldCompactValue) as { sousZones?: CompactEntry[] }
        if (parsed && Array.isArray(parsed.sousZones)) {
          compactParsedToSubzones = true
          subZones = parsed.sousZones.map(entry => ({
            code: String(entry.code ?? ''),
            valeur: entry.valeur != null ? String(entry.valeur) : '',
            affectedByCuration:
              typeof entry.affectedByCuration === 'string' ? entry.affectedByCuration : z.affectedByCuration,
          }))
        }
      } catch {
        // fall back to showing the raw compact value (if any)
      }
    }

    if ((!subZones || subZones.length === 0) && z.fieldCompactValue && !compactParsedToSubzones) {
      if (lineText.length) lineText += ' '
      lineText += String(z.fieldCompactValue)
    }

    for (const sz of subZones) {
      const { text: shown, ark, tooltip } = await displayValue(
        z.code,
        sz.code,
        sz.valeur,
        resolveLabels,
        options.arkLabels,
        options.labelResolver,
      )
      const label = formatSubLabel(z.code, sz.code)
      const displayCode = label.startsWith('$') ? label : `$${label}`
      const subfieldStart = lineText.length
      if (lineText.length) lineText += ' '
      lineText += displayCode
      const codeStart = lineText.length - displayCode.length
      const codeEnd = lineText.length
      const zoneIsGrafting = (z.affectedByCuration ?? '').trim().toLowerCase() === 'clusterfieldgrafting'
      const highlight = curationClass(zoneIsGrafting ? z.affectedByCuration : (sz.affectedByCuration ?? z.affectedByCuration))
      marks.push({ className: `intermarc-subfield-code${highlight}`, from: codeStart, to: codeEnd })

      if (shown && shown.length) {
        lineText += ' '
        const valueStart = lineText.length
        lineText += shown
        if (ark) {
          const tooltipText = tooltip ?? ark
          marks.push({
            className: `ark-link has-tooltip${highlight}`,
            from: valueStart,
            to: lineText.length,
            attributes: {
              'data-ark': ark,
              'data-tooltip': tooltipText,
              'aria-label': tooltipText,
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
    if (remainder && !remainder.includes('$')) {
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

export function extractWorkClusterTargets(im: Intermarc): string[] {
  const zones = findZones(im, '90F')
  const targets = new Set<string>()
  zones.forEach(zone => {
    const note = zone.sousZones.find(sz => sz.code === '90F$q')?.valeur?.trim()
    if (!note || (note !== CLUSTER_NOTE && note !== MANUAL_CLUSTER_NOTE)) return
    const target = zone.sousZones.find(sz => sz.code === '90F$3')?.valeur?.trim()
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
    const target = zone.sousZones.find(sz => sz.code === '90F$3')?.valeur?.trim()
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
  // Labels now come from the backend per-record payload; client cache cleared by replacing records.
}
