/*
  Research settings shared by the composer and the request payload.

  Alpha keeps the backend's convention (research.js):
      hybridScore = alpha * BM25 + (1 - alpha) * semantic
  slider and Semantic on the right, so the slider position is the semantic
  weight (1 - alpha). Only this mapping lives here; the request still sends alpha.
*/

export const DEFAULT_DEPTH = 'NORMAL'
export const DEFAULT_ALPHA = 0.5

export const RESEARCH_MODES = [
  { value: 'FAST', label: 'Fast', hint: 'Prioritise response speed' },
  { value: 'NORMAL', label: 'Normal', hint: 'Balanced research' },
  { value: 'MAX', label: 'Max', hint: 'Maximum research depth' },
]

export const isValidDepth = (value) => RESEARCH_MODES.some((mode) => mode.value === value)

/** Alpha moves in 0.1 steps between 0.1 and 0.9 (the range the slider offers). */
export const isValidAlpha = (value) =>
  typeof value === 'number' && value >= 0.1 && value <= 0.9 && Math.abs(value * 10 - Math.round(value * 10)) < 1e-9

export const alphaToSlider = (alpha) => Math.round((1 - alpha) * 10)
export const sliderToAlpha = (position) => Math.round(10 - position) / 10

/** Turns the backend's technical progress strings into short, readable status text. */
export function describeProgress(message) {
  if (typeof message !== 'string' || !message.trim()) return 'Working…'
  const text = message.trim()

  const pages = /^Scraping(?: \d+) pages?/i.test(text)
  if (pages) return 'Scraping pages…'
  if (/^Querying SearXNG/i.test(text)) return 'Searching the web…'
  if (/^Reranking/i.test(text)) return 'Ranking evidence…'
  if (/^Checking previous research/i.test(text)) return 'Checking earlier evidence…'
  if (/^Generating answer from previous/i.test(text)) return 'Writing answer from earlier evidence…'
  if (/^Generating answer/i.test(text)) return 'Writing answer…'
  if (/^Mapping claims/i.test(text)) return 'Linking claims to evidence…'
  if (/^Waiting for the local model/i.test(text)) return 'Waiting for the local model…'
  return text.replace(/\.{3}$/, '…')
}
