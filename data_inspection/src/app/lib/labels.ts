import type { EntityTitleSegment, RecordRow } from '../types'

const ARK_REGEX = /ark:\/\S+/g

function decorateArks(text: string, arkLabels?: Record<string, string>): string {
  if (!text || !text.includes('ark:/') || !arkLabels) return text
  const matches = Array.from(new Set(text.match(ARK_REGEX) ?? []))
  if (!matches.length) return text
  let updated = text
  let changed = false
  matches.forEach(ark => {
    const label = arkLabels[ark] ?? arkLabels[ark.toLowerCase()]
    if (!label || label === ark || !updated.includes(ark)) return
    updated = updated.split(ark).join(label)
    changed = true
  })
  return changed ? updated : text
}

function joinSegments(
  segments?: EntityTitleSegment[] | null,
  arkLabels?: Record<string, string>,
): string | undefined {
  if (!segments || !segments.length) return undefined
  const values = segments
    .map(segment => segment.value?.trim())
    .filter((value): value is string => Boolean(value))
  if (!values.length) return undefined
  return decorateArks(values.join(' '), arkLabels)
}

export function labelForRecord(
  record?: Pick<RecordRow, 'label' | 'titleSegments' | 'id' | 'arkLabels' | 'ark'> | null,
): string | undefined {
  if (!record) return undefined
  /** Prefer title segments when the label is missing or only repeats the record identifier. */
  const segmentLabel = joinSegments(record.titleSegments, record.arkLabels)
  const label = record.label?.trim()
  if (label) {
    const decorated = decorateArks(label, record.arkLabels)
    const isIdentifierOnly = decorated === record.id || (!!record.ark && decorated === record.ark)
    if (!decorated.includes('ark:/') && !isIdentifierOnly) return decorated
    return segmentLabel ?? decorated
  }
  return segmentLabel ?? record.id
}
