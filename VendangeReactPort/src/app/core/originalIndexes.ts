import type { RecordRow } from '../types'
import { expressionWorkArks, manifestationExpressionArks, titleOf, manifestationTitle } from './entities'

export type OriginalIndexes = {
  worksByArk: Map<string, RecordRow>
  expressionsByArk: Map<string, RecordRow>
  expressionsByWorkArk: Map<string, RecordRow[]>
  manifestationsByExpressionArk: Map<string, RecordRow[]>
}

export function buildOriginalIndexes(records: RecordRow[], language: string): OriginalIndexes {
  const worksByArk = new Map<string, RecordRow>()
  const expressionsByArk = new Map<string, RecordRow>()
  const expressionsByWorkArk = new Map<string, RecordRow[]>()
  const manifestationsByExpressionArk = new Map<string, RecordRow[]>()

  for (const rec of records) {
    if (rec.ark && rec.typeNorm === 'oeuvre') {
      worksByArk.set(rec.ark, rec)
      continue
    }
    if (rec.typeNorm === 'expression') {
      if (rec.ark) expressionsByArk.set(rec.ark, rec)
      const workArks = expressionWorkArks(rec)
      for (const workArk of workArks) {
        if (!expressionsByWorkArk.has(workArk)) expressionsByWorkArk.set(workArk, [])
        expressionsByWorkArk.get(workArk)!.push(rec)
      }
      continue
    }
    if (rec.typeNorm === 'manifestation') {
      const expressionArks = manifestationExpressionArks(rec)
      for (const exprArk of expressionArks) {
        if (!manifestationsByExpressionArk.has(exprArk)) manifestationsByExpressionArk.set(exprArk, [])
        manifestationsByExpressionArk.get(exprArk)!.push(rec)
      }
    }
  }

  const collator = new Intl.Collator(language, { sensitivity: 'accent' })

  expressionsByWorkArk.forEach(list => {
    list.sort((a, b) => collator.compare(titleOf(a) || a.id, titleOf(b) || b.id))
  })
  manifestationsByExpressionArk.forEach(list => {
    list.sort((a, b) => collator.compare(manifestationTitle(a) || a.id, manifestationTitle(b) || b.id))
  })

  return { worksByArk, expressionsByArk, expressionsByWorkArk, manifestationsByExpressionArk }
}
