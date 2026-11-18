/** Copies text. Falls back to execCommand where the async Clipboard API is unavailable (e.g. plain HTTP on a LAN IP). */
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the legacy path
  }

  const field = document.createElement('textarea')
  field.value = text
  field.setAttribute('readonly', '')
  field.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
  document.body.appendChild(field)
  field.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(field)
  }
}
