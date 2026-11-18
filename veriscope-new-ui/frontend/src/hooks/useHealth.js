import { useEffect, useState } from 'react'

/**
 * Polls the existing /api/health endpoint (which only checks connectivity and
 * never loads the model). Returns null until the first answer, then
 * { ok: true, data } or { ok: false, error }.
 */
export function useHealth(intervalMs = 30000) {
  const [health, setHealth] = useState(null)

  useEffect(() => {
    let active = true
    let timer
    let controller

    async function poll() {
      if (document.hidden) {
        timer = window.setTimeout(poll, intervalMs)
        return
      }

      controller = new AbortController()
      try {
        const response = await fetch('/api/health', { cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error(`Backend health returned HTTP ${response.status}`)
        const data = await response.json()
        if (active) setHealth({ ok: true, data })
      } catch (error) {
        if (active && error?.name !== 'AbortError') {
          setHealth({ ok: false, error: error instanceof Error ? error.message : 'Backend unreachable' })
        }
      }
      if (active) timer = window.setTimeout(poll, intervalMs)
    }

    poll()
    return () => {
      active = false
      controller?.abort()
      window.clearTimeout(timer)
    }
  }, [intervalMs])

  return health
}
