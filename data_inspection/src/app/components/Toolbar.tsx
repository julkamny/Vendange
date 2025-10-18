import { useTranslation } from '../hooks/useTranslation'
import { supportedLanguages, changeLanguage, getCurrentLanguage } from '../i18n'
import { useTheme } from '../providers/ThemeContext'
import type { ChangeEvent } from 'react'

type ToolbarProps = {
  visible: boolean
  onToggleVisible: () => void
  onOpenUpload: () => void
  onOpenSearch: () => void
  onOpenShortcuts: () => void
  onExport: () => void
  exportDisabled: boolean
}

export function Toolbar({
  visible,
  onToggleVisible,
  onOpenUpload,
  onOpenSearch,
  onOpenShortcuts,
  onExport,
  exportDisabled,
}: ToolbarProps) {
  const { t } = useTranslation()
  const { mode, toggle } = useTheme()

  const themeLabel = mode === 'dark' ? t('theme.switchToLight') : t('theme.switchToDark')
  const language = getCurrentLanguage()

  const handleLanguageChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value
    if (next && next !== language) changeLanguage(next)
  }

  const toggleLabel = visible ? t('toolbarToggle.hide') : t('toolbarToggle.show')

  return (
    <div className={`app-toolbar${visible ? ' is-visible' : ' is-collapsed'}`}>
      <button
        className={`toolbar-toggle${visible ? ' is-active' : ''}`}
        type="button"
        onClick={onToggleVisible}
        aria-expanded={visible}
        aria-label={toggleLabel}
      >
        🛠️
      </button>
      <header className={`toolbar${visible ? ' toolbar--visible' : ' toolbar--collapsed'}`}>
        <div className="toolbar-left">
          <button type="button" onClick={onOpenUpload}>
            {t('toolbar.loadCsv')}
          </button>
          <button type="button" onClick={onOpenSearch}>
            {t('toolbar.search')}
          </button>
          <button type="button" onClick={toggle} aria-pressed={mode === 'light'}>
            {themeLabel}
          </button>
          <button type="button" onClick={onOpenShortcuts}>
            {t('toolbar.shortcuts')}
          </button>
        </div>
        <div className="spacer" />
        <select className="language-select" aria-label={t('language.ariaLabel')} value={language} onChange={handleLanguageChange}>
          {supportedLanguages.map(lng => (
            <option key={lng} value={lng}>
              {t(`language.options.${lng}`)}
            </option>
          ))}
        </select>
        <button type="button" onClick={onExport} disabled={exportDisabled}>
          {t('toolbar.export')}
        </button>
      </header>
    </div>
  )
}
