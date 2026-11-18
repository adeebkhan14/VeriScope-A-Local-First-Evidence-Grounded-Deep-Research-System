/*
  Inline citation handling.

  The backend asks the model to cite evidence as "[Source 3]" (and models
  sometimes write "[3]" or "[Source 1, 2]"). These helpers turn those markers
  into links to "#source-N" so the UI can render a chip and open the matching
  evidence card. The numeric identifier is never changed, and markers that do
  not match a known evidence number are left exactly as the model wrote them.
*/

const MARKER = /\[(?:Source\s*)?(\d+(?:\s*,\s*(?:Source\s*)?\d+)*)\]/gi

function isWordCharacter(character) {
  return typeof character === 'string' && /[\p{L}\p{N}]/u.test(character)
}

/**
 * Splits one text value into text and citation-link mdast nodes.
 * Returns null when nothing in it should change.
 */
export function splitCitationText(value, knownIds) {
  const pattern = new RegExp(MARKER.source, 'gi')
  const nodes = []
  let lastIndex = 0
  let match

  while ((match = pattern.exec(value)) !== null) {
    const ids = match[1].match(/\d+/g).map(Number)
    const hasSourceWord = /source/i.test(match[0])
    // A bare "[1]" directly after a word is more likely an array index than a citation.
    const startsLikeCitation = hasSourceWord || !isWordCharacter(value[match.index - 1])
    if (!startsLikeCitation || !ids.every((id) => knownIds.has(id))) continue

    if (match.index > lastIndex) {
      nodes.push({ type: 'text', value: value.slice(lastIndex, match.index) })
    }
    for (const id of ids) {
      nodes.push({
        type: 'link',
        url: `#source-${id}`,
        title: null,
        children: [{ type: 'text', value: String(id) }],
        data: { hProperties: { 'data-citation': String(id) } },
      })
    }
    lastIndex = match.index + match[0].length
  }

  if (nodes.length === 0) return null
  if (lastIndex < value.length) nodes.push({ type: 'text', value: value.slice(lastIndex) })
  return nodes
}

const SKIPPED_NODE_TYPES = new Set(['link', 'linkReference', 'image', 'imageReference', 'code', 'inlineCode', 'html'])

/** remark plugin: options.ids is the list of known evidence numbers. */
export function remarkCitations(options = {}) {
  const knownIds = new Set(options.ids ?? [])

  function visit(node) {
    if (!Array.isArray(node.children) || SKIPPED_NODE_TYPES.has(node.type)) return
    node.children = node.children.flatMap((child) => {
      if (child.type === 'text') return splitCitationText(child.value, knownIds) ?? [child]
      visit(child)
      return [child]
    })
  }

  return (tree) => {
    if (knownIds.size > 0) visit(tree)
  }
}

/** Evidence numbers that the answer text actually cites. */
export function findCitedIds(text, knownIds) {
  const cited = new Set()
  if (typeof text !== 'string' || knownIds.size === 0) return cited
  const pattern = new RegExp(MARKER.source, 'gi')
  let match
  while ((match = pattern.exec(text)) !== null) {
    const ids = match[1].match(/\d+/g).map(Number)
    const hasSourceWord = /source/i.test(match[0])
    if (!hasSourceWord && isWordCharacter(text[match.index - 1])) continue
    if (ids.every((id) => knownIds.has(id))) ids.forEach((id) => cited.add(id))
  }
  return cited
}
