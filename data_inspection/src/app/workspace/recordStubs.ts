import type { ExpressionClusterItem, ExpressionItem, ManifestationItem, RecordRow } from '../types'

function buildTitleZone(title?: string | null, fieldCode: string = '150'): { code: string; sousZones: Array<{ code: string; valeur?: unknown }> }[] {
  if (!title) return []
  return [{ code: fieldCode, sousZones: [{ code: `${fieldCode}$a`, valeur: title }] }]
}

export function stubWorkRecord(
  id: string,
  ark?: string | null,
  title?: string | null,
  titleSegments?: RecordRow['titleSegments'],
): RecordRow {
  return {
    id,
    type: 'Oeuvre',
    typeNorm: 'oeuvre',
    ark: ark ?? undefined,
    label: title ?? null,
    titleSegments,
    intermarc: { zones: buildTitleZone(title) },
    intermarcStr: '',
    raw: [],
    arkLabels: {},
    rowIndex: 0,
  }
}

export function stubExpressionRecord(
  expr: ExpressionItem | ExpressionClusterItem,
  workArk?: string | null,
): RecordRow {
  const linkZones = workArk
    ? [{ code: '750', sousZones: [{ code: '750$3', valeur: workArk }] }]
    : []
  return {
    id: expr.id,
    type: 'Expression',
    typeNorm: 'expression',
    ark: expr.ark ?? undefined,
    label: expr.title ?? null,
    titleSegments: expr.titleSegments,
    intermarc: { zones: [...buildTitleZone(expr.title, '140'), ...linkZones] },
    intermarcStr: '',
    raw: [],
    arkLabels: {},
    rowIndex: 0,
  }
}

export function stubManifestationRecord(man: ManifestationItem, expressionArk?: string | null): RecordRow {
  const linkZones = expressionArk
    ? [{ code: '740', sousZones: [{ code: '740$3', valeur: expressionArk }] }]
    : []
  return {
    id: man.id,
    type: 'Manifestation',
    typeNorm: 'manifestation',
    ark: man.ark ?? undefined,
    label: man.title ?? null,
    titleSegments: man.titleSegments,
    intermarc: { zones: [...buildTitleZone(man.title, '245'), ...linkZones] },
    intermarcStr: '',
    raw: [],
    arkLabels: {},
    rowIndex: 0,
  }
}
