import type { ChangeEvent } from 'react'
import { useShortcuts } from '../providers/ShortcutContext'
import { useTranslation } from '../hooks/useTranslation'
import type { ShortcutAction } from '../core/shortcuts'

type ShortcutModalProps = {
  open: boolean
  onClose: () => void
}

export function ShortcutModal({ open, onClose }: ShortcutModalProps) {
  const { shortcuts, bindings, updateBinding, resetBindings } = useShortcuts()
  const { t } = useTranslation()

  if (!open) return null

  const handleChange = (action: ShortcutAction) => (event: ChangeEvent<HTMLInputElement>) => {
    updateBinding(action, event.target.value)
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal shortcuts-modal">
        <button type="button" className="modal-close" onClick={onClose} aria-label={t('uploadModal.close')}>
          ×
        </button>
        <h2>{t('shortcutsModal.title')}</h2>
        <p className="modal-instructions">{t('shortcutsModal.instructions')}</p>
        <div className="shortcut-list">
          {shortcuts.map(shortcut => (
            <label key={shortcut.action} className="shortcut-entry">
              <span className="shortcut-label">{t(shortcut.labelKey)}</span>
              <input type="text" value={bindings[shortcut.action]} onChange={handleChange(shortcut.action)} />
              <small>{t(shortcut.descriptionKey)}</small>
            </label>
          ))}
        </div>
        <div className="modal-actions">
          <button type="button" onClick={resetBindings}>
            {t('shortcutsModal.reset')}
          </button>
          <button type="button" onClick={onClose}>
            {t('shortcutsModal.done')}
          </button>
        </div>
      </div>
    </div>
  )
}
