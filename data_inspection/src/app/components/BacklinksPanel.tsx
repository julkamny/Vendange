import type { MouseEvent } from 'react'
import type { BacklinkItem } from '../types'
import { EntityLabel } from './EntityLabel'
import { useTranslation } from '../hooks/useTranslation'

type BacklinksPanelProps = {
  backlinks: BacklinkItem[]
  loading?: boolean
  onOpenArk: (ark: string) => void
  onArkContextMenu?: (event: MouseEvent<HTMLElement>) => void
}

export function BacklinksPanel({ backlinks, loading, onOpenArk, onArkContextMenu }: BacklinksPanelProps) {
  const { t } = useTranslation()

  if (loading) {
    return (
      <section className="backlinks-panel">
        <header className="backlinks-panel__header">
          <h4>{t('backlinks.title')}</h4>
        </header>
        <p className="backlinks-panel__empty">{t('messages.loadingIntermarc')}</p>
      </section>
    )
  }

  if (!backlinks.length) {
    return (
      <section className="backlinks-panel">
        <header className="backlinks-panel__header">
          <h4>{t('backlinks.title')}</h4>
        </header>
        <p className="backlinks-panel__empty">{t('backlinks.empty')}</p>
      </section>
    )
  }

  return (
    <section className="backlinks-panel">
      <header className="backlinks-panel__header">
        <h4>{t('backlinks.title')}</h4>
        <span className="backlinks-panel__count">{t('backlinks.count', { count: backlinks.length })}</span>
      </header>
      <table className="backlinks-panel__table">
        <thead>
          <tr>
            <th scope="col">{t('backlinks.columns.source')}</th>
            <th scope="col">{t('backlinks.columns.ark')}</th>
            <th scope="col">{t('backlinks.columns.fields')}</th>
          </tr>
        </thead>
        <tbody>
          {backlinks.map(entry => {
            const arkValue = entry.ark
            return (
              <tr key={entry.id}>
                <td>
                  <EntityLabel title={entry.title} titleSegments={entry.titleSegments} />
                </td>
                <td>
                  {arkValue ? (
                    <button
                      type="button"
                      className="ark-link backlinks-panel__ark-button"
                      data-ark={arkValue}
                      onClick={() => onOpenArk(arkValue)}
                      onContextMenu={onArkContextMenu}
                    >
                      {arkValue}
                    </button>
                  ) : (
                    <span className="backlinks-panel__no-ark">—</span>
                  )}
                </td>
                <td>
                  <span className="backlinks-panel__fields">{entry.fields.join(', ')}</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
