import { useState, useEffect } from 'react'
import VeriscopeSymbol from './VeriscopeSymbol'
import {
  addResearchResult,
  clearResearchHistory,
  deleteResearchResult,
  getResearchHistory,
  setResearchSaved,
} from './researchHistory'
import './App.css'

const suggestions = ['how does Kubernetes perform service discovery?', 'how does LLM search work?', 'what is BM25 retrieval?']
const headlinePhrases = [
  { lead: 'Find your', accent: 'signal.' },
  { lead: 'Follow the', accent: 'evidence.' },
  { lead: 'Explore what', accent: 'matters.' },
]

function getInitialTheme() {
  try {
    return globalThis.localStorage.getItem('veriscope-theme') === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function SearchIcon({ size = 19 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="10.8" cy="10.8" r="6.8" stroke="currentColor" strokeWidth="1.7" />
      <path d="m16 16 4.2 4.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ExternalIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <polyline points="15 3 21 3 21 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="10" y1="14" x2="21" y2="3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function ThemeIcon({ theme }) {
  return theme === 'dark' ? (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ) : (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'Web source'
  }
}

function createResultId() {
  return globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function formatResearchDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date unavailable'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

/**
 * Parses synthesis text and transforms [Source N] patterns into clickable citation badges.
 */
function renderInlineMarkdown(text, citations, onSelectSource) {
  if (!text) return null
  const inlinePattern = /(\[(?:Source\s*)?\d+(?:\s*,\s*(?:Source\s*)?\d+)*\]|\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/gi
  const parts = []
  let lastIndex = 0
  let match

  while ((match = inlinePattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    const fullMatch = match[0]
    if (/^\[(?:Source\s*)?\d/i.test(fullMatch)) {
      const ids = fullMatch.match(/\d+/g).map(Number)
      const isKnownCitation = ids.some((id) => citations.some((citation) => citation.id === id))
      if (isKnownCitation) {
        ids.forEach((id, index) => {
          if (index > 0) parts.push(', ')
          const source = citations.find((citation) => citation.id === id)
          if (!source) {
            parts.push(`[Source ${id}]`)
            return
          }
          parts.push(
            <button
              key={`cite-${match.index}-${id}`}
              type="button"
              className="inline-citation"
              onClick={() => onSelectSource(id)}
              title={`[Source ${id}] ${source.title}`}
              aria-label={`Jump to Source ${id}`}
            >
              [Source {id}]
            </button>
          )
        })
      } else {
        parts.push(fullMatch)
      }
    } else if (fullMatch.startsWith('**')) {
      parts.push(<strong key={`bold-${match.index}`}>{fullMatch.slice(2, -2)}</strong>)
    } else if (fullMatch.startsWith('`')) {
      parts.push(<code key={`code-${match.index}`}>{fullMatch.slice(1, -1)}</code>)
    } else if (fullMatch.startsWith('*')) {
      parts.push(<em key={`italic-${match.index}`}>{fullMatch.slice(1, -1)}</em>)
    } else {
      const linkMatch = fullMatch.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/i)
      parts.push(
        <a key={`link-${match.index}`} href={linkMatch[2]} target="_blank" rel="noreferrer">
          {linkMatch[1]}
        </a>
      )
    }

    lastIndex = match.index + fullMatch.length
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts
}

function renderAnswerMarkdown(text, citations, onSelectSource) {
  const lines = text.split(/\r?\n/)
  const blocks = []
  let paragraph = []
  let listItems = []
  let listType = ''
  let codeLines = []
  let inCodeBlock = false

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push(<p key={`paragraph-${blocks.length}`}>{renderInlineMarkdown(paragraph.join(' '), citations, onSelectSource)}</p>)
      paragraph = []
    }
  }
  const flushList = () => {
    if (!listItems.length) return
    const List = listType === 'ordered' ? 'ol' : 'ul'
    blocks.push(
      <List key={`list-${blocks.length}`}>
        {listItems.map((item, index) => (
          <li key={`item-${index}`}>{renderInlineMarkdown(item, citations, onSelectSource)}</li>
        ))}
      </List>
    )
    listItems = []
    listType = ''
  }

  lines.forEach((line) => {
    if (line.trim().startsWith('```')) {
      flushParagraph()
      flushList()
      if (inCodeBlock) {
        blocks.push(<pre key={`pre-${blocks.length}`}><code>{codeLines.join('\n')}</code></pre>)
        codeLines = []
      }
      inCodeBlock = !inCodeBlock
      return
    }
    if (inCodeBlock) {
      codeLines.push(line)
      return
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    const unordered = line.match(/^\s*[-*]\s+(.+)$/)
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/)
    const quote = line.match(/^>\s?(.*)$/)
    if (!line.trim()) {
      flushParagraph()
      flushList()
    } else if (heading) {
      flushParagraph()
      flushList()
      const Heading = `h${Math.min(heading[1].length + 1, 4)}`
      blocks.push(<Heading key={`heading-${blocks.length}`}>{renderInlineMarkdown(heading[2], citations, onSelectSource)}</Heading>)
    } else if (unordered || ordered) {
      flushParagraph()
      const nextListType = unordered ? 'unordered' : 'ordered'
      if (listType && listType !== nextListType) flushList()
      listType = nextListType
      listItems.push((unordered || ordered)[1])
    } else if (quote) {
      flushParagraph()
      flushList()
      blocks.push(<blockquote key={`quote-${blocks.length}`}>{renderInlineMarkdown(quote[1], citations, onSelectSource)}</blockquote>)
    } else {
      flushList()
      paragraph.push(line.trim())
    }
  })

  if (inCodeBlock) {
    blocks.push(<pre key={`pre-${blocks.length}`}><code>{codeLines.join('\n')}</code></pre>)
  }
  flushParagraph()
  flushList()
  return blocks
}

function App() {
  const [theme, setTheme] = useState(getInitialTheme)
  const [themeError, setThemeError] = useState('')
  const [headlineIndex, setHeadlineIndex] = useState(0)
  const [query, setQuery] = useState('')
  const [searchedQuery, setSearchedQuery] = useState('')
  const [answer, setAnswer] = useState('')
  const [citations, setCitations] = useState([])
  const [evidence, setEvidence] = useState([])
  const [insufficientEvidence, setInsufficientEvidence] = useState(false)
  const [answeredByLLM, setAnsweredByLLM] = useState(false)
  const [_searchedWeb, setSearchedWeb] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [evidenceStatus, setEvidenceStatus] = useState('')
  const [serviceHealth, setServiceHealth] = useState(null)
  const [activeSourceId, setActiveSourceId] = useState(null)
  const [researchHistory, setResearchHistory] = useState([])
  const [historySearch, setHistorySearch] = useState('')
  const [historyFilter, setHistoryFilter] = useState('all')
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState('')
  const [currentResultId, setCurrentResultId] = useState(null)
  const [copyStatus, setCopyStatus] = useState('')
  const isDirectAnswer = answeredByLLM && !_searchedWeb

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      'content',
      theme === 'dark' ? '#09090d' : '#f8f7fb'
    )
  }, [theme])

  useEffect(() => {
    if (searchedQuery || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined
    const timer = window.setInterval(() => {
      setHeadlineIndex((index) => (index + 1) % headlinePhrases.length)
    }, 4800)
    return () => window.clearInterval(timer)
  }, [searchedQuery])

  useEffect(() => {
    async function checkHealth() {
      try {
        const res = await fetch('/api/health')
        if (res.ok) {
          const data = await res.json()
          setServiceHealth(data.services || null)
        }
      } catch {
        // Backend not ready or unreachable
      }
    }
    checkHealth()
    const timer = setInterval(checkHealth, 20000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    let active = true

    getResearchHistory()
      .then((entries) => {
        if (active) setResearchHistory(entries)
      })
      .catch((storageError) => {
        if (active) {
          setHistoryError(
            `Local research storage could not be opened: ${storageError instanceof Error ? storageError.message : 'Unknown storage error'}`
          )
        }
      })
      .finally(() => {
        if (active) setHistoryLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  function scrollToSource(sourceId) {
    setActiveSourceId(sourceId)
    const targetElement = document.getElementById(`citation-${sourceId}`)
    if (targetElement) {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      targetElement.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' })
      setTimeout(() => {
        setActiveSourceId((curr) => (curr === sourceId ? null : curr))
      }, 2800)
    }
  }

  function changeTheme() {
    const nextTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(nextTheme)
    setThemeError('')
    try {
      globalThis.localStorage.setItem('veriscope-theme', nextTheme)
    } catch {
      setThemeError('Theme changed for this visit, but browser storage is unavailable.')
    }
  }

  async function handleSearch(event, options = {}) {
    event?.preventDefault()
    const trimmedQuery = query.trim()
    if (!trimmedQuery || isLoading) return

    const forceWeb = Boolean(options.forceWebSearch)

    setIsLoading(true)
    setError('')
    setAnswer('')
    setCitations([])
    setEvidence([])
    setInsufficientEvidence(false)
    setEvidenceStatus('')
    setAnsweredByLLM(false)
    setSearchedWeb(false)
    setActiveSourceId(null)
    setCurrentResultId(null)
    setCopyStatus('')
    setSearchedQuery(trimmedQuery)

    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmedQuery, forceWebSearch: forceWeb }),
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Search could not be completed. Please try again.')
      }

      if (typeof data.answer !== 'string' || !Array.isArray(data.citations)) {
        throw new Error(data.message || 'The research service returned an unexpected response.')
      }

      setAnswer(data.answer)
      setCitations(data.citations)
      setEvidence(data.evidence || [])
      setInsufficientEvidence(Boolean(data.insufficientEvidence))
      setEvidenceStatus(data.evidenceStatus || '')
      setAnsweredByLLM(Boolean(data.answeredByLLM))
      setSearchedWeb(Boolean(data.searchedWeb))

      const entry = {
        id: createResultId(),
        query: trimmedQuery,
        answer: data.answer,
        citations: data.citations,
        evidence: Array.isArray(data.evidence) ? data.evidence : [],
        warnings: Array.isArray(data.warnings) ? data.warnings : [],
        insufficientEvidence: Boolean(data.insufficientEvidence),
        llmUnavailable: Boolean(data.llmUnavailable),
        answeredByLLM: Boolean(data.answeredByLLM),
        searchedWeb: Boolean(data.searchedWeb),
        evidenceStatus: data.evidenceStatus || '',
        missingEvidence: data.missingEvidence || '',
        createdAt: new Date().toISOString(),
        saved: false,
      }

      try {
        await addResearchResult(entry)
        setResearchHistory((entries) => [entry, ...entries])
        setCurrentResultId(entry.id)
        setHistoryError('')
      } catch (storageError) {
        setHistoryError(
          `Research completed, but could not be saved locally: ${storageError instanceof Error ? storageError.message : 'Unknown storage error'}`
        )
      }
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : 'Something went wrong. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  function reopenResearch(entry) {
    setQuery(entry.query)
    setSearchedQuery(entry.query)
    setAnswer(entry.answer)
    setCitations(entry.citations)
    setEvidence(entry.evidence || [])
    setInsufficientEvidence(Boolean(entry.insufficientEvidence))
    setEvidenceStatus(entry.evidenceStatus || '')
    setAnsweredByLLM(Boolean(entry.answeredByLLM))
    setSearchedWeb(Boolean(entry.searchedWeb))
    setCurrentResultId(entry.id)
    setActiveSourceId(null)
    setError('')
    setCopyStatus('')
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
  }

  async function toggleSavedResult(entry) {
    try {
      const updated = await setResearchSaved(entry.id, !entry.saved)
      setResearchHistory((entries) =>
        entries.map((item) => item.id === updated.id ? updated : item)
      )
      setHistoryError('')
    } catch (storageError) {
      setHistoryError(
        `Could not update the saved result: ${storageError instanceof Error ? storageError.message : 'Unknown storage error'}`
      )
    }
  }

  async function removeResearchResult(entry) {
    try {
      await deleteResearchResult(entry.id)
      setResearchHistory((entries) => entries.filter((item) => item.id !== entry.id))
      if (currentResultId === entry.id) setCurrentResultId(null)
      setHistoryError('')
    } catch (storageError) {
      setHistoryError(
        `Could not delete the result: ${storageError instanceof Error ? storageError.message : 'Unknown storage error'}`
      )
    }
  }

  async function clearHistory() {
    if (!window.confirm('Delete all local research history, including saved results? This cannot be undone.')) {
      return
    }

    try {
      await clearResearchHistory()
      setResearchHistory([])
      setCurrentResultId(null)
      setHistoryError('')
    } catch (storageError) {
      setHistoryError(
        `Could not clear local history: ${storageError instanceof Error ? storageError.message : 'Unknown storage error'}`
      )
    }
  }

  async function copyAnswer() {
    try {
      await navigator.clipboard.writeText(answer)
      setCopyStatus('Answer copied')
    } catch {
      setCopyStatus('Could not access the clipboard. Check browser permissions.')
    }
  }

  const currentResult = researchHistory.find((entry) => entry.id === currentResultId)
  const visibleHistory = researchHistory.filter((entry) => {
    const matchesFilter = historyFilter === 'all' || entry.saved
    const normalizedSearch = historySearch.trim().toLocaleLowerCase()
    const matchesSearch = !normalizedSearch ||
      `${entry.query}\n${entry.answer}`.toLocaleLowerCase().includes(normalizedSearch)
    return matchesFilter && matchesSearch
  })

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="topbar">
        <a className="wordmark" href="/" aria-label="VeriScope home">
          <VeriscopeSymbol />
          <span>VeriScope<span className="wordmark-period">.</span></span>
        </a>
        <div
          className={`service-indicator ${serviceHealth
            ? Object.values(serviceHealth).every((service) => service?.available) ? 'service-connected' : 'service-degraded'
            : 'service-unknown'}`}
          role="status"
          title={serviceHealth
            ? Object.entries(serviceHealth).map(([name, service]) => `${name}: ${service?.available ? 'connected' : 'offline'}`).join(' · ')
            : 'Local services are checked in the background'}
        >
          <span className="status-dot" />
          <span>{serviceHealth
            ? Object.values(serviceHealth).every((service) => service?.available) ? 'ALL SYSTEMS CONNECTED' : 'LOCAL SERVICES DEGRADED'
            : 'LOCAL-FIRST RESEARCH'}</span>
        </div>
        <nav className="topbar-actions" aria-label="Main navigation">
          <a className="about-link" href="#research-library">Library</a>
          <a className="about-link external-nav-link" href="https://searxng.org/" target="_blank" rel="noreferrer">
            SearXNG <ArrowIcon />
          </a>
          <button
            className="theme-toggle"
            type="button"
            onClick={changeTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            <ThemeIcon theme={theme} />
          </button>
        </nav>
      </header>

      {themeError && <p className="preference-error" role="status">{themeError}</p>}

      {serviceHealth && (!serviceHealth.ollama?.available || !serviceHealth.searxng?.available || !serviceHealth.embedding?.available) && (
        <div className="service-alert-bar" role="status">
          <span className="service-alert-icon" aria-hidden="true">!</span>
          <span>
            <strong>Local service notice:</strong>{' '}
            {!serviceHealth.ollama?.available && (
              <span className="offline-tag">Ollama is offline (run <code>ollama serve</code>). </span>
            )}
            {!serviceHealth.searxng?.available && (
              <span className="offline-tag">SearXNG is offline (start Docker container). </span>
            )}
            {!serviceHealth.embedding?.available && (
              <span className="offline-tag">Embedding service is offline; lexical retrieval may be used. </span>
            )}
          </span>
        </div>
      )}

      <section className={`hero ${searchedQuery ? 'hero-compact' : ''}`}>
        <div className="eyebrow"><span className="eyebrow-line" /> RESEARCH, WITH RECEIPTS</div>
        <h1 className="hero-headline" aria-live="off">
          {headlinePhrases.map((phrase, phraseIdx) => (
            <span
              className={`headline-line ${headlineIndex === phraseIdx ? 'headline-line-active' : ''}`}
              key={phrase.lead}
              aria-hidden={headlineIndex !== phraseIdx}
            >
              {phrase.lead.split(' ').map((word, wordIdx) => (
                <span className="headline-word" key={word} style={{ '--word-index': wordIdx }}>
                  {word}
                </span>
              ))}
              <span className="headline-accent">{phrase.accent}</span>
            </span>
          ))}
        </h1>
        <p className="heading-subtitle">Verified facts from the open web. Every answer tied to evidence.</p>
        <p className="hero-copy">
          Private by design. Grounded in sources. Powered by your local research stack.
        </p>

        <form className={`search-panel glass-panel ${isLoading ? 'search-submitting' : ''}`} onSubmit={handleSearch}>
          <span className="search-leading"><SearchIcon size={21} /></span>
          <label className="visually-hidden" htmlFor="search-query">Search the web</label>
          <input
            id="search-query"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="What would you like to research?"
            autoComplete="off"
          />
          {query && (
            <button className="clear-button" type="button" onClick={() => setQuery('')} aria-label="Clear search">
              <span aria-hidden="true">×</span>
            </button>
          )}
          <button className="search-button" type="submit" disabled={!query.trim() || isLoading}>
            <span>{isLoading ? 'Researching' : 'Research'}</span>
            {isLoading ? <span className="button-spinner" /> : <ArrowIcon />}
          </button>
        </form>

        <div className="local-first-note"><span className="local-first-glyph">⌘</span> Local-first · your research stays on your device</div>

        {!searchedQuery && (
          <div className="suggestions">
            <span className="suggestions-label">Explore research topics</span>
            <div className="suggestion-list">
              {suggestions.map((suggestion) => (
                <button
                  className="suggestion-chip"
                  key={suggestion}
                  type="button"
                  onClick={() => {
                    setQuery(suggestion)
                    document.getElementById('search-query')?.focus()
                  }}
                >
                  {suggestion}<ArrowIcon />
                </button>
              ))}
            </div>
          </div>
        )}

        <details className="history-workspace" id="research-library">
          <summary className="history-heading">
            <div>
              <div className="results-kicker">PRIVATE WORKSPACE · LOCAL HISTORY</div>
              <h2 id="history-title">Research library</h2>
            </div>
            <div className="history-summary-meta">
              <span>{researchHistory.length} {researchHistory.length === 1 ? 'session' : 'sessions'}</span>
              <span className="history-chevron" aria-hidden="true">⌄</span>
            </div>
          </summary>

          <div className="history-content">
          <div className="history-toolbar">
            <label className="history-search">
              <SearchIcon size={17} />
              <span className="visually-hidden">Search research history</span>
              <input
                type="search"
                value={historySearch}
                onChange={(event) => setHistorySearch(event.target.value)}
                placeholder="Search your research..."
                autoComplete="off"
              />
            </label>
            <div className="history-filters" aria-label="Filter research results">
              <button
                type="button"
                className={historyFilter === 'all' ? 'history-filter active' : 'history-filter'}
                onClick={() => setHistoryFilter('all')}
                aria-pressed={historyFilter === 'all'}
              >
                All
              </button>
              <button
                type="button"
                className={historyFilter === 'saved' ? 'history-filter active' : 'history-filter'}
                onClick={() => setHistoryFilter('saved')}
                aria-pressed={historyFilter === 'saved'}
              >
                Saved
              </button>
            </div>
            {researchHistory.length > 0 && (
              <button
                className="history-clear-button"
                type="button"
                onClick={clearHistory}
                disabled={historyLoading}
              >
                Clear history
              </button>
            )}
          </div>

          {historyError && (
            <p className="history-message history-error" role="alert">{historyError}</p>
          )}
          {!historyError && (
            <p className="history-privacy-note">Stored only in this browser on this device.</p>
          )}

          {historyLoading ? (
            <p className="history-message" role="status">Loading local research...</p>
          ) : visibleHistory.length > 0 ? (
            <div className="history-list">
              {visibleHistory.map((entry) => (
                <article
                  className={`history-entry ${entry.id === currentResultId ? 'history-entry-active' : ''}`}
                  key={entry.id}
                >
                  <button
                    type="button"
                    className="history-entry-open"
                    onClick={() => reopenResearch(entry)}
                    aria-label={`Reopen research: ${entry.query}`}
                  >
                    <span className="history-entry-meta">
                      <time dateTime={entry.createdAt}>{formatResearchDate(entry.createdAt)}</time>
                      {entry.saved && <span className="history-saved-badge">Saved</span>}
                      {entry.evidenceStatus === 'sufficient' && (!entry.answeredByLLM || entry.searchedWeb) && (
                        <span className="history-verified-badge">Evidence verified</span>
                      )}
                      {entry.answeredByLLM && !entry.searchedWeb && <span className="history-local-badge">Local answer</span>}
                      {entry.insufficientEvidence && <span className="history-evidence-badge">Insufficient evidence</span>}
                      {entry.evidenceStatus === 'verification_failed' && (
                        <span className="history-failed-badge">Verification failed</span>
                      )}
                    </span>
                    <strong>{entry.query}</strong>
                    <span className="history-entry-preview">{entry.answer}</span>
                  </button>
                  <div className="history-entry-actions">
                    <button
                      type="button"
                      onClick={() => toggleSavedResult(entry)}
                      aria-label={entry.saved ? `Remove saved status: ${entry.query}` : `Save result: ${entry.query}`}
                      title={entry.saved ? 'Remove from saved' : 'Save result'}
                    >
                      {entry.saved ? 'Unsave' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeResearchResult(entry)}
                      aria-label={`Delete research: ${entry.query}`}
                      title="Delete result"
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="history-empty" role="status">
              {researchHistory.length === 0
                ? 'Your completed research will appear here.'
                : historyFilter === 'saved' && !historySearch
                ? 'You have no saved results yet.'
                : 'No research matches your search.'}
            </p>
          )}
          </div>
        </details>
      </section>

      {(isLoading || error || searchedQuery) && (
        <section className="results-section" aria-live="polite">
          <div className="results-heading">
            <div>
              <div className="results-kicker">
                {isLoading
                  ? 'REQUEST IN PROGRESS'
                  : isDirectAnswer
                  ? 'LOCAL KNOWLEDGE'
                  : insufficientEvidence
                  ? evidenceStatus === 'verification_failed'
                    ? 'VERIFICATION FAILED'
                    : 'INSUFFICIENT EVIDENCE'
                  : 'RESEARCH FINDINGS'}
              </div>
              <h2>{searchedQuery}</h2>
            </div>
            {!isLoading && !error && citations.length > 0 && !insufficientEvidence && (
              <div className="result-count">
                <span className="count-light" />
                {citations.length} {citations.length === 1 ? 'source' : 'sources'} cited
              </div>
            )}
            {!isLoading && !error && citations.length > 0 && insufficientEvidence && (
              <div className="result-count">
                <span className="count-light" />
                {citations.length} {citations.length === 1 ? 'source' : 'sources'} reviewed (insufficient)
              </div>
            )}
            {!isLoading && !error && isDirectAnswer && (
              <div className="result-count direct-count">
                <span className="count-light-green" />
                Direct answer
              </div>
            )}
          </div>

          {isLoading && (
            <div className="research-progress" role="status" aria-live="polite">
              <div className="progress-mark" aria-hidden="true"><span /></div>
              <div className="progress-copy">
                <div className="results-kicker">RUNNING LOCALLY · PROGRESS IS NOT STREAMED</div>
                <h3>Researching your question</h3>
                <p>Your answer and its evidence status will appear here when processing is complete.</p>
                <div className="progress-track" aria-hidden="true"><span /></div>
              </div>
            </div>
          )}

          {error && (
            <div className="feedback-card error-card">
              <div className="feedback-icon">!</div>
              <div>
                <h3>We couldn’t complete that research</h3>
                <p>{error}</p>
              </div>
              <button className="retry-button" type="button" onClick={handleSearch}>
                Try again <ArrowIcon />
              </button>
            </div>
          )}

          {!isLoading && !error && searchedQuery && !answer && citations.length === 0 && (
            <div className="feedback-card">
              <div className="feedback-icon"><SearchIcon /></div>
              <div>
                <h3>No research was returned</h3>
                <p>Try different keywords or verify that the local services (SearXNG, Ollama, MiniLM) are running.</p>
              </div>
            </div>
          )}

          {!isLoading && !error && answer && (
            <div className="research-output">
              <article className="answer-card glass-panel">
                <div className="answer-header">
                  <div className="answer-label">
                    <span className={`answer-status-mark ${isDirectAnswer ? 'status-mark-local' : insufficientEvidence ? 'status-mark-warning' : 'status-mark-verified'}`} aria-hidden="true" />
                    <span>
                      {insufficientEvidence
                        ? evidenceStatus === 'verification_failed'
                          ? 'Evidence verification failed'
                          : 'Insufficient evidence'
                        : isDirectAnswer
                        ? 'Local model answer · not web-verified'
                        : evidenceStatus === 'sufficient'
                        ? 'Evidence verified · grounded in cited sources'
                        : 'Research answer · inspect cited sources'}
                    </span>
                  </div>
                  {citations.length > 0 && (
                    <div className="citation-hint">
                      Click any citation badge to jump to its supporting text
                    </div>
                  )}
                  <div className="answer-actions">
                    <button
                      type="button"
                      className="result-action-button"
                      onClick={copyAnswer}
                      title="Copy answer text"
                    >
                      {copyStatus.startsWith('Could not') ? 'Copy failed' : copyStatus || 'Copy answer'}
                    </button>
                    {currentResultId && (
                      <button
                        type="button"
                        className={`result-action-button ${currentResult?.saved ? 'result-action-saved' : ''}`}
                        onClick={() => currentResult && toggleSavedResult(currentResult)}
                        title={currentResult?.saved ? 'Remove from saved results' : 'Save this result'}
                      >
                        {currentResult?.saved ? 'Saved' : 'Save result'}
                      </button>
                    )}
                    {isDirectAnswer && (
                      <button
                        type="button"
                        className="force-web-button"
                        onClick={(e) => handleSearch(e, { forceWebSearch: true })}
                        title="Search the web for real-time sources and citations"
                      >
                        <SearchIcon size={13} />
                        <span>Search web anyway</span>
                      </button>
                    )}
                  </div>
                </div>
                {copyStatus.startsWith('Could not') && (
                  <p className="copy-feedback" role="status">{copyStatus}</p>
                )}

                <div className="answer-text">
                  {renderAnswerMarkdown(answer, citations, scrollToSource)}
                </div>
              </article>

              {citations.length > 0 && (
                <section className="source-section" aria-labelledby="sources-title">
                  <div className="subsection-heading">
                    <div>
                      <div className="results-kicker">
                        {insufficientEvidence ? 'Retrieved Sources' : 'Supporting Evidence'}
                      </div>
                      <h3 id="sources-title">
                        {insufficientEvidence
                          ? 'Retrieved Sources & Evidence Snippets (Insufficient for Answer)'
                          : 'Cited Sources & Supporting Snippets'}
                      </h3>
                    </div>
                    <span className="source-total">
                      {citations.length} {insufficientEvidence ? 'reviewed' : 'cited'}
                    </span>
                  </div>

                  <div className="source-list">
                    {citations.map((citation) => {
                      const isHighlighted = activeSourceId === citation.id

                      return (
                        <article
                          id={`citation-${citation.id}`}
                          className={`source-card glass-panel ${isHighlighted ? 'source-card-active' : ''}`}
                          key={citation.id}
                        >
                          <div className="source-header">
                            <div className="source-identity">
                              <span className="source-badge">[Source {citation.id}]</span>
                              <span className="source-domain">{getDomain(citation.url)}</span>
                              {typeof citation.score === 'number' && citation.score > 0 && (
                                <span className="source-relevance">
                                  {Math.round(citation.score * 100)}% relevance
                                </span>
                              )}
                            </div>
                            <a
                              className="source-external-link"
                              href={citation.url}
                              target="_blank"
                              rel="noreferrer"
                              title={`Open ${citation.url} in new tab`}
                            >
                              <span>Open page</span>
                              <ExternalIcon />
                            </a>
                          </div>

                          <h4 className="source-title">
                            <a href={citation.url} target="_blank" rel="noreferrer">
                              {citation.title || getDomain(citation.url)}
                            </a>
                          </h4>
                          <a className="source-url" href={citation.url} target="_blank" rel="noreferrer">
                            {citation.url}
                          </a>

                          <div className="source-snippet-box">
                            <div className="snippet-caption">Supporting text excerpt:</div>
                            <blockquote className="snippet-quote">
                              &ldquo;{citation.snippet || citation.text || 'No snippet text available.'}&rdquo;
                            </blockquote>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </section>
              )}

              {evidence.length > citations.length && (
                <details className="evidence-details">
                  <summary>View all {evidence.length} retrieved passages</summary>
                  <div className="evidence-list">
                    {evidence.map((item) => (
                      <article className="evidence-card" key={item.id}>
                        <div className="evidence-heading">
                          <span>[{item.id}] {item.title}</span>
                          <a href={item.url} target="_blank" rel="noreferrer">
                            Open source <ArrowIcon />
                          </a>
                        </div>
                        <p>{item.text}</p>
                      </article>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </section>
      )}

      <footer className="footer">
        <span>Curiosity, grounded in evidence.</span>
        <span className="footer-right"><span className="footer-spark">✳</span> VeriScope Local Research</span>
      </footer>
    </main>
  )
}

export default App
