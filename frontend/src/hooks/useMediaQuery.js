import { useCallback, useSyncExternalStore } from 'react'

export function useMediaQuery(query) {
  const subscribe = useCallback(
    (onChange) => {
      const list = globalThis.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    [query]
  )
  return useSyncExternalStore(
    subscribe,
    () => globalThis.matchMedia(query).matches,
    () => false
  )
}
