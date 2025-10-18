import { useEffect } from 'react'
import { SearchPanel } from '../search/SearchPanel'
import { useTranslation } from '../hooks/useTranslation'

type SearchModalProps = {
  open: boolean
  onClose: () => void
}

export function SearchModal({ open, onClose }: SearchModalProps) {
  const { t } = useTranslation()

  useEffect(() => {
    if (open) {
      document.body.classList.add('modal-open')
      return () => {
        document.body.classList.remove('modal-open')
      }
    }
    return undefined
  }, [open])

  if (!open) return null

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal modal--search">
        <header className="modal__header">
          <h2>{t('search.title')}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label={t('search.close')}>
            ×
          </button>
        </header>
        <div className="modal__content">
          <SearchPanel />
        </div>
      </div>
    </div>
  )
}
