export function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new RangeError("Vectors must have the same length");
  }

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    magnitudeA += a[i] ** 2;
    magnitudeB += b[i] ** 2;
  }

  const denominator = Math.sqrt(magnitudeA * magnitudeB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}
