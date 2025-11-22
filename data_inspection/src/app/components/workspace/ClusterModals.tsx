import { useTranslation } from '../../hooks/useTranslation'
import { titleOf } from '../../core/entities'
import type { RecordRow } from '../../types'

export type ConfirmWorkClusterModalProps = {
  source: RecordRow | null
  anchor: RecordRow | null
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmWorkClusterModal({ source, anchor, onConfirm, onCancel }: ConfirmWorkClusterModalProps) {
  const { t } = useTranslation()
  if (!source || !anchor) return null

  const sourceLabel = titleOf(source) || source.id
  const anchorLabel = titleOf(anchor) || anchor.id

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h3>{t('works.cluster.confirmTitle', { defaultValue: 'Confirmer la clusterisation' })}</h3>
        <p>
          {t('works.cluster.confirmBody', {
            defaultValue: 'Rattacher « {{source}} » ({{sourceArk}}) au cluster de « {{anchor}} » ({{anchorArk}}) ?',
            source: sourceLabel,
            anchor: anchorLabel,
            sourceArk: source.ark ?? source.id,
            anchorArk: anchor.ark ?? anchor.id,
          })}
        </p>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            {t('buttons.cancel', { defaultValue: 'Annuler' })}
          </button>
          <button type="button" className="workspace-side-toolbar__button--primary" onClick={onConfirm}>
            {t('buttons.confirm', { defaultValue: 'Confirmer' })}
          </button>
        </div>
      </div>
    </div>
  )
}

export type ConfirmExpressionClusterModalProps = {
  source: RecordRow | null
  anchor: RecordRow | null
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmExpressionClusterModal({
  source,
  anchor,
  onConfirm,
  onCancel,
}: ConfirmExpressionClusterModalProps) {
  const { t } = useTranslation()
  if (!source || !anchor) return null

  const sourceLabel = titleOf(source) || source.id
  const anchorLabel = titleOf(anchor) || anchor.id

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h3>{t('expressions.cluster.confirmTitle', { defaultValue: 'Confirmer la clusterisation' })}</h3>
        <p>
          {t('expressions.cluster.confirmBody', {
            defaultValue:
              'Rattacher « {{source}} » ({{sourceArk}}) au cluster de « {{anchor}} » ({{anchorArk}}) ?',
            source: sourceLabel,
            anchor: anchorLabel,
            sourceArk: source.ark ?? source.id,
            anchorArk: anchor.ark ?? anchor.id,
          })}
        </p>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            {t('buttons.cancel', { defaultValue: 'Annuler' })}
          </button>
          <button type="button" className="workspace-side-toolbar__button--primary" onClick={onConfirm}>
            {t('buttons.confirm', { defaultValue: 'Confirmer' })}
          </button>
        </div>
      </div>
    </div>
  )
}
