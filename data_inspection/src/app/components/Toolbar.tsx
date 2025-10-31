import { useTranslation } from '../hooks/useTranslation'
import { supportedLanguages, changeLanguage } from '../i18n'
import { useTheme } from '../providers/ThemeContext'
import type { ChangeEvent } from 'react'

type ToolbarProps = {
  visible: boolean
  atTop: boolean
  onToggleVisible: () => void
  onOpenUpload: () => void
  onOpenShortcuts: () => void
  onExport: () => void
  exportDisabled: boolean
  onNavigateHome?: () => void
}

export function Toolbar({
  visible,
  atTop,
  onToggleVisible,
  onOpenUpload,
  onOpenShortcuts,
  onExport,
  exportDisabled,
  onNavigateHome,
}: ToolbarProps) {
  const { t, language } = useTranslation()
  const { mode, toggle } = useTheme()

  const themeLabel = mode === 'dark' ? t('theme.switchToLight') : t('theme.switchToDark')

  const handleLanguageChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value
    if (next && next !== language) changeLanguage(next)
  }

  const toggleLabel = visible ? t('toolbarToggle.hide') : t('toolbarToggle.show')

  return (
    <div className={`app-toolbar${visible ? ' is-visible' : ' is-collapsed'}`}>
      <button
        className={`toolbar-toggle${visible ? ' is-active' : ''}${atTop ? '' : ' is-hidden'}`}
        type="button"
        onClick={onToggleVisible}
        aria-expanded={visible}
        aria-label={toggleLabel}
        tabIndex={atTop ? 0 : -1}
        aria-hidden={!atTop}
        disabled={!atTop}
      >
        🛠️
      </button>
      <header className={`toolbar${visible ? ' toolbar--visible' : ' toolbar--collapsed'}`}>
        <div className="toolbar-left">
          {onNavigateHome ? (
            <button type="button" onClick={onNavigateHome}>
              🏠 Dashboard
            </button>
          ) : null}
          <button type="button" onClick={onOpenUpload}>
            {t('toolbar.loadCsv')}
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
