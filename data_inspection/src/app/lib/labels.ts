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
  record?: Pick<RecordRow, 'label' | 'titleSegments' | 'id' | 'arkLabels'> | null,
): string | undefined {
  if (!record) return undefined
  const label = record.label?.trim()
  if (label) {
    const decorated = decorateArks(label, record.arkLabels)
    if (!decorated.includes('ark:/')) return decorated
    const segmentLabel = joinSegments(record.titleSegments, record.arkLabels)
    return segmentLabel ?? decorated
  }
  return joinSegments(record.titleSegments, record.arkLabels) ?? record.id
}
