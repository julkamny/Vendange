import { parseIntermarc } from './intermarc'
import { normalizeType } from '../core/records'
import type { RecordRow, WorkRecordPayload } from '../types'

export function buildRecordRowFromPayload(payload: WorkRecordPayload): RecordRow {
  const intermarc = parseIntermarc(payload.intermarc)
  return {
    id: payload.id,
    type: payload.type,
    typeNorm: normalizeType(payload.type),
    ark: payload.ark ?? undefined,
    label: payload.label ?? null,
    titleSegments: payload.title_segments ?? [],
    arkLabels: payload.arkLabels ?? payload.ark_labels ?? {},
    rowIndex: 0,
    intermarcStr: payload.intermarc,
    intermarc,
    raw: [],
  }
}
