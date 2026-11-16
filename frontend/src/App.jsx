import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import VeriscopeSymbol from './VeriscopeSymbol'
import {
  addResearchResult,
  clearResearchHistory,
  deleteResearchResult,
  getResearchHistory,
  setResearchSaved,
} from './researchHistory'
import './App.css'
import 'highlight.js/styles/github-dark.css'

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

function getSafeExternalUrl(url) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
  } catch {
    return null
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

function formatBytes(value) {
  if (!Number.isFinite(value)) return 'Unavailable'
  const units = ['B', 'KiB', 'MiB', 'GiB']
  let amount = value
  let unitIndex = 0
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024
    unitIndex += 1
  }
  return `${amount.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function buildConversationMessages(entries, sessionId) {
  return entries
    .filter((entry) => entry.sessionId === sessionId && entry.query && entry.answer)
    .sort((first, second) => first.createdAt.localeCompare(second.createdAt))
    .slice(-8)
    .flatMap((entry) => [
      { role: 'user', content: entry.query.slice(0, 6000) },
      {
        role: 'assistant',
        content: entry.answer.slice(0, 6000),
        evidenceReferences: (entry.evidence || []).slice(0, 4).map((item) => ({
          title: item.title || 'Web source',
          url: item.url || '',
          chunkId: item.chunkId,
        })),
      },
    ])
}

function remarkCitations({ citationIds = [] } = {}) {
  const knownIds = new Set(citationIds)
  const citationPattern = /\[(?:Source\s*)?(\d+(?:\s*,\s*(?:Source\s*)?\d+)*)\]/gi

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
        citationPattern.lastIndex = 0
        while ((match = citationPattern.exec(child.value)) !== null) {
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

function remarkClaimReferences({ claims = [] } = {}) {
  const references = claims
    .filter((claim) => claim?.claimId && typeof claim.claimText === 'string')
    .map((claim, index) => ({
      claimId: claim.claimId,
      claimText: claim.claimText.replace(/[.!?]+$/, ''),
      label: `Evidence ${String(index + 1).padStart(2, '0')}`,
    }))
    .filter((reference) => reference.claimText)
    .sort((first, second) => second.claimText.length - first.claimText.length)

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
        while (lastIndex < child.value.length) {
          let selected = null
          let selectedIndex = child.value.length
          for (const reference of references) {
            const index = child.value.indexOf(reference.claimText, lastIndex)
            if (index !== -1 && index < selectedIndex) {
              selected = reference
              selectedIndex = index
            }
          }
          if (!selected) break

          if (selectedIndex > lastIndex) {
            parts.push({ type: 'text', value: child.value.slice(lastIndex, selectedIndex) })
          }
          const endIndex = selectedIndex + selected.claimText.length
          parts.push({ type: 'text', value: child.value.slice(selectedIndex, endIndex) })
          parts.push({
            type: 'link',
            url: `#evidence-${selected.claimId}`,
            children: [{ type: 'text', value: ` ${selected.label}` }],
          })
          lastIndex = endIndex
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

async function readSearchStream(response, onStatus, onToken) {
  if (!response.body) {
    throw new Error('The research service returned an empty stream.')
  }

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

  if (!result) {
    throw new Error('The research stream ended before returning a result.')
  }
  return result
}

function App() {
  const [theme, setTheme] = useState(getInitialTheme)
  const [preferenceError, setPreferenceError] = useState('')
  const [researchDepth, setResearchDepth] = useState(() =>
    getInitialPreference('veriscope-research-depth', ['FAST', 'NORMAL', 'MAX'], 'NORMAL')
  )
  const [hybridAlpha, setHybridAlpha] = useState(() =>
    getInitialPreference('veriscope-hybrid-alpha', ['0.3', '0.5', '0.7'], '0.5')
  )
  const [activeSessionId, setActiveSessionId] = useState(getInitialSessionId)
  const [themeError, setThemeError] = useState('')
  const [headlineIndex, setHeadlineIndex] = useState(0)
  const [query, setQuery] = useState('')
  const [searchedQuery, setSearchedQuery] = useState('')
  const [answer, setAnswer] = useState('')
  const [citations, setCitations] = useState([])
  const [evidence, setEvidence] = useState([])
  const [claimAttribution, setClaimAttribution] = useState(null)
  const [insufficientEvidence, setInsufficientEvidence] = useState(false)
  const [answeredByLLM, setAnsweredByLLM] = useState(false)
  const [_searchedWeb, setSearchedWeb] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [progressStatus, setProgressStatus] = useState('')
  const [error, setError] = useState('')
  const [evidenceStatus, setEvidenceStatus] = useState('')
  const [llmError, setLlmError] = useState(null)
  const [serviceHealth, setServiceHealth] = useState(null)
  const [activeSourceId, setActiveSourceId] = useState(null)
  const [openClaimId, setOpenClaimId] = useState(null)
  const [researchHistory, setResearchHistory] = useState([])
  const [historySearch, setHistorySearch] = useState('')
  const [historyFilter, setHistoryFilter] = useState('all')
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState('')
  const [currentResultId, setCurrentResultId] = useState(null)
  const [copyStatus, setCopyStatus] = useState('')
  const [researchMetadata, setResearchMetadata] = useState(null)
  const [runtimeMetrics, setRuntimeMetrics] = useState(null)
  const [runtimeError, setRuntimeError] = useState('')
  const [runtimeLoading, setRuntimeLoading] = useState(false)
  const searchController = useRef(null)
  const isDirectAnswer = answeredByLLM && !_searchedWeb
  const claimEvidence = Array.isArray(claimAttribution?.claims)
    ? claimAttribution.claims
    : []

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      'content',
      theme === 'dark' ? '#09090d' : '#f8f7fb'
    )
  }, [theme])

  useEffect(() => {
    try {
      globalThis.localStorage.setItem('veriscope-research-depth', researchDepth)
      globalThis.localStorage.setItem('veriscope-hybrid-alpha', hybridAlpha)
      setPreferenceError('')
    } catch {
      setPreferenceError('Research settings will not persist because browser storage is unavailable.')
    }
  }, [researchDepth, hybridAlpha])

  useEffect(() => {
    try {
      if (activeSessionId) {
        globalThis.localStorage.setItem('veriscope-active-session', activeSessionId)
      } else {
        globalThis.localStorage.removeItem('veriscope-active-session')
      }
    } catch {
      setPreferenceError('The active conversation will not persist because browser storage is unavailable.')
    }
  }, [activeSessionId])

  useEffect(() => {
    if (searchedQuery || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined
    const timer = window.setInterval(() => {
      setHeadlineIndex((index) => (index + 1) % headlinePhrases.length)
    }, 4800)
    return () => window.clearInterval(timer)
  }, [searchedQuery])

  useEffect(() => {
    let active = true
    let timer
    let controller

    async function checkHealth() {
      try {
        controller = new AbortController()
        const res = await fetch('/api/health', {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!res.ok) {
          throw new Error(`Backend health returned HTTP ${res.status}`)
        }
        const data = await res.json()
        if (active) setServiceHealth(data)
      } catch (healthError) {
        if (active && healthError?.name !== 'AbortError') {
          setServiceHealth({
            status: 'error',
            backend: { status: 'offline' },
            services: null,
            error: healthError instanceof Error
              ? healthError.message
              : 'Backend health is not yet available.',
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

  function scrollToClaimEvidence(claimId) {
    const targetElement = document.getElementById(`claim-evidence-${claimId}`)
    if (!targetElement) return

    setOpenClaimId(claimId)
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    targetElement.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' })
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

  function startNewConversation() {
    const newSessionId = createResultId()
    setActiveSessionId(newSessionId)
    setCurrentResultId(null)
    setSearchedQuery('')
    setAnswer('')
    setCitations([])
    setEvidence([])
    setClaimAttribution(null)
    setResearchMetadata(null)
    setError('')
    setQuery('')
  }

  function stopSearch() {
    searchController.current?.abort()
  }

  async function refreshRuntimeMetrics() {
    setRuntimeLoading(true)
    setRuntimeError('')
    try {
      const response = await fetch('/api/monitoring', { cache: 'no-store' })
      if (!response.ok) {
        throw new Error(`Runtime metrics returned HTTP ${response.status}.`)
      }
      setRuntimeMetrics(await response.json())
    } catch (monitoringError) {
      setRuntimeError(
        monitoringError instanceof Error
          ? monitoringError.message
          : 'Runtime metrics could not be loaded.'
      )
    } finally {
      setRuntimeLoading(false)
    }
  }

  async function handleSearch(event, options = {}) {
    event?.preventDefault()
    const trimmedQuery = query.trim()
    if (!trimmedQuery || isLoading) return

    const forceWeb = Boolean(options.forceWebSearch)
    const sessionId = activeSessionId || createResultId()
    const controller = new AbortController()
    searchController.current = controller
    setActiveSessionId(sessionId)

    setIsLoading(true)
    setProgressStatus('Starting local research...')
    setError('')
    setAnswer('')
    setCitations([])
    setEvidence([])
    setClaimAttribution(null)
    setOpenClaimId(null)
    setInsufficientEvidence(false)
    setEvidenceStatus('')
    setLlmError(null)
    setResearchMetadata(null)
    setAnsweredByLLM(false)
    setSearchedWeb(false)
    setActiveSourceId(null)
    setCurrentResultId(null)
    setCopyStatus('')
    setSearchedQuery(trimmedQuery)

    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          query: trimmedQuery,
          forceWebSearch: forceWeb,
          depth: researchDepth,
          alpha: Number(hybridAlpha),
          sessionId,
          conversation: buildConversationMessages(researchHistory, sessionId),
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || data.error || 'Search could not be completed. Please try again.')
      }

      const data = await readSearchStream(
        response,
        (status) => {
          if (status === 'Querying SearXNG...') setAnswer('')
          setProgressStatus(status)
        },
        (token) => setAnswer((currentAnswer) => currentAnswer + token)
      )

      if (typeof data.answer !== 'string' || !Array.isArray(data.citations)) {
        throw new Error(data.message || 'The research service returned an unexpected response.')
      }

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

      const entry = {
        id: createResultId(),
        sessionId: data.sessionId || sessionId,
        query: trimmedQuery,
        answer: data.answer,
        citations: data.citations,
        evidence: Array.isArray(data.evidence) ? data.evidence : [],
        claimAttribution: data.claimAttribution || null,
        warnings: Array.isArray(data.warnings) ? data.warnings : [],
        insufficientEvidence: Boolean(data.insufficientEvidence),
        llmUnavailable: Boolean(data.llmUnavailable),
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
      setError(searchError?.name === 'AbortError'
        ? 'Research was stopped before completion.'
        : searchError instanceof Error ? searchError.message : 'Something went wrong. Please try again.')
    } finally {
      if (searchController.current === controller) searchController.current = null
      setIsLoading(false)
      setProgressStatus('')
    }
  }

  function reopenResearch(entry) {
    setActiveSessionId(entry.sessionId || null)
    setQuery(entry.query)
    setSearchedQuery(entry.query)
    setAnswer(entry.answer)
    setCitations(entry.citations)
    setEvidence(entry.evidence || [])
    setClaimAttribution(entry.claimAttribution || null)
    setInsufficientEvidence(Boolean(entry.insufficientEvidence))
    setEvidenceStatus(entry.evidenceStatus || '')
    setLlmError(entry.llmError || null)
    setAnsweredByLLM(Boolean(entry.answeredByLLM))
    setSearchedWeb(Boolean(entry.searchedWeb))
    setResearchMetadata(entry.researchMetadata || null)
    if (entry.depth && ['FAST', 'NORMAL', 'MAX'].includes(entry.depth)) {
      setResearchDepth(entry.depth)
    }
    if (Number.isFinite(entry.alpha)) {
      setHybridAlpha(String(entry.alpha))
    }
    setCurrentResultId(entry.id)
    setActiveSourceId(null)
    setOpenClaimId(null)
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
  const healthServices = serviceHealth?.services
  const backendOnline =
    serviceHealth?.backend?.status === 'online' || serviceHealth?.status === 'online'
  const ollamaHealth = healthServices?.ollama
  const ollamaReachable = Boolean(ollamaHealth?.reachable ?? ollamaHealth?.available)
  const ollamaModel = ollamaHealth?.model
  const ollamaModelMissing =
    ollamaHealth?.status === 'model_missing' || ollamaModel?.status === 'model_missing'
  const healthNeedsNotice =
    !backendOnline ||
    (healthServices && (
      !ollamaReachable ||
      ollamaModelMissing ||
      ollamaHealth?.status === 'error' ||
      healthServices.searxng?.status !== 'online' ||
      healthServices.embedding?.status !== 'online'
    ))
  const backendStatusLabel = !backendOnline
    ? 'BACKEND STARTING'
    : ollamaModelMissing
    ? 'BACKEND ONLINE · MODEL MISSING'
    : !ollamaReachable
    ? 'BACKEND ONLINE · OLLAMA UNREACHABLE'
    : 'BACKEND ONLINE'
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
            ? backendOnline ? 'service-connected' : 'service-degraded'
            : 'service-unknown'}`}
          role="status"
          title={serviceHealth
            ? [
                `backend: ${backendOnline ? 'online' : 'starting or unreachable'}`,
                ollamaHealth
                  ? `ollama: ${ollamaReachable ? 'online' : ollamaHealth.status}`
                  : 'ollama: status unavailable',
                ollamaModel?.name
                  ? `${ollamaModel.name}: ${ollamaModel.installed ? 'installed' : ollamaModel.status}`
                  : '',
              ].filter(Boolean).join(' · ')
            : 'Local services are checked in the background'}
        >
          <span className="status-dot" />
          <span>{serviceHealth ? backendStatusLabel : 'LOCAL-FIRST RESEARCH'}</span>
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
      {preferenceError && <p className="preference-error" role="status">{preferenceError}</p>}

      {serviceHealth && healthNeedsNotice && (
        <div className="service-alert-bar" role="status">
          <span className="service-alert-icon" aria-hidden="true">!</span>
          <span>
            <strong>Local service notice:</strong>{' '}
            {!backendOnline && (
              <span className="offline-tag">Backend health is not available yet; the UI will retry automatically. </span>
            )}
            {ollamaHealth && !ollamaReachable && (
              <span className="offline-tag">
                Ollama is unreachable from the backend at <code>{ollamaHealth.url}</code>. {ollamaHealth.error || 'Check the Ollama service and backend network path.'}{' '}
              </span>
            )}
            {ollamaHealth && ollamaReachable && ollamaModelMissing && (
              <span className="offline-tag">
                Ollama is online, but <code>{ollamaModel?.name || 'the configured model'}</code> is missing. Run <code>ollama pull {ollamaModel?.name || ''}</code>.{' '}
              </span>
            )}
            {ollamaHealth?.status === 'error' && (
              <span className="offline-tag">Ollama health check error: {ollamaHealth.error || 'Check OLLAMA_URL and OLLAMA_MODEL.'} </span>
            )}
            {healthServices?.searxng?.status !== 'online' && healthServices?.searxng && (
              <span className="offline-tag">SearXNG is unavailable; web search may not work. </span>
            )}
            {healthServices?.embedding?.status !== 'online' && healthServices?.embedding && (
              <span className="offline-tag">Embedding service is offline; lexical retrieval may be used. </span>
            )}
          </span>
        </div>
      )}

      <details className="runtime-monitor">
        <summary>Runtime metrics · on demand</summary>
        <div className="runtime-monitor-content">
          <button
            type="button"
            className="result-action-button"
            onClick={refreshRuntimeMetrics}
            disabled={runtimeLoading}
          >
            {runtimeLoading ? 'Checking local runtime…' : 'Refresh metrics'}
          </button>
          {runtimeError && <p className="runtime-error" role="status">{runtimeError}</p>}
          {runtimeMetrics && (
            <dl className="runtime-metrics-grid">
              <div>
                <dt>Model</dt>
                <dd>{runtimeMetrics.model?.name || 'Unavailable'} · {runtimeMetrics.model?.loaded ? 'loaded' : 'unloaded'}</dd>
              </div>
              <div>
                <dt>Ollama</dt>
                <dd>{runtimeMetrics.model?.status || 'Unavailable'}</dd>
              </div>
              <div>
                <dt>GPU</dt>
                <dd>{runtimeMetrics.gpu?.available
                  ? `${runtimeMetrics.gpu.name} · ${runtimeMetrics.gpu.utilizationPercent}% · ${runtimeMetrics.gpu.memoryUsedMiB}/${runtimeMetrics.gpu.memoryTotalMiB} MiB`
                  : runtimeMetrics.gpu?.error || 'Unavailable'}</dd>
              </div>
              <div>
                <dt>Model allocation</dt>
                <dd>{runtimeMetrics.model?.allocation?.processor || 'Unavailable'} · GPU {formatBytes(runtimeMetrics.model?.allocation?.gpuBytes)} / CPU {formatBytes(runtimeMetrics.model?.allocation?.cpuBytes)} (approx.)</dd>
              </div>
              <div>
                <dt>CPU memory</dt>
                <dd>{formatBytes(runtimeMetrics.cpuMemory?.usedBytes)} used / {formatBytes(runtimeMetrics.cpuMemory?.totalBytes)}</dd>
              </div>
              <div>
                <dt>Loaded context</dt>
                <dd>{runtimeMetrics.model?.contextLength ?? 'Unavailable'} tokens</dd>
              </div>
              <div>
                <dt>Last retrieval</dt>
                <dd>{runtimeMetrics.retrieval
                  ? `${runtimeMetrics.retrieval.depth} · ${runtimeMetrics.retrieval.retrievedChunkCount} retrieved / ${runtimeMetrics.retrieval.chunksSent} sent · ~${runtimeMetrics.retrieval.evidenceTokenCount} evidence tokens`
                  : 'Unavailable'}</dd>
              </div>
              <div>
                <dt>Generation</dt>
                <dd>{runtimeMetrics.retrieval?.timeToFirstTokenMs == null
                  ? 'TTFT unavailable'
                  : `${runtimeMetrics.retrieval.timeToFirstTokenMs} ms TTFT · ${runtimeMetrics.retrieval.generationTimeMs ?? 'Unavailable'} ms total`}</dd>
              </div>
            </dl>
          )}
        </div>
      </details>

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
          {isLoading && (
            <button className="stop-button" type="button" onClick={stopSearch}>
              Stop
            </button>
          )}
        </form>

        <div className="research-controls">
          <div className="depth-selector" role="group" aria-label="Research depth">
            {['FAST', 'NORMAL', 'MAX'].map((depth) => (
              <button
                type="button"
                key={depth}
                className={researchDepth === depth ? 'depth-option depth-option-active' : 'depth-option'}
                aria-pressed={researchDepth === depth}
                disabled={isLoading}
                onClick={() => setResearchDepth(depth)}
              >
                {depth === 'NORMAL' ? 'Normal' : depth === 'FAST' ? 'Fast' : 'Max'}
              </button>
            ))}
          </div>
          <details className="advanced-research-settings">
            <summary>Advanced</summary>
            <label>
              BM25 / MiniLM balance
              <select
                value={hybridAlpha}
                disabled={isLoading}
                onChange={(event) => setHybridAlpha(event.target.value)}
              >
                <option value="0.3">0.3 · Semantic-heavy</option>
                <option value="0.5">0.5 · Balanced</option>
                <option value="0.7">0.7 · Keyword-heavy</option>
              </select>
            </label>
          </details>
          <button
            className="new-conversation-button"
            type="button"
            disabled={isLoading}
            onClick={startNewConversation}
          >
            New conversation
          </button>
        </div>

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
              <div className="results-kicker">LIVE RESEARCH STATUS</div>
              <h3>{progressStatus}</h3>
              <p>Research is running locally. Answer text appears as it is generated.</p>
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

          {((!isLoading && !error) || isLoading) && answer && (
            <div className="research-output">
              {llmError && (
                <div className="service-alert-bar" role="status">
                  <span className="service-alert-icon" aria-hidden="true">!</span>
                  <span><strong>Ollama response issue:</strong> {llmError.message}</span>
                </div>
              )}
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

                {researchMetadata && (
                  <dl className="research-metadata">
                    <div>
                      <dt>Depth</dt>
                      <dd>{researchMetadata.depth}</dd>
                    </div>
                    <div>
                      <dt>Chunks</dt>
                      <dd>{researchMetadata.retrievedChunkCount} retrieved · {researchMetadata.chunksSent} sent</dd>
                    </div>
                    <div>
                      <dt>Evidence</dt>
                      <dd>~{researchMetadata.evidenceTokenCount} tokens</dd>
                    </div>
                    <div>
                      <dt>Alpha</dt>
                      <dd>{researchMetadata.alpha}</dd>
                    </div>
                    {researchMetadata.retrievalTimeMs != null && (
                      <div>
                        <dt>Retrieval</dt>
                        <dd>{researchMetadata.retrievalTimeMs} ms</dd>
                      </div>
                    )}
                    {researchMetadata.timeToFirstTokenMs != null && (
                      <div>
                        <dt>First token</dt>
                        <dd>{researchMetadata.timeToFirstTokenMs} ms</dd>
                      </div>
                    )}
                    {researchMetadata.generationTimeMs != null && (
                      <div>
                        <dt>Generation</dt>
                        <dd>{researchMetadata.generationTimeMs} ms</dd>
                      </div>
                    )}
                  </dl>
                )}

                <div className="answer-text">
                  <ReactMarkdown
                    remarkPlugins={[
                      remarkGfm,
                      [remarkCitations, { citationIds: citations.map((citation) => citation.id) }],
                      [remarkClaimReferences, { claims: claimEvidence }],
                    ]}
                    rehypePlugins={[rehypeHighlight]}
                    components={{
                      a: ({ href, children, ...props }) => {
                        const evidenceMatch = href?.match(/^#evidence-(claim_\d{2})$/)
                        if (evidenceMatch) {
                          return (
                            <button
                              type="button"
                              className="inline-evidence-reference"
                              onClick={() => scrollToClaimEvidence(evidenceMatch[1])}
                              aria-label={`Open evidence for ${evidenceMatch[1].replace('_', ' ')}`}
                            >
                              {children}
                            </button>
                          )
                        }
                        const citationMatch = href?.match(/^#source-(\d+)$/)
                        if (citationMatch) {
                          const id = Number(citationMatch[1])
                          const citation = citations.find((entry) => entry.id === id)
                          if (citation) {
                            return (
                              <button
                                type="button"
                                className="inline-citation"
                                onClick={() => scrollToSource(id)}
                                title={`[Source ${id}] ${citation.title}`}
                                aria-label={`Jump to Source ${id}`}
                              >
                                {children}
                              </button>
                            )
                          }
                        }
                        return <a href={href} target="_blank" rel="noreferrer" {...props}>{children}</a>
                      },
                    }}
                  >
                    {answer}
                  </ReactMarkdown>
                </div>
              </article>

              {claimAttribution?.status === 'unavailable' && (
                <div className="claim-attribution-notice" role="status">
                  Claim-level evidence attribution is unavailable. The answer and existing citations are unchanged.
                </div>
              )}

              {claimEvidence.length > 0 && (
                <section className="claim-evidence-section" aria-labelledby="claim-evidence-title">
                  <div className="subsection-heading">
                    <div>
                      <div className="results-kicker">CLAIM-LEVEL ATTRIBUTION</div>
                      <h3 id="claim-evidence-title">Evidence for individual claims</h3>
                    </div>
                    <span className="source-total">
                      {claimEvidence.length} {claimEvidence.length === 1 ? 'claim' : 'claims'}
                    </span>
                  </div>
                  <p className="claim-evidence-disclaimer">
                    Passages are drawn from retrieved text. Retrieval relevance is not proof or independent fact-checking.
                  </p>
                  <div className="claim-evidence-list">
                    {claimEvidence.map((claim, index) => {
                      const statusLabel = {
                        direct: 'Direct support',
                        partial: 'Partial support',
                        related: 'Related context',
                        unsupported: 'Unsupported',
                      }[claim.status] || 'Unsupported'

                      return (
                        <article
                          className={`claim-evidence-card ${openClaimId === claim.claimId ? 'claim-evidence-card-open' : ''}`}
                          id={`claim-evidence-${claim.claimId}`}
                          key={claim.claimId}
                        >
                          <button
                            type="button"
                            className="claim-evidence-summary"
                            aria-expanded={openClaimId === claim.claimId}
                            aria-controls={`claim-evidence-body-${claim.claimId}`}
                            onClick={() => setOpenClaimId((current) => current === claim.claimId ? null : claim.claimId)}
                          >
                            <span className="claim-evidence-id">
                              Claim {String(index + 1).padStart(2, '0')}
                            </span>
                            <span className="claim-evidence-text">{claim.claimText}</span>
                            <span className={`claim-support-label claim-support-${claim.status}`}>
                              {statusLabel}
                            </span>
                          </button>
                          <div
                            className="claim-evidence-body"
                            id={`claim-evidence-body-${claim.claimId}`}
                            aria-hidden={openClaimId !== claim.claimId}
                            inert={openClaimId !== claim.claimId}
                          >
                            <div className="claim-evidence-content">
                              {!Array.isArray(claim.evidence) || claim.evidence.length === 0 ? (
                                <p className="claim-unsupported-message">
                                  No retrieved passage was identified as supporting this claim.
                                </p>
                              ) : claim.evidence.map((item, evidenceIndex) => {
                                const externalUrl = getSafeExternalUrl(item.url)
                                const evidenceStatusLabel = {
                                  direct: 'Direct support',
                                  partial: 'Partial support',
                                  related: 'Related context',
                                }[item.supportStatus] || 'Unsupported'

                                return (
                                  <article className="claim-source-card" key={`${item.chunkId}-${evidenceIndex}`}>
                                    <div className="claim-source-heading">
                                      <span className="claim-domain-mark" aria-hidden="true">
                                        {(item.domain || '?').slice(0, 1).toUpperCase()}
                                      </span>
                                      <div className="claim-source-identity">
                                        <strong>{item.title || 'Source title unavailable'}</strong>
                                        <span>{item.domain || 'Domain unavailable'}</span>
                                      </div>
                                      <span className={`claim-support-label claim-support-${item.supportStatus}`}>
                                        {evidenceStatusLabel}
                                      </span>
                                    </div>
                                    <blockquote className="claim-source-quote">
                                      {item.extractedText}
                                    </blockquote>
                                    <div className="claim-source-meta">
                                      <span>
                                        {item.sourceId ? `[Source ${item.sourceId}] · ` : ''}
                                        Chunk {item.chunkId}
                                      </span>
                                      {typeof item.relevanceScore === 'number' && (
                                        <span>{Math.round(item.relevanceScore * 100)}% retrieval relevance</span>
                                      )}
                                      {externalUrl && (
                                        <a href={externalUrl} target="_blank" rel="noreferrer">
                                          Open source <ExternalIcon />
                                        </a>
                                      )}
                                    </div>
                                  </article>
                                )
                              })}
                            </div>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </section>
              )}

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
