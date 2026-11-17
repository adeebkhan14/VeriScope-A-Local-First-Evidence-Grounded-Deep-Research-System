import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import VeriscopeSymbol from './VeriscopeSymbol'
import {
  deleteConversation as deleteConversationRequest,
  getConversation,
  listConversations,
  sendConversationMessage,
  startConversationResearch,
} from './conversationApi'
import {
  addResearchResult,
  clearResearchHistory,
  deleteResearchResult,
  getResearchHistory,
  setResearchSaved,
} from './researchHistory'
import './App.css'
import 'highlight.js/styles/github-dark.css'

const suggestions = [
  'how does Kubernetes perform service discovery?',
  'how does LLM search work?',
  'what is BM25 retrieval?',
]

function getInitialTheme() {
  try {
    return globalThis.localStorage.getItem('veriscope-theme') === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function getInitialPreference(key, allowedValues, fallback) {
  try {
    const value = globalThis.localStorage.getItem(key)
    return allowedValues.includes(value) ? value : fallback
  } catch {
    return fallback
  }
}

function getInitialSessionId() {
  try {
    return globalThis.localStorage.getItem('veriscope-active-session') || null
  } catch {
    return null
  }
}

function createResultId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function formatResearchDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date unavailable'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'Web source'
  }
}

function getSafeExternalUrl(url) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
  } catch {
    return null
  }
}

function SearchIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="10.8" cy="10.8" r="6.8" stroke="currentColor" strokeWidth="1.7" />
      <path d="m16 16 4.2 4.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function GlobeIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4 12h16M12 4a14.5 14.5 0 0 1 0 16M12 4a14.5 14.5 0 0 0 0 16" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function ThemeIcon({ theme }) {
  return theme === 'dark' ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
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

function CopyIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="9" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5 15V7a2 2 0 0 1 2-2h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function remarkCitations({ citationIds = [] } = {}) {
  const knownIds = new Set(citationIds)
  const pattern = /\[(?:Source\s*)?(\d+(?:\s*,\s*(?:Source\s*)?\d+)*)\]/gi

  return (tree) => {
    function transform(node) {
      if (!Array.isArray(node.children)) return

      node.children = node.children.flatMap((child) => {
        if (child.type !== 'text') {
          transform(child)
          return [child]
        }

        const parts = []
        let lastIndex = 0
        let match
        pattern.lastIndex = 0

        while ((match = pattern.exec(child.value)) !== null) {
          if (match.index > lastIndex) {
            parts.push({ type: 'text', value: child.value.slice(lastIndex, match.index) })
          }

          const ids = match[1].match(/\d+/g).map(Number)
          ids.forEach((id, index) => {
            if (index > 0) parts.push({ type: 'text', value: ', ' })
            if (knownIds.has(id)) {
              parts.push({
                type: 'link',
                url: `#source-${id}`,
                children: [{ type: 'text', value: `[Source ${id}]` }],
              })
            } else {
              parts.push({ type: 'text', value: `[Source ${id}]` })
            }
          })
          lastIndex = match.index + match[0].length
        }

        if (lastIndex === 0) return [child]
        if (lastIndex < child.value.length) {
          parts.push({ type: 'text', value: child.value.slice(lastIndex) })
        }
        return parts
      })
    }

    transform(tree)
  }
}

function Sidebar({
  conversations,
  activeConversationId,
  conversationSearch,
  setConversationSearch,
  onSelectConversation,
  onDeleteConversation,
  onNewResearch,
  onClose,
  theme,
  onToggleTheme,
  isOpen,
}) {
  const groups = [
    {
      label: 'Today',
      items: conversations.filter((conversation) => {
        const timestamp = new Date(conversation.updatedAt || conversation.updated_at || Date.now()).getTime()
        return Number.isFinite(timestamp) && Date.now() - timestamp < 24 * 60 * 60 * 1000
      }),
    },
    {
      label: 'Yesterday',
      items: conversations.filter((conversation) => {
        const timestamp = new Date(conversation.updatedAt || conversation.updated_at || Date.now()).getTime()
        return Number.isFinite(timestamp) && Date.now() - timestamp >= 24 * 60 * 60 * 1000 && Date.now() - timestamp < 48 * 60 * 60 * 1000
      }),
    },
    {
      label: 'Previous 7 Days',
      items: conversations.filter((conversation) => {
        const timestamp = new Date(conversation.updatedAt || conversation.updated_at || Date.now()).getTime()
        return Number.isFinite(timestamp) && Date.now() - timestamp >= 48 * 60 * 60 * 1000 && Date.now() - timestamp < 7 * 24 * 60 * 60 * 1000
      }),
    },
    {
      label: 'Older',
      items: conversations.filter((conversation) => {
        const timestamp = new Date(conversation.updatedAt || conversation.updated_at || Date.now()).getTime()
        return Number.isFinite(timestamp) && Date.now() - timestamp >= 7 * 24 * 60 * 60 * 1000
      }),
    },
  ].filter((group) => group.items.length > 0)

  return (
    <aside className={isOpen ? 'sidebar is-open' : 'sidebar'}>
      <div className="sidebar-header">
        <div className="brand-mark">
          <VeriscopeSymbol />
          <div>
            <strong>VeriScope</strong>
            <span>Follow the evidence.</span>
          </div>
        </div>
        <button type="button" className="icon-button sidebar-close" onClick={onClose} aria-label="Close sidebar">
          ×
        </button>
      </div>

      <button type="button" className="primary-button sidebar-new" onClick={onNewResearch}>
        <PlusIcon />
        <span>New Research</span>
      </button>

      <label className="sidebar-search" aria-label="Search conversations">
        <SearchIcon size={15} />
        <input
          type="search"
          value={conversationSearch}
          onChange={(event) => setConversationSearch(event.target.value)}
          placeholder="Search history"
        />
      </label>

      <div className="sidebar-list">
        {groups.length === 0 ? (
          <div className="sidebar-empty">No conversations yet</div>
        ) : (
          groups.map((group) => (
            <section className="sidebar-group" key={group.label}>
              <h3>{group.label}</h3>
              <ul>
                {group.items
                  .filter((conversation) => {
                    const query = conversationSearch.trim().toLowerCase()
                    return !query || `${conversation.title || 'Untitled conversation'} ${conversation.updatedAt || conversation.updated_at || ''}`.toLowerCase().includes(query)
                  })
                  .map((conversation) => (
                    <li key={conversation.id} className={conversation.id === activeConversationId ? 'is-selected' : ''}>
                      <button type="button" className="conversation-item" onClick={() => onSelectConversation(conversation.id)}>
                        <span>{conversation.title || 'Untitled conversation'}</span>
                        <time dateTime={conversation.updatedAt || conversation.updated_at}>
                          {formatResearchDate(conversation.updatedAt || conversation.updated_at)}
                        </time>
                      </button>
                      <button type="button" className="conversation-delete" onClick={() => onDeleteConversation(conversation)} aria-label={`Delete ${conversation.title || 'Untitled conversation'}`}>
                        Delete
                      </button>
                    </li>
                  ))}
              </ul>
            </section>
          ))
        )}
      </div>

      <div className="sidebar-footer">
        <button type="button" className="settings-button" onClick={onToggleTheme}>
          <ThemeIcon theme={theme} />
          <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
        </button>
      </div>
    </aside>
  )
}

function ChatComposer({
  query,
  setQuery,
  onSubmit,
  isLoading,
  researchDepth,
  setResearchDepth,
  hybridAlpha,
  setHybridAlpha,
  forceWebSearch,
  setForceWebSearch,
}) {
  const textareaRef = useRef(null)

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`
    }
  }, [query])

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      onSubmit(event)
    }
  }

  return (
    <form className="composer" onSubmit={onSubmit}>
      <div className="composer-input-row">
        <textarea
          ref={textareaRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="What would you like to research?"
          rows={1}
        />
        <button type="submit" className="primary-button send-button" disabled={!query.trim() || isLoading}>
          <span>{isLoading ? 'Researching' : 'Send'}</span>
          <ArrowIcon />
        </button>
      </div>

      <div className="composer-controls">
        <div className="mode-selector" role="group" aria-label="Research mode">
          {['FAST', 'NORMAL', 'MAX'].map((mode) => (
            <button
              key={mode}
              type="button"
              className={researchDepth === mode ? 'mode-button is-active' : 'mode-button'}
              onClick={() => setResearchDepth(mode)}
              aria-pressed={researchDepth === mode}
            >
              {mode === 'FAST' ? 'Fast' : mode === 'NORMAL' ? 'Normal' : 'Max'}
            </button>
          ))}
        </div>

        <details className="alpha-details">
          <summary>
            <span>Alpha</span>
            <strong>{hybridAlpha}</strong>
          </summary>
          <div className="alpha-popover">
            <div className="alpha-scale">
              <span>Keyword</span>
              <span>Semantic</span>
            </div>
            <input
              type="range"
              min="0.1"
              max="0.9"
              step="0.1"
              value={hybridAlpha}
              onChange={(event) => setHybridAlpha(event.target.value)}
              aria-label="Retrieval alpha"
            />
            <div className="alpha-readout">{hybridAlpha}</div>
          </div>
        </details>

        <button
          type="button"
          className={forceWebSearch ? 'web-toggle is-enabled' : 'web-toggle'}
          onClick={() => setForceWebSearch((current) => !current)}
          aria-pressed={forceWebSearch}
        >
          <GlobeIcon size={14} />
          <span>{forceWebSearch ? 'Web forced' : 'Web search'}</span>
        </button>
      </div>
    </form>
  )
}

function UserMessage({ message }) {
  return (
    <div className="message-row message-row-user">
      <div className="message-bubble user-bubble">
        <div className="message-meta"><span>You</span></div>
        <div className="message-content user-content">{message.content}</div>
      </div>
    </div>
  )
}

function AssistantMessage({ message, citations, evidence, onOpenSource, activeSourceId }) {
  const sourceIds = Array.from(new Set((citations || []).map((citation) => Number(citation.id)).filter(Number.isInteger)))

  return (
    <div className="message-row message-row-assistant">
      <div className="message-bubble assistant-bubble">
        <div className="message-meta"><span>VeriScope</span></div>
        <div className="message-content assistant-content">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, [remarkCitations, { citationIds: sourceIds }]]}
            rehypePlugins={[rehypeHighlight]}
            components={{
              a: ({ href, children, ...props }) => {
                const citationMatch = href?.match(/^#source-(\d+)$/)
                if (citationMatch) {
                  const sourceId = Number(citationMatch[1])
                  const citation = citations.find((item) => Number(item.id) === sourceId)
                  if (citation) {
                    return (
                      <button
                        type="button"
                        className={activeSourceId === sourceId ? 'inline-citation is-active' : 'inline-citation'}
                        onClick={() => onOpenSource(sourceId)}
                        {...props}
                      >
                        {children}
                      </button>
                    )
                  }
                }

                const safeUrl = getSafeExternalUrl(href)
                if (safeUrl) {
                  return (
                    <a href={safeUrl} target="_blank" rel="noreferrer" {...props}>
                      {children}
                    </a>
                  )
                }
                return <>{children}</>
              },
              code({ className, children, ...props }) {
                const codeString = String(children).replace(/\n$/, '')
                const isInline = !className
                if (isInline) return <code className="inline-code" {...props}>{children}</code>

                return (
                  <pre className="code-block">
                    <div className="code-toolbar">
                      <span>{className?.replace('language-', '') || 'code'}</span>
                      <button
                        type="button"
                        className="copy-code-button"
                        onClick={() => navigator.clipboard?.writeText(codeString)}
                      >
                        <CopyIcon size={12} />
                        Copy
                      </button>
                    </div>
                    <code className={className} {...props}>{children}</code>
                  </pre>
                )
              },
              table: ({ children }) => <div className="table-wrap"><table>{children}</table></div>,
              th: ({ children, ...props }) => <th {...props}>{children}</th>,
              td: ({ children, ...props }) => <td {...props}>{children}</td>,
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  )
}

function EvidenceSection({ citations, evidence, activeSourceId, onOpenSource }) {
  const cards = citations.length > 0 ? citations : evidence

  if (cards.length === 0) return null

  return (
    <div className="evidence-section">
      <div className="section-label">Evidence</div>
      <div className="evidence-list">
        {cards.map((item) => {
          const sourceId = Number.isInteger(item?.id) ? item.id : null
          const itemUrl = getSafeExternalUrl(item?.url || item?.link)
          const isOpen = activeSourceId === sourceId

          return (
            <article
              key={sourceId ?? `${item.title}-${item.url}`}
              className={isOpen ? 'evidence-card is-open' : 'evidence-card'}
              id={sourceId ? `source-${sourceId}` : undefined}
            >
              <button type="button" className="evidence-header" onClick={() => sourceId && onOpenSource(sourceId)}>
                <div className="evidence-title-wrap">
                  <span className="evidence-number">{sourceId ? `Evidence ${sourceId}` : 'Evidence'}</span>
                  <strong>{item.title || getDomain(item.url)}</strong>
                </div>
                <div className="evidence-meta">
                  <span>{getDomain(item.url || item.link || '')}</span>
                  {typeof item.score === 'number' && <span>{Math.round(item.score * 100)}% relevance</span>}
                </div>
              </button>

              <div className="evidence-body">
                <p>{item.snippet || item.text || 'No supporting excerpt was returned for this source.'}</p>
                {itemUrl && (
                  <a href={itemUrl} target="_blank" rel="noreferrer">
                    Open source
                  </a>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}

function MessageList({ messages, citations, evidence, onOpenSource, activeSourceId, hasActiveConversation, isLoading, progressStatus }) {
  return (
    <div className="message-list">
      <div className="message-list-inner">
        {messages.map((message) => {
          if (message.role === 'user') return <UserMessage key={message.id} message={message} />
          return (
            <AssistantMessage
              key={message.id}
              message={message}
              citations={citations}
              evidence={evidence}
              onOpenSource={onOpenSource}
              activeSourceId={activeSourceId}
            />
          )
        })}

        {isLoading && progressStatus && (
          <div className="loading-state" role="status">
            <span className="loading-dot" />
            <span>{progressStatus}</span>
          </div>
        )}
      </div>

      {citations.length > 0 || evidence.length > 0 ? (
        <div className="evidence-panel">
          <EvidenceSection
            citations={citations}
            evidence={evidence}
            activeSourceId={activeSourceId}
            onOpenSource={onOpenSource}
          />
        </div>
      ) : null}
    </div>
  )
}

function LandingScreen({ onFocusInput }) {
  return (
    <div className="landing-screen">
      <div className="landing-content">
        <div className="landing-brand">
          <VeriscopeSymbol />
        </div>
        <h1>VeriScope</h1>
        <p>Follow the evidence.</p>
      </div>
      <button type="button" className="landing-anchor" onClick={onFocusInput}>
        Start a research question
      </button>
    </div>
  )
}

function App() {
  const [theme, setTheme] = useState(getInitialTheme)
  const [researchDepth, setResearchDepth] = useState(() => getInitialPreference('veriscope-research-depth', ['FAST', 'NORMAL', 'MAX'], 'NORMAL'))
  const [hybridAlpha, setHybridAlpha] = useState(() => getInitialPreference('veriscope-hybrid-alpha', ['0.3', '0.5', '0.7'], '0.5'))
  const [forceWebSearch, setForceWebSearch] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [conversationSearch, setConversationSearch] = useState('')
  const [activeConversationId, setActiveConversationId] = useState(null)
  const [conversations, setConversations] = useState([])
  const [messages, setMessages] = useState([])
  const [conversationLoading, setConversationLoading] = useState(false)
  const [conversationsLoading, setConversationsLoading] = useState(true)
  const [conversationError, setConversationError] = useState('')
  const [deletingConversationId, setDeletingConversationId] = useState(null)
  const [query, setQuery] = useState('')
  const [searchedQuery, setSearchedQuery] = useState('')
  const [answer, setAnswer] = useState('')
  const [citations, setCitations] = useState([])
  const [evidence, setEvidence] = useState([])
  const [researchMetadata, setResearchMetadata] = useState(null)
  const [progressStatus, setProgressStatus] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [serviceHealth, setServiceHealth] = useState(null)
  const [activeSourceId, setActiveSourceId] = useState(null)
  const [currentAssistantMessageId, setCurrentAssistantMessageId] = useState(null)
  const [historySearch, setHistorySearch] = useState('')
  const [researchHistory, setResearchHistory] = useState([])
  const [currentResultId, setCurrentResultId] = useState(null)
  const [claimAttribution, setClaimAttribution] = useState(null)
  const [insufficientEvidence, setInsufficientEvidence] = useState(false)
  const [answeredByLLM, setAnsweredByLLM] = useState(false)
  const [searchedWeb, setSearchedWeb] = useState(false)
  const [llmError, setLlmError] = useState(null)
  const [evidenceStatus, setEvidenceStatus] = useState('')
  const [runtimeMetrics, setRuntimeMetrics] = useState(null)
  const [runtimeError, setRuntimeError] = useState('')
  const [runtimeLoading, setRuntimeLoading] = useState(false)
  const searchController = useRef(null)
  const conversationLoadController = useRef(null)
  const requestInFlight = useRef(false)
  const activeConversationRef = useRef(null)
  const conversationGeneration = useRef(0)
  const composerRef = useRef(null)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      globalThis.localStorage.setItem('veriscope-theme', theme)
    } catch {
      // no-op
    }
  }, [theme])

  useEffect(() => {
    try {
      globalThis.localStorage.setItem('veriscope-research-depth', researchDepth)
      globalThis.localStorage.setItem('veriscope-hybrid-alpha', hybridAlpha)
    } catch {
      // no-op
    }
  }, [researchDepth, hybridAlpha])

  useEffect(() => {
    try {
      if (activeConversationId) {
        globalThis.localStorage.setItem('veriscope-active-session', activeConversationId)
      } else {
        globalThis.localStorage.removeItem('veriscope-active-session')
      }
    } catch {
      // no-op
    }
  }, [activeConversationId])

  useEffect(() => {
    let active = true
    let timer
    let controller

    async function checkHealth() {
      try {
        controller = new AbortController()
        const response = await fetch('/api/health', { cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error(`Backend health returned HTTP ${response.status}`)
        const data = await response.json()
        if (active) setServiceHealth(data)
      } catch (healthError) {
        if (active && healthError?.name !== 'AbortError') {
          setServiceHealth({
            status: 'error',
            backend: { status: 'offline' },
            services: null,
            error: healthError instanceof Error ? healthError.message : 'Backend health is not yet available.',
          })
        }
      } finally {
        if (active) timer = window.setTimeout(checkHealth, 30000)
      }
    }

    checkHealth()
    return () => {
      active = false
      controller?.abort()
      window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    let active = true
    const controller = new AbortController()

    async function loadConversationHistory() {
      setConversationsLoading(true)
      setConversationError('')
      try {
        const entries = await listConversations({ signal: controller.signal })
        if (!Array.isArray(entries)) throw new Error('The conversation service returned an invalid list.')
        if (!active) return
        entries.sort((first, second) => (second.updatedAt || second.updated_at || '').localeCompare(first.updatedAt || first.updated_at || ''))
        setConversations(entries)
        const savedId = getInitialSessionId()
        if (savedId && entries.some((item) => item.id === savedId)) {
          await selectConversation(savedId)
        } else if (savedId) {
          globalThis.localStorage.removeItem('veriscope-active-session')
        }
      } catch (loadError) {
        if (active && loadError?.name !== 'AbortError') {
          setConversationError(loadError instanceof Error ? loadError.message : 'Conversation history could not be loaded.')
        }
      } finally {
        if (active) setConversationsLoading(false)
      }
    }

    loadConversationHistory()
    return () => {
      active = false
      controller.abort()
      conversationLoadController.current?.abort()
      searchController.current?.abort()
    }
  }, [])

  useEffect(() => {
    let active = true
    getResearchHistory()
      .then((entries) => {
        if (active) setResearchHistory(entries)
      })
      .catch(() => {
        if (active) setResearchHistory([])
      })
    return () => {
      active = false
    }
  }, [])

  async function refreshConversations({ silent = false } = {}) {
    try {
      const entries = await listConversations()
      if (!Array.isArray(entries)) throw new Error('The conversation service returned an invalid list.')
      entries.sort((first, second) => (second.updatedAt || second.updated_at || '').localeCompare(first.updatedAt || first.updated_at || ''))
      setConversations(entries)
      setConversationError('')
      return entries
    } catch (loadError) {
      if (!silent) {
        setConversationError(loadError instanceof Error ? loadError.message : 'Conversation history could not be loaded.')
      }
      return null
    }
  }

  function clearConversationDisplay() {
    setMessages([])
    setQuery('')
    setSearchedQuery('')
    setAnswer('')
    setCitations([])
    setEvidence([])
    setResearchMetadata(null)
    setProgressStatus('')
    setError('')
    setClaimAttribution(null)
    setInsufficientEvidence(false)
    setAnsweredByLLM(false)
    setSearchedWeb(false)
    setLlmError(null)
    setEvidenceStatus('')
    setActiveSourceId(null)
    setCurrentAssistantMessageId(null)
    setCurrentResultId(null)
  }

  async function selectConversation(conversationId) {
    if (!conversationId) return
    const generation = ++conversationGeneration.current
    searchController.current?.abort()
    searchController.current = null
    requestInFlight.current = false
    conversationLoadController.current?.abort()
    const controller = new AbortController()
    conversationLoadController.current = controller
    activeConversationRef.current = conversationId
    setActiveConversationId(conversationId)
    setConversationLoading(true)
    setConversationError('')
    setIsLoading(false)
    setProgressStatus('')
    clearConversationDisplay()

    try {
      const conversation = await getConversation(conversationId, { signal: controller.signal })
      if (generation !== conversationGeneration.current || activeConversationRef.current !== conversationId) return
      if (conversation.id !== conversationId || !Array.isArray(conversation.messages)) {
        throw new Error('The conversation service returned an invalid conversation.')
      }
      setMessages(conversation.messages)
    } catch (loadError) {
      if (generation === conversationGeneration.current && loadError?.name !== 'AbortError') {
        setConversationError(loadError instanceof Error ? loadError.message : 'This conversation could not be loaded.')
        if (loadError?.status === 404) {
          setConversations((entries) => entries.filter((entry) => entry.id !== conversationId))
          activeConversationRef.current = null
          setActiveConversationId(null)
        }
      }
    } finally {
      if (generation === conversationGeneration.current) {
        setConversationLoading(false)
        if (conversationLoadController.current === controller) {
          conversationLoadController.current = null
        }
      }
    }
  }

  function startNewConversation() {
    conversationGeneration.current += 1
    searchController.current?.abort()
    searchController.current = null
    conversationLoadController.current?.abort()
    conversationLoadController.current = null
    requestInFlight.current = false
    activeConversationRef.current = null
    setActiveConversationId(null)
    setIsLoading(false)
    setProgressStatus('')
    setConversationLoading(false)
    setConversationError('')
    setForceWebSearch(false)
    clearConversationDisplay()
    setSidebarOpen(false)
  }

  function stopSearch() {
    searchController.current?.abort()
  }

  async function handleDeleteConversation(conversation) {
    const title = conversation.title || 'Untitled conversation'
    if (!window.confirm(`Delete "${title}" and all of its messages? This cannot be undone.`)) return

    const isActive = activeConversationRef.current === conversation.id
    if (isActive) {
      conversationGeneration.current += 1
      searchController.current?.abort()
      searchController.current = null
      requestInFlight.current = false
      setIsLoading(false)
      setProgressStatus('')
    }
    setDeletingConversationId(conversation.id)
    try {
      await deleteConversationRequest(conversation.id)
      setConversations((entries) => entries.filter((entry) => entry.id !== conversation.id))
      if (isActive) {
        activeConversationRef.current = null
        setActiveConversationId(null)
        clearConversationDisplay()
      }
    } catch (deleteError) {
      setConversationError(deleteError instanceof Error ? deleteError.message : 'Conversation could not be deleted.')
    } finally {
      setDeletingConversationId(null)
    }
  }

  async function handleSearch(event) {
    event?.preventDefault()
    const trimmed = query.trim()
    if (!trimmed || requestInFlight.current) return

    const forceWeb = Boolean(forceWebSearch)
    const sessionId = activeConversationRef.current || createResultId()
    const generation = conversationGeneration.current
    const userMessageId = `pending-user-${createResultId()}`
    const assistantMessageId = `pending-assistant-${createResultId()}`
    const controller = new AbortController()
    requestInFlight.current = true
    searchController.current = controller
    activeConversationRef.current = sessionId
    setActiveConversationId(sessionId)
    setIsLoading(true)
    setProgressStatus('Starting local research...')
    setError('')
    setAnswer('')
    setCitations([])
    setEvidence([])
    setMessages((current) => [
      ...current,
      { id: userMessageId, conversationId: sessionId, role: 'user', content: trimmed, status: 'completed', evidenceReferences: [] },
      { id: assistantMessageId, conversationId: sessionId, role: 'assistant', content: '', status: 'streaming', evidenceReferences: [] },
    ])
    setClaimAttribution(null)
    setInsufficientEvidence(false)
    setEvidenceStatus('')
    setLlmError(null)
    setAnsweredByLLM(false)
    setSearchedWeb(false)
    setActiveSourceId(null)
    setCurrentResultId(null)
    setSearchedQuery(trimmed)

    try {
      const knownConversation = conversations.some((conversation) => conversation.id === sessionId)
      const payload = {
        query: trimmed,
        forceWebSearch: forceWeb,
        depth: researchDepth,
        alpha: Number(hybridAlpha),
      }

      const response = knownConversation
        ? await sendConversationMessage(sessionId, payload, controller.signal)
        : await startConversationResearch({ ...payload, sessionId }, controller.signal)

      if (generation !== conversationGeneration.current || activeConversationRef.current !== sessionId) return

      const data = await readSearchStream(response, (status) => {
        if (generation !== conversationGeneration.current) return
        if (status === 'Querying SearXNG...') setAnswer('')
        setProgressStatus(status)
      }, (token) => {
        if (generation !== conversationGeneration.current) return
        setAnswer((current) => current + token)
        setMessages((current) => current.map((message) => (message.id === assistantMessageId ? { ...message, content: message.content + token, status: 'streaming' } : message)))
      })

      if (generation !== conversationGeneration.current || activeConversationRef.current !== sessionId) return
      if (typeof data.answer !== 'string' || !Array.isArray(data.citations)) {
        throw new Error(data.message || 'The research service returned an unexpected response.')
      }

      const finalAssistantMessageId = data.assistantMessageId || assistantMessageId
      const finalUserMessageId = data.userMessageId || userMessageId
      const messageEvidenceReferences = (Array.isArray(data.evidence) ? data.evidence : []).map((item) => ({
        sourceId: Number.isInteger(item?.id) ? item.id : null,
        chunkId: Number.isInteger(item?.chunkId) ? item.chunkId : null,
        title: typeof item?.title === 'string' ? item.title : null,
        url: typeof item?.url === 'string' ? item.url : null,
        snippet: typeof item?.text === 'string' ? item.text : null,
      }))

      setMessages((current) =>
        current.map((message) => {
          if (message.id === userMessageId) return { ...message, id: finalUserMessageId }
          if (message.id === assistantMessageId) {
            return {
              ...message,
              id: finalAssistantMessageId,
              content: data.answer,
              status: 'completed',
              evidenceReferences: messageEvidenceReferences,
            }
          }
          return message
        })
      )
      setCurrentAssistantMessageId(finalAssistantMessageId)
      setAnswer(data.answer)
      setCitations(data.citations)
      setEvidence(data.evidence || [])
      setClaimAttribution(data.claimAttribution || null)
      setInsufficientEvidence(Boolean(data.insufficientEvidence))
      setEvidenceStatus(data.evidenceStatus || '')
      setLlmError(data.llmError || null)
      setAnsweredByLLM(Boolean(data.answeredByLLM))
      setSearchedWeb(Boolean(data.searchedWeb))
      setResearchMetadata(data.researchMetadata || null)
      setCurrentResultId(createResultId())

      try {
        await addResearchResult({
          id: createResultId(),
          sessionId: data.conversationId || data.sessionId || sessionId,
          query: trimmed,
          answer: data.answer,
          citations: data.citations,
          evidence: Array.isArray(data.evidence) ? data.evidence : [],
          claimAttribution: data.claimAttribution || null,
          warnings: Array.isArray(data.warnings) ? data.warnings : [],
          insufficientEvidence: Boolean(data.insufficientEvidence),
          answeredByLLM: Boolean(data.answeredByLLM),
          searchedWeb: Boolean(data.searchedWeb),
          evidenceStatus: data.evidenceStatus || '',
          llmError: data.llmError || null,
          researchMetadata: data.researchMetadata || null,
          depth: researchDepth,
          alpha: Number(hybridAlpha),
          missingEvidence: data.missingEvidence || '',
          createdAt: new Date().toISOString(),
          saved: false,
        })
        setResearchHistory((entries) => [{ ...entries[0] }, ...entries])
      } catch {
        // no-op for local history fallback
      }

      await refreshConversations({ silent: true })
    } catch (searchError) {
      if (generation === conversationGeneration.current && activeConversationRef.current === sessionId) {
        setError(searchError?.name === 'AbortError' ? 'Research was stopped before completion.' : searchError instanceof Error ? searchError.message : 'Something went wrong. Please try again.')
        setMessages((current) => current.map((message) => (message.id === assistantMessageId ? { ...message, content: searchError?.name === 'AbortError' ? 'Research was interrupted.' : searchError instanceof Error ? searchError.message : 'Research could not be completed.', status: 'failed' } : message)))
        await refreshConversations({ silent: true })
      }
    } finally {
      if (searchController.current === controller) searchController.current = null
      if (generation === conversationGeneration.current) {
        requestInFlight.current = false
        setIsLoading(false)
        setProgressStatus('')
      }
    }
  }

  function readSearchStream(response, onStatus, onToken) {
    if (!response.body) throw new Error('The research service returned an empty stream.')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let result = null

    const processFrame = (frame) => {
      let event = 'message'
      const data = []
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        if (line.startsWith('data:')) data.push(line.slice(5).trim())
      }
      if (data.length === 0) return
      const payload = JSON.parse(data.join('\n'))
      if (event === 'status') onStatus(payload.message)
      if (event === 'token') onToken(payload.text)
      if (event === 'done') result = payload.result
      if (event === 'error') throw new Error(payload.error || 'Research could not be completed.')
    }

    return (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read()
          buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n')
          let frameEnd
          while ((frameEnd = buffer.indexOf('\n\n')) !== -1) {
            processFrame(buffer.slice(0, frameEnd))
            buffer = buffer.slice(frameEnd + 2)
          }
          if (done) break
        }
        if (buffer.trim()) processFrame(buffer)
      } finally {
        reader.releaseLock()
      }

      if (!result) throw new Error('The research stream ended before returning a result.')
      return result
    })()
  }

  async function toggleSavedResult(entry) {
    try {
      const updated = await setResearchSaved(entry.id, !entry.saved)
      setResearchHistory((entries) => entries.map((item) => (item.id === updated.id ? updated : item)))
    } catch {
      // no-op
    }
  }

  async function removeResearchResult(entry) {
    try {
      await deleteResearchResult(entry.id)
      setResearchHistory((entries) => entries.filter((item) => item.id !== entry.id))
      if (currentResultId === entry.id) setCurrentResultId(null)
    } catch {
      // no-op
    }
  }

  async function clearHistory() {
    if (!window.confirm('Delete all local research history?')) return
    try {
      await clearResearchHistory()
      setResearchHistory([])
      setCurrentResultId(null)
    } catch {
      // no-op
    }
  }

  const backendOnline = serviceHealth?.backend?.status === 'online' || serviceHealth?.status === 'online'
  const statusText = serviceHealth ? (backendOnline ? 'Systems operational · Local AI · Retrieval · Web search' : 'Backend starting') : 'Systems checking...'

  const filteredConversations = conversations.filter((conversation) => {
    const base = `${conversation.title || 'Untitled conversation'} ${conversation.updatedAt || conversation.updated_at || ''}`
    const query = conversationSearch.trim().toLowerCase()
    return !query || base.toLowerCase().includes(query)
  })

  const hasConversation = Boolean(activeConversationId || messages.length > 0 || searchedQuery)

  return (
    <main className="app-shell">
      <div className={sidebarOpen ? 'sidebar-backdrop is-visible' : 'sidebar-backdrop'} onClick={() => setSidebarOpen(false)} aria-hidden="true" />

      <Sidebar
        conversations={filteredConversations}
        activeConversationId={activeConversationId}
        conversationSearch={conversationSearch}
        setConversationSearch={setConversationSearch}
        onSelectConversation={async (conversationId) => {
          setSidebarOpen(false)
          await selectConversation(conversationId)
        }}
        onDeleteConversation={(conversation) => {
          setSidebarOpen(false)
          void handleDeleteConversation(conversation)
        }}
        onNewResearch={() => {
          setSidebarOpen(false)
          startNewConversation()
        }}
        onClose={() => setSidebarOpen(false)}
        theme={theme}
        onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
        isOpen={sidebarOpen}
      />

      <div className="workspace-shell">
        <header className="workspace-header">
          <button type="button" className="sidebar-toggle icon-button" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar">
            ☰
          </button>

          <div className="header-status" role="status" aria-live="polite">
            <span className={backendOnline ? 'status-pulse is-live' : 'status-pulse'} />
            {statusText}
          </div>

          <button type="button" className="icon-button theme-button" onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))} aria-label="Toggle theme">
            <ThemeIcon theme={theme} />
          </button>
        </header>

        <div className="workspace">
          {!hasConversation ? (
            <LandingScreen onFocusInput={() => composerRef.current?.querySelector('textarea')?.focus()} />
          ) : (
            <MessageList
              messages={messages}
              citations={citations}
              evidence={evidence}
              activeSourceId={activeSourceId}
              onOpenSource={(sourceId) => setActiveSourceId((current) => (current === sourceId ? null : sourceId))}
              isLoading={isLoading}
              progressStatus={progressStatus}
            />
          )}

          <div ref={composerRef} className="composer-panel">
            <ChatComposer
              query={query}
              setQuery={setQuery}
              onSubmit={(event) => handleSearch(event)}
              isLoading={isLoading}
              researchDepth={researchDepth}
              setResearchDepth={setResearchDepth}
              hybridAlpha={hybridAlpha}
              setHybridAlpha={setHybridAlpha}
              forceWebSearch={forceWebSearch}
              setForceWebSearch={setForceWebSearch}
            />
          </div>
        </div>
      </div>
    </main>
  )
}

export default App
