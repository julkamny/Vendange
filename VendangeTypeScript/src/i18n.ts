import i18next from 'i18next'

import en from './locales/en.json'
import fr from './locales/fr.json'

const LANGUAGE_STORAGE_KEY = 'vendange:language'

const resources = {
  en: { translation: en },
  fr: { translation: fr },
}

function detectInitialLanguage(): string {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY)
    if (stored && stored in resources) return stored
  } catch {}
  const browser = navigator.language?.slice(0, 2).toLowerCase()
  if (browser && browser in resources) return browser
  return 'en'
}

export async function initI18n() {
  await i18next.init({
    resources,
    lng: detectInitialLanguage(),
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  })
}

export function t(key: string, options?: Record<string, unknown>): string {
  return i18next.t(key, options)
}

export function changeLanguage(language: string) {
  if (!(language in resources)) return
  i18next.changeLanguage(language)
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  } catch {}
}

export function getCurrentLanguage(): string {
  return i18next.language
}

export const supportedLanguages = Object.keys(resources)

export default i18next
