import { useCallback, useEffect, useState } from 'react'
import { useShortcuts } from '../providers/ShortcutContext'
import { useTranslation } from '../hooks/useTranslation'
import { formatShortcutFromEvent, type ShortcutAction } from '../core/shortcuts'

type ShortcutModalProps = {
  open: boolean
  onClose: () => void
}

export function ShortcutModal({ open, onClose }: ShortcutModalProps) {
  const { shortcuts, bindings, updateBinding, resetBindings } = useShortcuts()
  const { t } = useTranslation()
  const [recordingAction, setRecordingAction] = useState<ShortcutAction | null>(null)

  useEffect(() => {
    if (!open && recordingAction) {
      setRecordingAction(null)
    }
  }, [open, recordingAction])

  useEffect(() => {
    if (!recordingAction) return

    const handleKeydown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()

      if (event.key === 'Escape') {
        setRecordingAction(null)
        return
      }

      const formatted = formatShortcutFromEvent(event)
      if (!formatted) return

      const action = recordingAction
      setRecordingAction(null)
      updateBinding(action, formatted)

      for (const shortcut of shortcuts) {
        if (shortcut.action === action) continue
        const existing = bindings[shortcut.action]
        if (existing && existing.toLowerCase() === formatted.toLowerCase()) {
          updateBinding(shortcut.action, shortcut.defaultBinding)
        }
      }
    }

    const handleKeyup = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
    }

    window.addEventListener('keydown', handleKeydown, true)
    window.addEventListener('keyup', handleKeyup, true)
    return () => {
      window.removeEventListener('keydown', handleKeydown, true)
      window.removeEventListener('keyup', handleKeyup, true)
    }
  }, [recordingAction, bindings, shortcuts, updateBinding])

  const beginRecording = useCallback((action: ShortcutAction) => {
    setRecordingAction(action)
  }, [])

  const handleReset = useCallback(() => {
    setRecordingAction(null)
    resetBindings()
  }, [resetBindings])

  const handleClose = useCallback(() => {
    setRecordingAction(null)
    onClose()
  }, [onClose])

  if (!open) return null

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal shortcuts-modal">
        <button type="button" className="modal-close" onClick={handleClose} aria-label={t('uploadModal.close')}>
          ×
        </button>
        <h2>{t('shortcutsModal.title')}</h2>
        <p className="modal-instructions">{t('shortcutsModal.instructions')}</p>
        <div className="shortcut-list">
          {shortcuts.map(shortcut => {
            const binding = bindings[shortcut.action]
            const isRecording = recordingAction === shortcut.action
            const label = isRecording ? t('shortcutsModal.recordPrompt') : binding || '—'

            return (
              <div key={shortcut.action} className="shortcut-row">
                <div className="shortcut-info">
                  <span className="shortcut-name">{t(shortcut.labelKey)}</span>
                  <span className="shortcut-description">{t(shortcut.descriptionKey)}</span>
                </div>
                <button
                  type="button"
                  className={`shortcut-binding${isRecording ? ' recording' : ''}`}
                  onClick={() => beginRecording(shortcut.action)}
                >
                  {label}
                </button>
              </div>
            )
          })}
        </div>
        <div className="modal-actions">
          <button type="button" onClick={handleReset}>
            {t('shortcutsModal.reset')}
          </button>
          <button type="button" onClick={handleClose}>
            {t('shortcutsModal.done')}
          </button>
        </div>
      </div>
    </div>
  )
}
