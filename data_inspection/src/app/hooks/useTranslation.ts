import { useEffect, useSyncExternalStore } from 'react'
import { getResolvedLanguage, t as baseT, subscribeToLanguageChange } from '../i18n'

export function useTranslation() {
  const language = useSyncExternalStore(subscribeToLanguageChange, () => getResolvedLanguage())

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-language', language)
    }
  }, [language])

  return { t: baseT, language }
}

