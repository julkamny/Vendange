import i18next from 'i18next'

import en from './locales/en.json'
import fr from './locales/fr.json'

const LANGUAGE_STORAGE_KEY = 'vendange:language'

const resources = {
  en: { translation: en },
  fr: { translation: fr },
}

function normalizeLanguage(language: string | undefined): keyof typeof resources {
  const code = language?.slice(0, 2).toLowerCase()
  return (code && code in resources ? code : 'en') as keyof typeof resources
}

function applyDocumentLanguage(language: string) {
  if (typeof document === 'undefined') return
  document.documentElement.lang = language
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
  applyDocumentLanguage(getResolvedLanguage())
}

export function t(key: string, options?: Record<string, unknown>): string {
  return i18next.t(key, options)
}

export function changeLanguage(language: string) {
  if (!(language in resources)) return
  i18next
    .changeLanguage(language)
    .then(() => {
      applyDocumentLanguage(getResolvedLanguage())
    })
    .catch(err => {
      console.error('Failed to change language', err)
    })
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  } catch {}
}

export function getCurrentLanguage(): string {
  return i18next.language
}

export const supportedLanguages = Object.keys(resources)

export default i18next

export function subscribeToLanguageChange(callback: () => void): () => void {
  const handler = (lng: string) => {
    applyDocumentLanguage(normalizeLanguage(lng))
    callback()
  }
  i18next.on('languageChanged', handler)
  return () => {
    i18next.off('languageChanged', handler)
  }
}

export function getResolvedLanguage(): string {
  return normalizeLanguage(i18next.resolvedLanguage || i18next.language)
}
