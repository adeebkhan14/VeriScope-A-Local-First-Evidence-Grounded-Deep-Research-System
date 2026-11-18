/**
 * Reads the backend's server-sent-event response.
 *
 * Events (unchanged backend contract):
 *   status  { message }  progress text
 *   token   { text }     streamed answer text
 *   done    { result }   final research result
 *   error   { error, code?, service? }
 *
 * Resolves with the `done` result. Rejects on an `error` event, an aborted
 * request, or a stream that ends without a result.
 */
export async function readResearchStream(response, { onStatus, onToken } = {}) {
  if (!response.body) throw new Error('The research service returned an empty stream.')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result = null

  function handleFrame(frame) {
    let event = 'message'
    const data = []
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    }
    if (data.length === 0) return

    let payload
    try {
      payload = JSON.parse(data.join('\n'))
    } catch {
      return
    }

    if (event === 'status') onStatus?.(payload.message)
    else if (event === 'token') onToken?.(payload.text)
    else if (event === 'done') result = payload.result
    else if (event === 'error') {
      const error = new Error(payload.error || 'Research could not be completed.')
      error.code = payload.code
      error.service = payload.service
      throw error
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n')

      let frameEnd
      while ((frameEnd = buffer.indexOf('\n\n')) !== -1) {
        handleFrame(buffer.slice(0, frameEnd))
        buffer = buffer.slice(frameEnd + 2)
      }
      if (done) break
    }
    if (buffer.trim()) handleFrame(buffer)
  } catch (error) {
    reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }

  if (!result) throw new Error('The research stream ended before returning a result.')
  return result
}
