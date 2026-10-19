/**
 * Builds the evidence package provided to Mistral and formatted for the frontend.
 *
 * @param {string} query
 * @param {Array<{title: string, url: string, text: string, hybridScore?: number}>} results
 * @returns {{query: string, evidence: Array<{id: number, title: string, url: string, text: string, score: number}>}}
 */
export function buildEvidencePackage(query, results) {
  return {
    query,
    evidence: results.map((result, index) => ({
      id: index + 1,
      title: result.title || "Web Source",
      url: result.url,
      text: result.text.trim(),
      score: typeof result.hybridScore === "number" ? Number(result.hybridScore.toFixed(4)) : 0,
    })),
  };
}