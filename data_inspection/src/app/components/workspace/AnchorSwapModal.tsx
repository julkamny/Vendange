import { useTranslation } from '../../hooks/useTranslation'
import { titleOf } from '../../core/entities'
import type { RecordRow } from '../../types'

type Props = {
  kind: 'work' | 'expression'
  source: RecordRow | null
  anchor: RecordRow | null
  onConfirm: () => void
  onCancel: () => void
}

export function AnchorSwapModal({ kind, source, anchor, onConfirm, onCancel }: Props) {
  const { t } = useTranslation()
  if (!source || !anchor) return null

  const sourceLabel = titleOf(source) || source.id
  const anchorLabel = titleOf(anchor) || anchor.id

  const title =
    kind === 'work'
      ? t('works.anchorSwap.confirmTitle', { defaultValue: "Confirmer le changement d'ancre" })
      : t('expressions.anchorSwap.confirmTitle', { defaultValue: "Confirmer le changement d'ancre" })

  const bodyDefault =
    kind === 'work'
      ? "Remplacer l'ancre du cluster par « {{source}} » ({{sourceArk}}) à la place de « {{anchor}} » ({{anchorArk}}) ?"
      : "Remplacer l'ancre du cluster d'expressions par « {{source}} » ({{sourceArk}}) à la place de « {{anchor}} » ({{anchorArk}}) ?"

  const body =
    kind === 'work'
      ? t('works.anchorSwap.confirmBody', {
          defaultValue: bodyDefault,
          source: sourceLabel,
          anchor: anchorLabel,
          sourceArk: source.ark ?? source.id,
          anchorArk: anchor.ark ?? anchor.id,
        })
      : t('expressions.anchorSwap.confirmBody', {
          defaultValue: bodyDefault,
          source: sourceLabel,
          anchor: anchorLabel,
          sourceArk: source.ark ?? source.id,
          anchorArk: anchor.ark ?? anchor.id,
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
