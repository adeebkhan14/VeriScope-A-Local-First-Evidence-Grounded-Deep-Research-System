export function buildEvidencePackage(query, results) {
  return {
    query,

    evidence: results.map((result, index) => ({
      id: index + 1,
      title: result.title,
      url: result.url,
      text: result.text,
      score: result.hybridScore,
    })),
  };
}