import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { evidenceDomId, getEvidenceItems } from '../lib/evidence'
import { findCitedIds } from '../lib/citations'
import { formatElapsed } from '../lib/format'
import CopyButton from './CopyButton'
import ErrorBoundary from './ErrorBoundary'
import EvidenceSection from './Evidence'
import Markdown from './Markdown'
import './Message.css'

export const UserMessage = memo(function UserMessage({ message }) {
  return (
    <div className="message message-user">
      <div className="user-bubble">{message.content}</div>
    </div>
  )
})

/** Subtle loading indicator with the backend's current stage and elapsed time. */
function Progress({ text }) {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((current) => current + 1), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="progress" role="status" aria-live="polite">
      <span className="progress-dot" aria-hidden="true" />
      <span>{text}</span>
      {seconds >= 5 && <span className="progress-time">{formatElapsed(seconds)}</span>}
    </div>
  )
}

const reduceMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * One assistant answer: Markdown with inline citations, then collapsible evidence.
 * `progress` is set only while this answer is still being produced.
 */
export const AssistantMessage = memo(function AssistantMessage({ message, progress }) {
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [openCards, setOpenCards] = useState(() => new Set())
  const [flashKey, setFlashKey] = useState(null)
  const [scrollTarget, setScrollTarget] = useState(null)

  // Depend on the evidence fields only: `message` changes on every streamed token, and a new
  // `sources` map would rebuild the Markdown components (remounting tables and copy buttons).
  const { research, evidenceReferences } = message
  const items = useMemo(() => getEvidenceItems(research, evidenceReferences), [research, evidenceReferences])
  const sources = useMemo(
    () => new Map(items.filter((item) => item.number !== null).map((item) => [item.number, item])),
    [items]
  )
  const citedIds = useMemo(() => findCitedIds(message.content, new Set(sources.keys())), [message.content, sources])

  const streaming = message.status === 'streaming'
  const failed = message.status === 'failed'
  const content = message.content ?? ''
  const insufficient = message.research?.insufficientEvidence ?? /^not enough evidence\b/i.test(content)
  // Live failures keep any partial answer and carry a separate error; restored ones only have the error text.
  const showContent = content && !(failed && !message.error)
  const errorText = failed ? message.error || content || 'Research could not be completed.' : ''

  const handleCite = useCallback(
    (number) => {
      const item = items.find((candidate) => candidate.number === number)
      if (!item) return
      setEvidenceOpen(true)
      setOpenCards((current) => new Set(current).add(item.key))
      setFlashKey(item.key)
      setScrollTarget({ key: item.key })
    },
    [items]
  )

  const toggleCard = useCallback((key) => {
    setOpenCards((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }, [])

  // After a citation click, bring its card into view once the expand animation has started.
  useEffect(() => {
    if (!scrollTarget) return undefined
    const timer = window.setTimeout(() => {
      document
        .getElementById(evidenceDomId(message.id, scrollTarget.key))
        ?.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [scrollTarget, message.id])

  useEffect(() => {
    if (!flashKey) return undefined
    const timer = window.setTimeout(() => setFlashKey(null), 1400)
    return () => window.clearTimeout(timer)
  }, [flashKey])

  return (
    <div className="message message-assistant" data-status={message.status}>
      {showContent && (
        <ErrorBoundary resetKey={content} fallback={() => <pre className="md-fallback">{content}</pre>}>
          <Markdown content={content} sources={sources} onCite={handleCite} />
        </ErrorBoundary>
      )}

      {streaming && <Progress text={progress || 'Working…'} />}

      {failed && (
        <div className="notice" role="alert">
          {errorText}
        </div>
      )}

      {!streaming && items.length > 0 && (
        <EvidenceSection
          messageId={message.id}
          items={items}
          citedIds={citedIds}
          insufficient={insufficient}
          open={evidenceOpen}
          onToggle={() => setEvidenceOpen((current) => !current)}
          openCards={openCards}
          onToggleCard={toggleCard}
          flashKey={flashKey}
        />
      )}

      {message.status === 'completed' && content && (
        <div className="message-actions">
          <CopyButton text={content} label="Copy answer" />
        </div>
      )}
    </div>
  )
})
