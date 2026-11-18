import { useEffect, useState } from 'react'

/** useState backed by localStorage (JSON). `validate` rejects stale or tampered values. */
export function usePersistentState(key, initialValue, validate) {
  const [value, setValue] = useState(() => {
    try {
      const raw = globalThis.localStorage.getItem(key)
      if (raw !== null) {
        const parsed = JSON.parse(raw)
        if (!validate || validate(parsed)) return parsed
      }
    } catch {
      // unreadable or unavailable storage: use the default
    }
    return typeof initialValue === 'function' ? initialValue() : initialValue
  })

  useEffect(() => {
    try {
      globalThis.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // storage unavailable: the value still works for this session
    }
  }, [key, value])

  return [value, setValue]
}
