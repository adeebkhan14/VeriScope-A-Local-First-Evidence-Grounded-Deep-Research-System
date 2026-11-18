import { useEffect, useRef, useState } from 'react'

// Keep this key in sync with the inline script in index.html.
const STORAGE_KEY = 'veriscope-theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

function readPreference() {
  try {
    const saved = globalThis.localStorage.getItem(STORAGE_KEY)
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system'
  } catch {
    return 'system'
  }
}

function applyTheme(preference, { animate }) {
  const dark = preference === 'dark' || (preference === 'system' && globalThis.matchMedia(DARK_QUERY).matches)
  const root = document.documentElement

  if (animate) {
    root.classList.add('theme-anim')
    window.setTimeout(() => root.classList.remove('theme-anim'), 300)
  }
  root.dataset.theme = dark ? 'dark' : 'light'
  root.style.colorScheme = dark ? 'dark' : 'light'
}

/** Theme preference: 'system' | 'light' | 'dark'. Persists and follows the OS when set to 'system'. */
export function useTheme() {
  const [preference, setPreference] = useState(readPreference)
  const isFirstRun = useRef(true)

  useEffect(() => {
    // The first run only re-applies what index.html already resolved, so it must not animate.
    applyTheme(preference, { animate: !isFirstRun.current })
    isFirstRun.current = false

    try {
      globalThis.localStorage.setItem(STORAGE_KEY, preference)
    } catch {
      // storage unavailable: the choice still applies for this session
    }

    if (preference !== 'system') return undefined
    const query = globalThis.matchMedia(DARK_QUERY)
    const onChange = () => applyTheme('system', { animate: true })
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [preference])

  return [preference, setPreference]
}
