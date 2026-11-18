import { getDomain, getSafeExternalUrl } from './format'

/**
 * Normalizes whatever evidence a message has into one list of card items.
 *
 * Sources, in order of preference:
 *  1. Live result `evidence`   - full extracted passages, with scores
 *  2. Live result `citations`  - passage snippets, with scores
 *  3. Persisted `evidenceReferences` (restored from SQLite) - passages, no scores
 *
 * Nothing is invented: a missing score stays null and is not rendered. The
 * backend uses score 0 as "no score" in its fallback paths, so 0 is hidden too.
 */
export function getEvidenceItems(research, evidenceReferences) {
  let raw = []

  if (research?.evidence?.length) {
    raw = research.evidence.map((item) => ({
      id: item.id,
      chunkId: item.chunkId,
      title: item.sourceTitle || item.title,
      url: item.url,
      text: item.text ?? item.snippet,
      score: item.score,
    }))
  } else if (research?.citations?.length) {
    raw = research.citations.map((item) => ({
      id: item.id,
      chunkId: null,
      title: item.title,
      url: item.url,
      text: item.snippet,
      score: item.score,
    }))
  } else if (evidenceReferences?.length) {
    raw = evidenceReferences.map((item) => ({
      id: item.sourceId,
      chunkId: item.chunkId,
      title: item.title,
      url: item.url,
      text: item.snippet,
      score: null,
    }))
  }

  return raw.map((item, index) => {
    const number = Number.isInteger(item.id) ? item.id : null
    const domain = getDomain(item.url)
    const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : domain || 'Untitled source'
    const hasScore = typeof item.score === 'number' && Number.isFinite(item.score) && item.score > 0

    return {
      key: `${number ?? 'x'}-${item.chunkId ?? index}`,
      number,
      title,
      domain,
      url: getSafeExternalUrl(item.url),
      text: typeof item.text === 'string' ? item.text.trim() : '',
      score: hasScore ? item.score : null,
    }
  })
}

/** DOM id of one evidence card. Evidence numbers restart at 1 in every answer, so the message id scopes them. */
export function evidenceDomId(messageId, itemKey) {
  return `evidence-${messageId}-${itemKey}`
}

/** Keeps references from a live result in the shape the database stores. */
export function toEvidenceReferences(evidence) {
  return (Array.isArray(evidence) ? evidence : []).map((item) => ({
    sourceId: Number.isInteger(item?.id) ? item.id : null,
    chunkId: Number.isInteger(item?.chunkId) ? item.chunkId : null,
    title: typeof item?.title === 'string' ? item.title : null,
    url: typeof item?.url === 'string' ? item.url : null,
    snippet: typeof item?.text === 'string' ? item.text : null,
  }))
}

/** A short "kubernetes.io, cloud.google.com +2" summary of the distinct sites. */
export function summarizeDomains(items, visible = 3) {
  const domains = [...new Set(items.map((item) => item.domain).filter(Boolean))]
  if (domains.length === 0) return ''
  const shown = domains.slice(0, visible).join(', ')
  return domains.length > visible ? `${shown} +${domains.length - visible}` : shown
}
