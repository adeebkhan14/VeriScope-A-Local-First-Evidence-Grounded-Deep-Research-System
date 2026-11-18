import { useEffect } from 'react'

/** Calls onDismiss on Escape or a pointer press outside `containerRef` while `open`. */
export function useDismiss(open, onDismiss, containerRef) {
  useEffect(() => {
    if (!open) return undefined

    const onPointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) onDismiss()
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onDismiss()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onDismiss, containerRef])
}
