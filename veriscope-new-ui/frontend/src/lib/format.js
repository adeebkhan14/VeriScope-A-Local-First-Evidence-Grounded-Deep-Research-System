export function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** Returns a normalized http(s) URL, or null for anything else (javascript:, data:, relative...). */
export function getSafeExternalUrl(url) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
  } catch {
    return null
  }
}

export function createId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function conversationTitle(conversation) {
  return conversation?.title?.trim() || 'Untitled conversation'
}

function conversationTime(conversation) {
  const value = conversation.updatedAt || conversation.updated_at || conversation.createdAt || conversation.created_at
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Groups conversations by calendar day: Today, Yesterday, Previous 7 Days, Older.
 * Order inside each group follows the input order, so pass them newest first.
 */
export function groupConversations(conversations, now = new Date()) {
  const today = startOfDay(now)
  const groups = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'Previous 7 Days', items: [] },
    { label: 'Older', items: [] },
  ]

  for (const conversation of conversations) {
    const time = conversationTime(conversation)
    const daysAgo = time === null ? Infinity : Math.round((today - startOfDay(new Date(time))) / DAY_MS)
    const index = daysAgo <= 0 ? 0 : daysAgo === 1 ? 1 : daysAgo <= 7 ? 2 : 3
    groups[index].items.push(conversation)
  }

  return groups.filter((group) => group.items.length > 0)
}

export function sortConversations(conversations) {
  return [...conversations].sort((first, second) => (conversationTime(second) ?? 0) - (conversationTime(first) ?? 0))
}

export function formatElapsed(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}
