import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { LANGS, messages } from './messages.js'

const STORAGE_KEY = 'cp-lang'
const I18nContext = createContext(null)

function detectLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && messages[saved]) return saved
  } catch {
    // modo privado / storage bloqueado: seguimos con el idioma del navegador
  }
  const nav = (navigator.languages || [navigator.language || 'es']).map((l) => l.slice(0, 2).toLowerCase())
  return nav.find((l) => messages[l]) || 'es'
}

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(detectLang)

  const setLang = useCallback((next) => {
    setLangState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // sin storage: el idioma vale solo para esta visita
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const t = useCallback(
    (key, vars) => {
      const raw = messages[lang]?.[key] ?? messages.es[key] ?? key
      if (!vars) return raw
      return raw.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`))
    },
    [lang],
  )

  const locale = LANGS.find((l) => l.code === lang)?.locale ?? 'es-AR'
  const value = useMemo(() => ({ lang, setLang, t, locale }), [lang, setLang, t, locale])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n fuera de I18nProvider')
  return ctx
}
