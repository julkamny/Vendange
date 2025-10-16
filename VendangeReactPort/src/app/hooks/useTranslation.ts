import { useSyncExternalStore } from 'react'
import i18n, { t as baseT, subscribeToLanguageChange } from '../i18n'

export function useTranslation() {
  useSyncExternalStore(subscribeToLanguageChange, () => i18n.language)
  return { t: baseT, language: i18n.language }
}

