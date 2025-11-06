import type { BacklinkInfo } from '../hooks/useBacklinks'
import type { RecordRow, EntityTitleSegment } from '../types'
import { EntityLabel } from './EntityLabel'
import { workTitleSegments, manifestationTitleSegments, expression140Segments, titleOf, manifestationTitle } from '../core/entities'
import { useTranslation } from '../hooks/useTranslation'

type BacklinksPanelProps = {
  backlinks: BacklinkInfo[]
  onOpenArk: (ark: string) => void
  lookupWorkByArk: (ark: string) => RecordRow | undefined
}

function segmentsForRecord(
  record: RecordRow,
  lookupWorkByArk: (ark: string) => RecordRow | undefined,
): { title: string; segments?: EntityTitleSegment[] } {
  const type = record.typeNorm.toLowerCase()
  if (type === 'oeuvre') {
    return {
      title: titleOf(record) || record.id,
      segments: workTitleSegments(record),
    }
  }
  if (type === 'expression') {
    const segments = expression140Segments(record, { lookupWorkByArk })
    const title = segments.length ? titleOf(record) || record.id : titleOf(record) || record.id
    return { title, segments: segments.length ? segments : undefined }
  }
  if (type === 'manifestation') {
    return {
      title: manifestationTitle(record) || record.id,
      segments: manifestationTitleSegments(record),
    }
  }
  return { title: titleOf(record) || record.id }
}

export function BacklinksPanel({ backlinks, onOpenArk, lookupWorkByArk }: BacklinksPanelProps) {
  const { t } = useTranslation()

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
            const { record, fields } = entry
            const { title, segments } = segmentsForRecord(record, lookupWorkByArk)
            const arkValue = record.ark
            return (
              <tr key={record.id}>
                <td>
                  <EntityLabel title={title} titleSegments={segments} />
                </td>
                <td>
                  {arkValue ? (
                    <button
                      type="button"
                      className="ark-link backlinks-panel__ark-button"
                      data-ark={arkValue}
                      onClick={() => onOpenArk(arkValue)}
                    >
                      {arkValue}
                    </button>
                  ) : (
                    <span className="backlinks-panel__no-ark">—</span>
                  )}
                </td>
                <td>
                  <span className="backlinks-panel__fields">{fields.join(', ')}</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
