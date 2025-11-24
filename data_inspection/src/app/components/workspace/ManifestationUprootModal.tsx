import { useMemo } from 'react'
import { useTranslation } from '../../hooks/useTranslation'
import { manifestationTitle, titleOf } from '../../core/entities'
import type { RecordRow } from '../../types'

type Props = {
  manifestation: RecordRow | null
  targetExpression: RecordRow | null
  detachableArks: string[]
  selectedArks: string[]
  lookupExpressionByArk: (ark: string) => RecordRow | null
  onToggle: (ark: string, checked: boolean) => void
  onConfirm: () => void
  onCancel: () => void
}

export function ManifestationUprootModal({
  manifestation,
  targetExpression,
  detachableArks,
  selectedArks,
  lookupExpressionByArk,
  onToggle,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation()
  const expressionOptions = useMemo(
    () =>
      detachableArks.map(ark => {
        const record = lookupExpressionByArk(ark)
        const label = record ? titleOf(record) || record.id : ark
        return { ark, label }
      }),
    [detachableArks, lookupExpressionByArk],
  )

  if (!manifestation || !targetExpression) return null

  const manifestationLabel = manifestationTitle(manifestation) || manifestation.id
  const targetLabel = titleOf(targetExpression) || targetExpression.id
  const canConfirm = selectedArks.length > 0

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h2>
          {t('manifestations.uproot.modalTitle', {
            defaultValue: 'Attacher la manifestation à une expression',
          })}
        </h2>
        <p className="modal-instructions">
          {t('manifestations.uproot.modalIntro', {
            defaultValue:
              'Quelle(s) expression(s) déraciner avant de rattacher « {{manifestation}} » à « {{target}} » ?',
            manifestation: manifestationLabel,
            target: targetLabel,
          })}
        </p>
        <fieldset className="modal-fieldset">
          <legend>
            {t('manifestations.uproot.choiceLegend', {
              defaultValue: 'Expressions à déraciner (740$3)',
            })}
          </legend>
          {expressionOptions.map(option => {
            const checked = selectedArks.includes(option.ark)
            return (
              <label key={option.ark} className="modal-checkbox">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={event => onToggle(option.ark, event.target.checked)}
                />
                <div className="modal-checkbox__body">
                  <span className="modal-checkbox__label">{option.label}</span>
                  <small className="muted modal-checkbox__ark">{option.ark}</small>
                </div>
              </label>
            )
          })}
          {expressionOptions.length === 0 ? (
            <p className="modal-note">
              {t('manifestations.uproot.noExpressions', {
                defaultValue: 'Cette manifestation ne comporte aucun champ 740$3.',
              })}
            </p>
          ) : null}
        </fieldset>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            {t('buttons.cancel', { defaultValue: 'Annuler' })}
          </button>
          <button
            type="button"
            className="workspace-side-toolbar__button--primary"
            disabled={!canConfirm}
            onClick={onConfirm}
          >
            {t('manifestations.uproot.confirm', { defaultValue: 'Confirmer le rattachement' })}
          </button>
        </div>
      </div>
    </div>
  )
}
