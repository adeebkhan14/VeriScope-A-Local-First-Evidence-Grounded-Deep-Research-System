import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react'
import { useDismiss } from '../hooks/useDismiss'
import { DEFAULT_ALPHA, RESEARCH_MODES, alphaToSlider, sliderToAlpha } from '../lib/research'
import { ArrowUpIcon, GlobeIcon, SlidersIcon, StopIcon } from './icons'
import './Composer.css'

const MAX_TEXTAREA_HEIGHT = 200

function ModeSelector({ depth, onChange }) {
  return (
    <fieldset className="segmented">
      <legend className="sr-only">Research mode</legend>
      {RESEARCH_MODES.map((mode) => (
        <label key={mode.value} className="segmented-item" title={mode.hint}>
          <input
            type="radio"
            name="research-mode"
            value={mode.value}
            checked={depth === mode.value}
            onChange={() => onChange(mode.value)}
          />
          <span>{mode.label}</span>
        </label>
      ))}
    </fieldset>
  )
}

/**
 * Hybrid retrieval balance. The backend computes alpha*BM25 + (1-alpha)*semantic,
 * so the slider shows the semantic weight (Keyword left, Semantic right) and the
 * request still carries alpha unchanged.
 */
function AlphaControl({ alpha, onChange }) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef(null)
  const sliderId = useId()
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, close, wrapperRef)

  const keywordPercent = Math.round(alpha * 100)

  return (
    <div className="alpha" ref={wrapperRef}>
      <button
        type="button"
        className="chip"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Retrieval balance: keyword (BM25) vs semantic (MiniLM)"
      >
        <SlidersIcon size={14} />
        <span className="tabular">α {alpha.toFixed(1)}</span>
      </button>

      {open && (
        <div className="popover alpha-popover" role="dialog" aria-label="Retrieval balance">
          <div className="alpha-head">
            <label htmlFor={sliderId}>Retrieval balance</label>
            <strong className="tabular">α {alpha.toFixed(1)}</strong>
          </div>
          <input
            id={sliderId}
            className="slider"
            type="range"
            min="1"
            max="9"
            step="1"
            value={alphaToSlider(alpha)}
            onChange={(event) => onChange(sliderToAlpha(Number(event.target.value)))}
            aria-valuetext={`${keywordPercent}% keyword, ${100 - keywordPercent}% semantic`}
          />
          <div className="alpha-scale">
            <span>Keyword (BM25)</span>
            <span>Semantic (MiniLM)</span>
          </div>
          <p className="alpha-note">
            Score = α × keyword + (1 − α) × semantic.{' '}
            {alpha !== DEFAULT_ALPHA && (
              <button type="button" className="link-btn" onClick={() => onChange(DEFAULT_ALPHA)}>
                Reset to {DEFAULT_ALPHA.toFixed(1)}
              </button>
            )}
          </p>
        </div>
      )}
    </div>
  )
}

export default function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  busy,
  depth,
  onDepthChange,
  alpha,
  onAlphaChange,
  forceWeb,
  onForceWebChange,
  textareaRef,
}) {
  const canSend = value.trim().length > 0 && !busy
  const innerRef = useRef(null)
  const fieldRef = textareaRef ?? innerRef

  useLayoutEffect(() => {
    const field = fieldRef.current
    if (!field) return
    field.style.height = 'auto'
    field.style.height = `${Math.min(field.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`
  }, [value, fieldRef])

  function handleSubmit(event) {
    event.preventDefault()
    if (canSend) onSubmit()
  }

  function handleKeyDown(event) {
    // Enter sends, Shift+Enter inserts a newline. Ignore Enter that confirms an IME composition.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return
    event.preventDefault()
    if (canSend) onSubmit()
  }

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <textarea
        ref={fieldRef}
        className="composer-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask a research question…"
        aria-label="Research question"
        rows={1}
        enterKeyHint="send"
      />

      <div className="composer-bar">
        <div className="composer-controls">
          <ModeSelector depth={depth} onChange={onDepthChange} />
          <AlphaControl alpha={alpha} onChange={onAlphaChange} />
          <button
            type="button"
            className="chip web-toggle"
            data-on={forceWeb}
            aria-pressed={forceWeb}
            onClick={() => onForceWebChange(!forceWeb)}
            title={
              forceWeb
                ? 'Web search is forced on: every question is researched on the web'
                : 'Automatic: the local model decides whether the web is needed. Click to always search the web.'
            }
          >
            <GlobeIcon size={14} />
            <span className="web-label">{forceWeb ? 'Web: always' : 'Web: auto'}</span>
          </button>
        </div>

        {busy ? (
          <button type="button" className="send" onClick={onStop} aria-label="Stop research" title="Stop">
            <StopIcon size={14} />
          </button>
        ) : (
          <button type="submit" className="send" disabled={!canSend} aria-label="Send" title="Send (Enter)">
            <ArrowUpIcon size={17} strokeWidth={2.25} />
          </button>
        )}
      </div>
    </form>
  )
}
