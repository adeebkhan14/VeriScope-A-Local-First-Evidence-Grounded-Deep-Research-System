/**
 * Splits text into overlapping chunks of specified size.
 * Guarantees monotonic progression to prevent infinite loops even if overlap >= chunkSize.
 *
 * @param {string} text
 * @param {{ chunkSize?: number, overlap?: number }} [options]
 * @returns {string[]}
 */
export function chunkText(text, options = {}) {
  if (typeof text !== "string" || !text.trim()) {
    return [];
  }

  const chunkSize = Math.max(50, options.chunkSize || 1000);
  const overlap = Math.max(0, Math.min(options.overlap ?? 200, chunkSize - 1));

  const chunks = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const chunk = text.slice(start, end).trim();

    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    if (end >= text.length) {
      break;
    }

    const nextStart = end - overlap;
    start = nextStart > start ? nextStart : end;
  }

  return chunks;
}