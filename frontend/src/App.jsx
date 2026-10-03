import { useState } from 'react'
import heroImg from './assets/hero.png'
import './App.css'

const suggestions = ['quiet luxury interiors', 'how does LLM search work?', 'designing with light']

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

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'Web result'
  }
}

function App() {
  const [query, setQuery] = useState('')
  const [searchedQuery, setSearchedQuery] = useState('')
  const [answer, setAnswer] = useState('')
  const [citations, setCitations] = useState([])
  const [evidence, setEvidence] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSearch(event) {
    event?.preventDefault()
    const trimmedQuery = query.trim()
    if (!trimmedQuery || isLoading) return

    setIsLoading(true)
    setError('')
    setAnswer('')
    setCitations([])
    setEvidence([])
    setSearchedQuery(trimmedQuery)

    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmedQuery }),
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Search could not be completed. Please try again.')
      }
      if (typeof data.answer !== 'string' || !Array.isArray(data.citations) || !Array.isArray(data.evidence)) {
        throw new Error(data.message || 'The research service returned an unexpected response.')
      }

      setAnswer(data.answer)
      setCitations(data.citations)
      setEvidence(data.evidence)
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : 'Something went wrong. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="topbar">
        <a className="wordmark" href="/" aria-label="VeriScope home">
          <img src={heroImg} alt="" />
          <span>veriscope<span className="wordmark-period">.</span></span>
        </a>
        <div className="topbar-note">
          <span className="status-dot" />
          <span>Independent search, made clear</span>
        </div>
        <a className="about-link" href="https://searxng.org/" target="_blank" rel="noreferrer">
          About <ArrowIcon />
        </a>
      </header>

      <section className={`hero ${searchedQuery ? 'hero-compact' : ''}`}>
        <div className="eyebrow"><span className="eyebrow-line" /> A clearer way to explore</div>
        <h1>
          Find your signal<span className="heading-period">.</span>
          <span className="heading-subtitle">Search the web. Keep your perspective.</span>
        </h1>
        <p className="hero-copy">
          One thoughtful search across the open web, with room to follow what matters.
        </p>

        <form className="search-panel glass-panel" onSubmit={handleSearch}>
          <span className="search-leading"><SearchIcon size={21} /></span>
          <label className="visually-hidden" htmlFor="search-query">Search the web</label>
          <input
            id="search-query"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="What are you curious about?"
            autoComplete="off"
          />
          {query && (
            <button className="clear-button" type="button" onClick={() => setQuery('')} aria-label="Clear search">
              <span aria-hidden="true">×</span>
            </button>
          )}
          <button className="search-button" type="submit" disabled={!query.trim() || isLoading}>
            <span>{isLoading ? 'Searching' : 'Search'}</span>
            {isLoading ? <span className="button-spinner" /> : <ArrowIcon />}
          </button>
        </form>

        {!searchedQuery && (
          <div className="suggestions">
            <span className="suggestions-label">A few starting points</span>
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
      </section>

      {(isLoading || error || searchedQuery) && (
        <section className="results-section" aria-live="polite">
          <div className="results-heading">
            <div>
              <div className="results-kicker">{isLoading ? 'Searching up to 5 sources' : 'Research summary'}</div>
              <h2>{searchedQuery}</h2>
            </div>
            {!isLoading && !error && citations.length > 0 && (
              <div className="result-count">
                <span className="count-light" />
                {citations.length} {citations.length === 1 ? 'source' : 'sources'}
              </div>
            )}
          </div>

          {isLoading && (
            <div className="result-list" aria-label="Loading search results">
              {[0, 1, 2].map((item) => (
                <div className="result-card skeleton-card" key={item}>
                  <div className="skeleton-line skeleton-source" />
                  <div className="skeleton-line skeleton-title" />
                  <div className="skeleton-line skeleton-copy" />
                  <div className="skeleton-line skeleton-copy short" />
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="feedback-card error-card">
              <div className="feedback-icon">!</div>
              <div>
                <h3>We couldn’t complete that search</h3>
                <p>{error} Make sure the VeriScope API is running, then try again.</p>
              </div>
              <button className="retry-button" type="button" onClick={handleSearch}>Try again <ArrowIcon /></button>
            </div>
          )}

          {!isLoading && !error && searchedQuery && !answer && citations.length === 0 && (
            <div className="feedback-card">
              <div className="feedback-icon"><SearchIcon /></div>
              <div>
                <h3>No research was returned</h3>
                <p>Try a different phrase or check that the search and local AI services are running.</p>
              </div>
            </div>
          )}

          {!isLoading && !error && answer && (
            <div className="research-output">
              <article className="answer-card glass-panel">
                <div className="answer-label"><span className="answer-spark">✳</span> Mistral synthesis</div>
                <p className="answer-text">{answer}</p>
              </article>

              {citations.length > 0 && (
                <section className="source-section" aria-labelledby="sources-title">
                  <div className="subsection-heading">
                    <div>
                      <div className="results-kicker">Referenced by the answer</div>
                      <h3 id="sources-title">Sources</h3>
                    </div>
                    <span className="source-total">{citations.length} cited</span>
                  </div>
                  <div className="source-list">
                    {citations.map((citation) => (
                      <a className="source-card glass-panel" href={citation.url} target="_blank" rel="noreferrer" key={citation.id}>
                        <span className="source-mark">{getDomain(citation.url).charAt(0).toUpperCase()}</span>
                        <span className="source-copy">
                          <span className="source-title">[{citation.id}] {citation.title || getDomain(citation.url)}</span>
                          <span className="source-domain">{getDomain(citation.url)}</span>
                        </span>
                        <span className="source-link-icon"><ArrowIcon /></span>
                      </a>
                    ))}
                  </div>
                </section>
              )}

              {evidence.length > 0 && (
                <details className="evidence-details">
                  <summary>View retrieved evidence <span>{evidence.length} passages</span></summary>
                  <div className="evidence-list">
                    {evidence.map((item) => (
                      <article className="evidence-card" key={item.id}>
                        <div className="evidence-heading">
                          <span>[{item.id}] {item.title}</span>
                          <a href={item.url} target="_blank" rel="noreferrer">Open source <ArrowIcon /></a>
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
        <span>Curiosity, without the noise.</span>
        <span className="footer-right"><span className="footer-spark">✳</span> Powered by the open web</span>
      </footer>
    </main>
  )
}

export default App
