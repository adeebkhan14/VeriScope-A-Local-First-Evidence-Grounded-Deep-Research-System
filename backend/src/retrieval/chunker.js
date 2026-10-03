export function chunkText(text, options = {}) {
  const chunkSize = options.chunkSize || 1000;
  const overlap = options.overlap || 200;

  const chunks = [];

  let start = 0;

  while (start < text.length) {
    const end = Math.min(
      start + chunkSize,
      text.length
    );

    const chunk = text
      .slice(start, end)
      .trim();

    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    if (end === text.length) {
      break;
    }

    start = end - overlap;
  }

  return chunks;
}