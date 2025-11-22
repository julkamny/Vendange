import { useCallback } from 'react'
import { expressionsShareParentWork, expressionWorkArks, worksClusteredTogether } from '../../core/entities'
import {
  extractWorkClusterTargets,
  extractExpressionClusterTargets,
  type Intermarc,
} from '../../lib/intermarc'
import type { Cluster, RecordRow } from '../../types'

type TranslationFn = ReturnType<typeof import('../../hooks/useTranslation')['useTranslation']>['t']

type UseIntermarcSaveGuardsArgs = {
  clusters: Cluster[]
  getById: (id: string) => RecordRow | null
  getByArk: (ark: string) => RecordRow | null
  updateRecordIntermarc: (id: string, intermarc: Intermarc) => void
  t: TranslationFn
  pendingClusterSourceId: string | null
  pendingClusterSourceRecord: RecordRow | null
  pendingExpressionClusterSourceId: string | null
  pendingExpressionClusterSourceRecord: RecordRow | null
  workClusterIndex: Map<string, { anchorId: string; anchorLabel?: string | null }>
  expressionClusterIndex: Map<string, { anchorId: string; anchorExpressionId: string; anchorLabel?: string | null }>
  getExpressionClusterMembership: (target: RecordRow | null) => { anchorId: string; anchorExpressionId: string } | null
  isProtectedWorkAnchor: (target: RecordRow | null) => boolean
  isProtectedExpressionAnchor: (target: RecordRow | null) => boolean
}

export function useIntermarcSaveGuards({
  clusters,
  getById,
  getByArk,
  updateRecordIntermarc,
  t,
  pendingClusterSourceId,
  pendingClusterSourceRecord,
  pendingExpressionClusterSourceId,
  pendingExpressionClusterSourceRecord,
  workClusterIndex,
  expressionClusterIndex,
  getExpressionClusterMembership,
  isProtectedWorkAnchor,
  isProtectedExpressionAnchor,
}: UseIntermarcSaveGuardsArgs) {
  return useCallback(
    (targetRecord: RecordRow, next: Intermarc) => {
      if (targetRecord.typeNorm === 'oeuvre') {
        if (pendingClusterSourceId && pendingClusterSourceId !== targetRecord.id) {
          const pendingArk = pendingClusterSourceRecord?.ark
          if (pendingArk) {
            const targets = extractWorkClusterTargets(next)
            if (targets.includes(pendingArk)) {
              throw new Error(
                t('works.cluster.pendingAlreadySelected', {
                  defaultValue: 'Impossible : cette œuvre est déjà marquée pour un rattachement.',
                }),
              )
            }
          }
        }

        const targets = extractWorkClusterTargets(next)
        const conflicts: string[] = []
        targets.forEach(target => {
          const conflict = workClusterIndex.get(target)
          if (conflict && conflict.anchorId !== targetRecord.id) {
            const label = conflict.anchorLabel || conflict.anchorId
            conflicts.push(`${target} (ancré sur ${label})`)
          }
          const targetRecordRow = getByArk(target) || getById(target.replace(/^ark:\//, '')) || null
          if (isProtectedWorkAnchor(targetRecordRow)) {
            conflicts.push(
              t('works.cluster.targetIsAnchor', {
                defaultValue: 'Impossible : une cible est déjà ancre d’un cluster.',
              }),
            )
          }
        })

        if (conflicts.length) {
          throw new Error(
            `Impossible d'enregistrer : ces œuvres sont déjà rattachées à un autre cluster : ${conflicts.join(', ')}`,
          )
        }

        updateRecordIntermarc(targetRecord.id, next)
        return
      }

      if (targetRecord.typeNorm === 'expression') {
        if (pendingExpressionClusterSourceId && pendingExpressionClusterSourceId !== targetRecord.id) {
          const pendingArk = pendingExpressionClusterSourceRecord?.ark
          if (pendingArk) {
            const targets = extractExpressionClusterTargets(next)
            if (targets.includes(pendingArk)) {
              throw new Error(
                t('expressions.cluster.pendingAlreadySelected', {
                  defaultValue: 'Impossible : cette expression est déjà marquée pour un rattachement.',
                }),
              )
            }
          }
        }

        const targets = extractExpressionClusterTargets(next)
        const sourceMembership = getExpressionClusterMembership(targetRecord)
        if (sourceMembership && targets.length > 0) {
          throw new Error(
            t('expressions.cluster.anchorAlreadyClustered', {
              defaultValue: "Impossible : une expression déjà rattachée à un cluster ne peut pas en devenir l'ancre.",
            }),
          )
        }
        const conflicts: string[] = []
        targets.forEach(target => {
          const conflict = expressionClusterIndex.get(target)
          if (conflict && conflict.anchorExpressionId !== targetRecord.id) {
            const label = conflict.anchorExpressionId
            conflicts.push(`${target} (ancré sur ${label})`)
          }
          const targetRecordRow = getByArk(target) || getById(target.replace(/^ark:\//, '')) || null
          if (isProtectedExpressionAnchor(targetRecordRow)) {
            conflicts.push(
              t('expressions.cluster.targetIsAnchor', {
                defaultValue: 'Impossible : la cible est déjà ancre d’un cluster.',
              }),
            )
          }
          if (targetRecordRow && targetRecordRow.typeNorm === 'expression') {
            const parentOverlap = expressionsShareParentWork(targetRecord, targetRecordRow)
            const clusteredParents =
              worksClusteredTogether(
                expressionWorkArks(targetRecord)[0],
                expressionWorkArks(targetRecordRow)[0],
                clusters,
              )
            if (!parentOverlap && !clusteredParents) {
              conflicts.push(
                t('expressions.cluster.parentMismatch', {
                  defaultValue:
                    'Impossible : les expressions doivent partager la même œuvre parente ou des parents déjà en cluster.',
                }),
              )
            }
          } else if (!targetRecordRow) {
            conflicts.push(
              t('expressions.cluster.parentMismatch', {
                defaultValue: 'Impossible : parent non vérifiable pour la cible.',
              }),
            )
          }
        })

        if (conflicts.length) {
          throw new Error(conflicts.join(' '))
        }

        updateRecordIntermarc(targetRecord.id, next)
        return
      }

      updateRecordIntermarc(targetRecord.id, next)
    },
    [
      clusters,
      expressionClusterIndex,
      getByArk,
      getById,
      getExpressionClusterMembership,
      isProtectedExpressionAnchor,
      isProtectedWorkAnchor,
      pendingClusterSourceId,
      pendingClusterSourceRecord,
      pendingExpressionClusterSourceId,
      pendingExpressionClusterSourceRecord,
      t,
      updateRecordIntermarc,
      workClusterIndex,
    ],
  )
}
