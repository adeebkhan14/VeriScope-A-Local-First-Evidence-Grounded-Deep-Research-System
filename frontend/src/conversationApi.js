async function getErrorMessage(response, fallback) {
  let body
  try {
    body = await response.json()
  } catch {
    body = null
  }
  return body?.message || body?.error || `${fallback} (HTTP ${response.status}).`
}

async function requestJson(url, options, fallback) {
  const response = await fetch(url, options)
  if (!response.ok) {
    const error = new Error(await getErrorMessage(response, fallback))
    error.status = response.status
    throw error
  }
  return response.json()
}

export function listConversations({ signal } = {}) {
  return requestJson(
    '/api/conversations',
    { cache: 'no-store', signal },
    'Conversations could not be loaded'
  )
}

export function getConversation(conversationId, { signal } = {}) {
  return requestJson(
    `/api/conversations/${encodeURIComponent(conversationId)}`,
    { cache: 'no-store', signal },
    'Conversation could not be loaded'
  )
}

export function deleteConversation(conversationId, { signal } = {}) {
  return requestJson(
    `/api/conversations/${encodeURIComponent(conversationId)}`,
    { method: 'DELETE', signal },
    'Conversation could not be deleted'
  )
}

export async function sendConversationMessage(conversationId, payload, signal) {
  const response = await fetch(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(payload),
    }
  )
  if (!response.ok) {
    const error = new Error(await getErrorMessage(response, 'Message could not be sent'))
    error.status = response.status
    throw error
  }
  return response
}

export async function startConversationResearch(payload, signal) {
  const response = await fetch('/api/search', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const error = new Error(await getErrorMessage(response, 'Research could not be started'))
    error.status = response.status
    throw error
  }
  return response
}
