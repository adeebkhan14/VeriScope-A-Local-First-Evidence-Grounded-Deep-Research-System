const DEFAULT_PRESETS = {
  FAST: { topK: 5, evidenceTokenBudget: 2000 },
  NORMAL: { topK: 10, evidenceTokenBudget: 4000 },
  MAX: { topK: 20, evidenceTokenBudget: 5000 },
};

function readPositiveInteger(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

export const RESEARCH_DEPTH_PRESETS = Object.freeze(
  Object.fromEntries(
    Object.entries(DEFAULT_PRESETS).map(([depth, defaults]) => [
      depth,
      Object.freeze({
        topK: readPositiveInteger(`RESEARCH_${depth}_TOP_K`, defaults.topK),
        evidenceTokenBudget: readPositiveInteger(
          `RESEARCH_${depth}_EVIDENCE_TOKEN_BUDGET`,
          defaults.evidenceTokenBudget
        ),
      }),
    ])
  )
);

export function normalizeResearchSettings({
  depth = "NORMAL",
  alpha = 0.5,
} = {}) {
  const normalizedDepth =
    typeof depth === "string" ? depth.trim().toUpperCase() : "";
  const preset = RESEARCH_DEPTH_PRESETS[normalizedDepth];
  if (!preset) {
    const error = new Error("depth must be FAST, NORMAL, or MAX.");
    error.code = "INVALID_REQUEST";
    throw error;
  }

  const normalizedAlpha = Number(alpha);
  if (!Number.isFinite(normalizedAlpha) || normalizedAlpha < 0 || normalizedAlpha > 1) {
    const error = new Error("alpha must be a number between 0 and 1.");
    error.code = "INVALID_REQUEST";
    throw error;
  }

  return {
    depth: normalizedDepth,
    alpha: normalizedAlpha,
    topK: preset.topK,
    evidenceTokenBudget: preset.evidenceTokenBudget,
  };
}

export function estimateTokenCount(text) {
  return Math.ceil((typeof text === "string" ? text.length : 0) / 4);
}

export function formatEvidenceForPrompt(evidence) {
  return evidence
    .map((item, index) => {
      const id = item?.id ?? index + 1;
      const title = item?.title ?? "Untitled source";
      const url = item?.url ?? "Unknown URL";
      const text = typeof item?.text === "string" ? item.text : "";

      return `
[Source ${id}]
Title: ${title}
URL: ${url}

Evidence passage:
${text}
`;
    })
    .join("\n--------------------\n");
}

export function estimateEvidenceTokens(evidence) {
  return estimateTokenCount(formatEvidenceForPrompt(evidence));
}

export function selectEvidenceWithinBudget(candidates, topK, tokenBudget) {
  const selected = [];
  for (const candidate of candidates) {
    if (selected.length >= topK) break;
    const next = [...selected, candidate];
    if (estimateEvidenceTokens(next) <= tokenBudget) {
      selected.push(candidate);
    }
  }
  return selected;
}
