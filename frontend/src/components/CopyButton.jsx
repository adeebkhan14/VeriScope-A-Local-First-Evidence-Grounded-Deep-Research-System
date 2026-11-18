import { useEffect, useRef, useState } from 'react'
import { copyText } from '../lib/clipboard'
import { CheckIcon, CopyIcon } from './icons'

/** Text + icon button that confirms briefly after copying. */
export default function CopyButton({ text, label = 'Copy', className = '' }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef(0)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  async function handleClick() {
    if (!(await copyText(text))) return
    setCopied(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <button type="button" className={`copy-btn ${className}`.trim()} onClick={handleClick} aria-live="polite">
      {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
      <span>{copied ? 'Copied' : label}</span>
    </button>
  )
}
