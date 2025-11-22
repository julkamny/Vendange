import { useMemo } from 'react'
import { expressionWorkArks, manifestationTitle, titleOf } from '../../core/entities'
import type { RecordRow } from '../../types'
import type { WorkspaceTabStateWorkspace } from '../../workspace/types'

export function useWorkspaceBreadcrumbs(
  state: WorkspaceTabStateWorkspace,
  record: RecordRow | null,
  getById: (id: string) => RecordRow | null,
  getByArk: (ark?: string | null) => RecordRow | null,
) {
  return useMemo(() => {
    const items: string[] = []

    const addLabel = (value?: string | null) => {
      if (!value) return
      const trimmed = value.trim()
      if (!trimmed) return
      if (items[items.length - 1] === trimmed) return
      items.push(trimmed)
    }

    const labelFromRecord = (rec?: RecordRow | null, fallback?: string) => {
      if (!rec) return fallback
      if (rec.typeNorm === 'manifestation') {
        return manifestationTitle(rec) || rec.id
      }
      return titleOf(rec) || rec.id
    }

    const selected = state.selectedEntity
    if (!selected) return items

    if (selected.entityType === 'work') {
      const workRecord = getById(selected.id) || getByArk(selected.workArk)
      addLabel(labelFromRecord(workRecord, selected.id))
      return items
    }

    if (selected.entityType === 'expression') {
      const workRecord = selected.workArk ? getByArk(selected.workArk) : undefined
      if (workRecord) addLabel(labelFromRecord(workRecord, workRecord.id))
      else if (selected.workArk) addLabel(selected.workArk)
      const expressionRecord =
        (selected.expressionId && getById(selected.expressionId)) ||
        getById(selected.id) ||
        getByArk(selected.expressionArk)
      addLabel(labelFromRecord(expressionRecord, selected.expressionId || selected.id))
      return items
    }

    if (selected.entityType === 'manifestation') {
      const expressionRecord =
        (selected.expressionId && getById(selected.expressionId)) ||
        getByArk(selected.expressionArk)
      if (expressionRecord) {
        const relatedWorkArk = selected.workArk || expressionWorkArks(expressionRecord)[0]
        if (relatedWorkArk) {
          const workRecord = getByArk(relatedWorkArk)
          addLabel(labelFromRecord(workRecord, relatedWorkArk))
        }
        addLabel(labelFromRecord(expressionRecord, expressionRecord.id))
      }
      const manifestationRecord = record || getById(selected.id) || getByArk(selected.id)
      addLabel(labelFromRecord(manifestationRecord, selected.id))
      return items
    }

    addLabel(selected.id)
    return items
  }, [getByArk, getById, record, state.selectedEntity])
}
