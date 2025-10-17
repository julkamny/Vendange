import { useAppData } from '../providers/AppDataContext'
import { useTranslation } from '../hooks/useTranslation'
import type { ChangeEvent } from 'react'

type UploadModalProps = {
  open: boolean
  onClose: () => void
}

export function UploadModal({ open, onClose }: UploadModalProps) {
  const { loadOriginal, loadCurated, loadDefaults } = useAppData()
  const { t } = useTranslation()

  if (!open) return null

  const handleOriginalChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) await loadOriginal(file)
  }

  const handleCuratedChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) await loadCurated(file)
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <button type="button" className="modal-close" onClick={onClose} aria-label={t('uploadModal.close')}>
          ×
        </button>
        <h2>{t('uploadModal.title')}</h2>
        <p className="modal-instructions">{t('uploadModal.instructions')}</p>
        <div className="modal-inputs">
          <label className="modal-file">
            <span>{t('uploadModal.original')}</span>
            <input type="file" accept=".csv" onChange={handleOriginalChange} />
          </label>
          <label className="modal-file">
            <span>{t('uploadModal.curated')}</span>
            <input type="file" accept=".csv" onChange={handleCuratedChange} />
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" onClick={loadDefaults}>
            {t('uploadModal.loadDefaults', { defaultValue: 'Load defaults' })}
          </button>
          <button type="button" onClick={onClose}>
            {t('uploadModal.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
