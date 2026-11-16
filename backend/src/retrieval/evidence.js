/**
 * Builds the evidence package provided to the local model and formatted for the frontend.
 *
 * @param {string} query
 * @param {Array<{id?: number, title?: string, url?: string, text: string, hybridScore?: number}>} results
 * @returns {{query: string, evidence: Array<{id: number, chunkId: number|null, title: string, sourceTitle: string|null, url?: string, text: string, score: number}>}}
 */
export function buildEvidencePackage(query, results) {
  return {
    query,
    evidence: results.map((result, index) => ({
      id: index + 1,
      chunkId: Number.isInteger(result.id) ? result.id : null,
      title: result.title || "Web Source",
      sourceTitle:
        typeof result.title === "string" && result.title.trim()
          ? result.title.trim()
          : null,
      url: result.url,
      text: result.text.trim(),
      score: typeof result.hybridScore === "number" ? Number(result.hybridScore.toFixed(4)) : 0,
    })),
  };
}