import { useTranslation } from '../../hooks/useTranslation'
import { titleOf } from '../../core/entities'
import type { RecordRow } from '../../types'

type Props = {
  source: RecordRow | null
  target: RecordRow | null
  onConfirm: () => void
  onCancel: () => void
}

export function OriginalitySwapModal({ source, target, onConfirm, onCancel }: Props) {
  const { t } = useTranslation()
  if (!source || !target) return null

  const sourceLabel = titleOf(source) || source.id
  const targetLabel = titleOf(target) || target.id

  const title = t('works.originalitySwap.confirmTitle', {
    defaultValue: "Confirmer le transfert d'originalité",
  })

  const body = t('works.originalitySwap.confirmBody', {
    defaultValue:
      "Désigner « {{target}} » ({{targetArk}}) comme œuvre originale et rattacher ses adaptations depuis « {{source}} » ({{sourceArk}}) ?",
    source: sourceLabel,
    target: targetLabel,
    sourceArk: source.ark ?? source.id,
    targetArk: target.ark ?? target.id,
  })

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h3>{title}</h3>
        <p>{body}</p>
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
