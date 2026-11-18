import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  deleteConversation as deleteConversationRequest,
  getConversation,
  listConversations,
  sendConversationMessage,
  startConversationResearch,
} from './conversationApi'
import { AssistantMessage, UserMessage } from './components/Message'
import Composer from './components/Composer'
import ConfirmDialog from './components/ConfirmDialog'
import Sidebar from './components/Sidebar'
import StatusLine from './components/StatusLine'
import { ArrowDownIcon, PanelLeftIcon } from './components/icons'
import { useHealth } from './hooks/useHealth'
import { useMediaQuery } from './hooks/useMediaQuery'
import { usePersistentState } from './hooks/usePersistentState'
import { useTheme } from './hooks/useTheme'
import { conversationTitle, createId, sortConversations } from './lib/format'
import {
  DEFAULT_ALPHA,
  DEFAULT_DEPTH,
  describeProgress,
  isValidAlpha,
  isValidDepth,
} from './lib/research'
import { readResearchStream } from './lib/stream'
import './App.css'

const ACTIVE_SESSION_KEY = 'veriscope-active-session'
const STICK_THRESHOLD = 120

function readStoredSession() {
  try {
    return globalThis.localStorage.getItem(ACTIVE_SESSION_KEY) || null
  } catch {
    return null
  }
}

function writeStoredSession(id) {
  try {
    if (id) globalThis.localStorage.setItem(ACTIVE_SESSION_KEY, id)
    else globalThis.localStorage.removeItem(ACTIVE_SESSION_KEY)
  } catch {
    // storage unavailable: restoring the last conversation is a convenience only
  }
}

/** A message restored from the database can never still be streaming: the request that owned it is gone. */
function normalizeRestoredMessage(message) {
  if (message.status !== 'streaming') return message
  return { ...message, status: 'failed', content: message.content || '', error: 'This research was interrupted before it finished.' }
}

function errorText(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback
}

export default function App() {
  const [theme, setTheme] = useTheme()
  const health = useHealth()
  const isDesktop = useMediaQuery('(min-width: 768px)')

  // Composer preferences. New keys: the old ones stored bare strings in a different format.
  const [depth, setDepth] = usePersistentState('veriscope-depth-v2', DEFAULT_DEPTH, isValidDepth)
  const [alpha, setAlpha] = usePersistentState('veriscope-alpha-v2', DEFAULT_ALPHA, isValidAlpha)
  const [forceWeb, setForceWeb] = useState(false)
  const [query, setQuery] = useState('')

  const [sidebarOpen, setSidebarOpen] = useState(() => globalThis.matchMedia?.('(min-width: 768px)').matches ?? true)
  const [sidebarSearch, setSidebarSearch] = useState('')
  const [conversations, setConversations] = useState([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [activeId, setActiveId] = useState(null)
  const [messages, setMessages] = useState([])
  const [conversationLoading, setConversationLoading] = useState(false)
  const [conversationError, setConversationError] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [showJump, setShowJump] = useState(false)

  const requestInFlight = useRef(false)
  const searchController = useRef(null)
  const loadController = useRef(null)
  const activeIdRef = useRef(null)
  const generation = useRef(0)
  const persistedIds = useRef(new Set())
  const scrollRef = useRef(null)
  const stickRef = useRef(true)
  const textareaRef = useRef(null)

  // ---------- Sidebar follows the breakpoint: open on desktop, closed overlay on mobile ----------
  useEffect(() => {
    setSidebarOpen(isDesktop)
  }, [isDesktop])

  useEffect(() => {
    if (isDesktop || !sidebarOpen) return undefined
    const onKeyDown = (event) => event.key === 'Escape' && setSidebarOpen(false)
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isDesktop, sidebarOpen])

  // Only ever writes a value. Clearing is explicit (new conversation, delete, 404), because on the
  // first render activeId is still null and clearing here would erase the session we are about to restore.
  useEffect(() => {
    if (activeId) writeStoredSession(activeId)
  }, [activeId])

  // ---------- Scrolling: follow new content only while the reader is at the bottom ----------
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (element && stickRef.current) element.scrollTop = element.scrollHeight
  }, [messages, conversationLoading])

  const handleScroll = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < STICK_THRESHOLD
    stickRef.current = nearBottom
    setShowJump(!nearBottom)
  }, [])

  const jumpToLatest = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    stickRef.current = true
    setShowJump(false)
    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
  }, [])

  // ---------- Conversation list ----------
  const refreshConversations = useCallback(async ({ silent = false, signal } = {}) => {
    try {
      const entries = await listConversations({ signal })
      if (!Array.isArray(entries)) throw new Error('The conversation service returned an invalid list.')
      entries.forEach((entry) => persistedIds.current.add(entry.id))
      setConversations(sortConversations(entries))
      setListError('')
      return entries
    } catch (error) {
      if (error?.name === 'AbortError') return null
      if (!silent) setListError(errorText(error, 'Conversation history could not be loaded.'))
      return null
    }
  }, [])

  const selectConversation = useCallback(async (conversationId) => {
    if (!conversationId) return
    const run = ++generation.current

    searchController.current?.abort()
    searchController.current = null
    requestInFlight.current = false
    loadController.current?.abort()
    const controller = new AbortController()
    loadController.current = controller

    activeIdRef.current = conversationId
    setActiveId(conversationId)
    setMessages([])
    setBusy(false)
    setProgress('')
    setConversationError('')
    setConversationLoading(true)
    stickRef.current = true

    try {
      const conversation = await getConversation(conversationId, { signal: controller.signal })
      if (run !== generation.current) return
      if (conversation.id !== conversationId || !Array.isArray(conversation.messages)) {
        throw new Error('The conversation service returned an invalid conversation.')
      }
      setMessages(conversation.messages.map(normalizeRestoredMessage))
    } catch (error) {
      if (run !== generation.current || error?.name === 'AbortError') return
      setConversationError(errorText(error, 'This conversation could not be loaded.'))
      if (error?.status === 404) {
        persistedIds.current.delete(conversationId)
        setConversations((entries) => entries.filter((entry) => entry.id !== conversationId))
        activeIdRef.current = null
        setActiveId(null)
        writeStoredSession(null)
      }
    } finally {
      if (run === generation.current) {
        setConversationLoading(false)
        if (loadController.current === controller) loadController.current = null
      }
    }
  }, [])

  // Initial load, restoring the conversation that was open last time.
  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      setListLoading(true)
      const entries = await refreshConversations({ signal: controller.signal })
      if (controller.signal.aborted) return
      setListLoading(false)

      const savedId = readStoredSession()
      if (savedId && entries?.some((entry) => entry.id === savedId)) selectConversation(savedId)
      else if (savedId && entries) writeStoredSession(null)
    }

    load()
    return () => {
      controller.abort()
      loadController.current?.abort()
      searchController.current?.abort()
    }
  }, [refreshConversations, selectConversation])

  const startNewConversation = useCallback(() => {
    generation.current += 1
    searchController.current?.abort()
    searchController.current = null
    loadController.current?.abort()
    loadController.current = null
    requestInFlight.current = false
    activeIdRef.current = null
    writeStoredSession(null)

    setActiveId(null)
    setMessages([])
    setQuery('')
    setBusy(false)
    setProgress('')
    setConversationLoading(false)
    setConversationError('')
    setForceWeb(false)
    stickRef.current = true
    if (!isDesktop) setSidebarOpen(false)
    window.setTimeout(() => textareaRef.current?.focus(), 0)
  }, [isDesktop])

  const handleSelect = useCallback(
    (id) => {
      if (!isDesktop) setSidebarOpen(false)
      if (id !== activeIdRef.current) selectConversation(id)
    },
    [isDesktop, selectConversation]
  )

  async function confirmDelete() {
    const target = deleteTarget
    if (!target || deleting) return

    setDeleting(true)
    const isActive = activeIdRef.current === target.id
    try {
      await deleteConversationRequest(target.id)
      persistedIds.current.delete(target.id)
      setConversations((entries) => entries.filter((entry) => entry.id !== target.id))
      if (isActive) startNewConversation()
      setDeleteTarget(null)
    } catch (error) {
      setDeleteTarget(null)
      setListError(errorText(error, 'Conversation could not be deleted.'))
    } finally {
      setDeleting(false)
    }
  }

  // ---------- Research ----------
  async function handleSubmit() {
    const text = query.trim()
    if (!text || requestInFlight.current) return

    const run = generation.current
    const sessionId = activeIdRef.current || createId()
    const assistantKey = `a-${createId()}`
    const userKey = `u-${createId()}`
    const controller = new AbortController()

    requestInFlight.current = true
    searchController.current = controller
    activeIdRef.current = sessionId
    stickRef.current = true

    setActiveId(sessionId)
    setBusy(true)
    setProgress('Starting…')
    setConversationError('')
    setQuery('')
    setMessages((current) => [
      ...current,
      { id: userKey, clientKey: userKey, conversationId: sessionId, role: 'user', content: text, status: 'completed' },
      { id: assistantKey, clientKey: assistantKey, conversationId: sessionId, role: 'assistant', content: '', status: 'streaming' },
    ])

    const patchAssistant = (patch) =>
      setMessages((current) =>
        current.map((message) =>
          message.clientKey === assistantKey ? (typeof patch === 'function' ? patch(message) : { ...message, ...patch }) : message
        )
      )

    // Tokens arrive far faster than the screen refreshes; batch them to one render per frame.
    let pendingText = ''
    let frame = 0
    const flushTokens = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      if (!pendingText) return
      const chunk = pendingText
      pendingText = ''
      patchAssistant((message) => ({ ...message, content: message.content + chunk }))
    }
    const discardTokens = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      pendingText = ''
    }

    const isCurrent = () => run === generation.current && activeIdRef.current === sessionId

    try {
      const payload = { query: text, forceWebSearch: Boolean(forceWeb), depth, alpha }
      const response = persistedIds.current.has(sessionId)
        ? await sendConversationMessage(sessionId, payload, controller.signal)
        : await startConversationResearch({ ...payload, sessionId }, controller.signal)

      if (!isCurrent()) return

      const data = await readResearchStream(response, {
        onStatus(status) {
          if (!isCurrent()) return
          // The backend restarts the answer after the local attempt and switches to web research.
          if (/^Querying SearXNG/i.test(status)) {
            discardTokens()
            patchAssistant({ content: '' })
          }
          setProgress(describeProgress(status))
        },
        onToken(token) {
          if (!isCurrent()) return
          pendingText += token
          if (!frame) frame = requestAnimationFrame(flushTokens)
        },
      })

      if (!isCurrent()) return
      discardTokens()

      if (typeof data.answer !== 'string' || !Array.isArray(data.citations)) {
        throw new Error(data.message || 'The research service returned an unexpected response.')
      }

      persistedIds.current.add(sessionId)
      setMessages((current) =>
        current.map((message) => {
          if (message.clientKey === userKey) return { ...message, id: data.userMessageId || message.id }
          if (message.clientKey === assistantKey) {
            return {
              ...message,
              id: data.assistantMessageId || message.id,
              content: data.answer,
              status: 'completed',
              research: data,
            }
          }
          return message
        })
      )
      refreshConversations({ silent: true })
    } catch (error) {
      if (isCurrent()) {
        flushTokens()
        const aborted = error?.name === 'AbortError'
        patchAssistant({
          status: 'failed',
          error: aborted ? 'Research was stopped.' : errorText(error, 'Research could not be completed.'),
        })
        refreshConversations({ silent: true })
      }
    } finally {
      discardTokens()
      if (searchController.current === controller) searchController.current = null
      if (run === generation.current) {
        requestInFlight.current = false
        setBusy(false)
        setProgress('')
      }
    }
  }

  const handleStop = useCallback(() => searchController.current?.abort(), [])

  const landing = !activeId
  const lastStreamingKey = busy ? messages.findLast?.((message) => message.status === 'streaming')?.clientKey ?? null : null

  return (
    <div className="app">
      <Sidebar
        open={sidebarOpen}
        conversations={conversations}
        activeId={activeId}
        loading={listLoading}
        error={listError}
        search={sidebarSearch}
        onSearchChange={setSidebarSearch}
        onSelect={handleSelect}
        onDelete={setDeleteTarget}
        onNew={startNewConversation}
        onClose={() => setSidebarOpen(false)}
        onRetry={() => {
          setListLoading(true)
          refreshConversations().finally(() => setListLoading(false))
        }}
        theme={theme}
        onThemeChange={setTheme}
      />

      {!isDesktop && sidebarOpen && (
        <button type="button" className="scrim" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)} />
      )}

      <main className="workspace" data-landing={landing}>
        <header className="topbar">
          {!sidebarOpen && (
            <button type="button" className="icon-btn" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar">
              <PanelLeftIcon size={18} />
            </button>
          )}
        </header>

        <div className="stage">
          <div className="scroll" ref={scrollRef} onScroll={handleScroll}>
            <div className="column thread">
              {conversationLoading && <p className="thread-note">Loading conversation…</p>}
              {messages.map((message) =>
                message.role === 'user' ? (
                  <UserMessage key={message.clientKey ?? message.id} message={message} />
                ) : (
                  <AssistantMessage
                    key={message.clientKey ?? message.id}
                    message={message}
                    progress={message.clientKey && message.clientKey === lastStreamingKey ? progress : undefined}
                  />
                )
              )}
            </div>
          </div>

          {showJump && !landing && (
            <button type="button" className="jump" onClick={jumpToLatest} aria-label="Jump to latest">
              <ArrowDownIcon size={16} />
            </button>
          )}
        </div>

        <div className="dock">
          <div className="column">
            {landing && (
              <div className="landing">
                <h1>VeriScope</h1>
                <p>Follow the evidence.</p>
              </div>
            )}

            {conversationError && (
              <div className="banner" role="alert">
                <span>{conversationError}</span>
                {activeId && !conversationLoading && messages.length === 0 && (
                  <button type="button" className="link-btn" onClick={() => selectConversation(activeId)}>
                    Retry
                  </button>
                )}
              </div>
            )}

            <Composer
              value={query}
              onChange={setQuery}
              onSubmit={handleSubmit}
              onStop={handleStop}
              busy={busy}
              depth={depth}
              onDepthChange={setDepth}
              alpha={alpha}
              onAlphaChange={setAlpha}
              forceWeb={forceWeb}
              onForceWebChange={setForceWeb}
              textareaRef={textareaRef}
            />
            <StatusLine health={health} />
          </div>
        </div>
      </main>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete conversation?"
        description={`"${deleteTarget ? conversationTitle(deleteTarget) : ''}" and all of its messages will be permanently deleted.`}
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        onConfirm={confirmDelete}
        onCancel={() => !deleting && setDeleteTarget(null)}
      />
    </div>
  )
}
