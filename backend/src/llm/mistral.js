import ollama from "ollama";

function normalizeContent(value) {
  if (typeof value === "string") return value;

  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object") {
          return normalizeContent(entry.text ?? entry.content ?? entry.value ?? "");
        }
        return "";
      })
      .join(" ");
  }

  if (value && typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (typeof value.content === "string") return value.content;
    if (typeof value.message === "string") return value.message;
  }

  return "";
}

function getErrorMessage(error) {
  if (typeof error?.message === "string") return error.message;
  if (typeof error === "string") return error;
  return "Unknown Ollama error";
}

/**
 * Checks if the generated response indicates insufficient evidence.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function checkIfInsufficientEvidence(text) {
  const normalized = normalizeContent(text);
  if (!normalized) return true;

  const lower = normalized.toLowerCase();
  const patterns = [
    "insufficient evidence",
    "not enough information",
    "does not contain enough information",
    "evidence does not provide",
    "cannot be answered based on the provided evidence",
    "provided evidence does not contain",
    "no evidence provided",
    "evidence is insufficient",
    "provided sources do not mention",
    "provided sources do not contain",
  ];

  return patterns.some((p) => lower.includes(p));
}

/**
 * Validates that all [Source N] citations in the generated answer map to actual
 * evidence IDs provided to the model. Filters out hallucinated or invented citations.
 *
 * @param {string} answer
 * @param {Set<number> | Array<number>} validEvidenceIds
 * @returns {{ sanitizedAnswer: string, validCitations: number[], invalidCitations: number[] }}
 */
export function validateAndSanitizeCitations(answer, validEvidenceIds) {
  if (typeof answer !== "string") {
    return { sanitizedAnswer: "", validCitations: [], invalidCitations: [] };
  }

  const validSet =
    validEvidenceIds instanceof Set
      ? validEvidenceIds
      : new Set(validEvidenceIds);

  const validCitations = new Set();
  const invalidCitations = new Set();

  // Pattern matches [Source 1], [Source 1, 2], [1], etc.
  const citationRegex = /\[(?:Source\s*)?(\d+)(?:\s*,\s*(?:Source\s*)?(\d+))*\]/gi;

  const sanitizedAnswer = answer.replace(citationRegex, (fullMatch) => {
    const ids = fullMatch.match(/\d+/g);
    if (!ids) return fullMatch;

    const validIdsForMatch = [];
    for (const idStr of ids) {
      const id = parseInt(idStr, 10);
      if (validSet.has(id)) {
        validIdsForMatch.push(id);
        validCitations.add(id);
      } else {
        invalidCitations.add(id);
        console.warn(
          `[Grounding] Filtered hallucinated citation [Source ${id}] not present in retrieved evidence`
        );
      }
    }

    if (validIdsForMatch.length === 0) {
      return "";
    }

    return validIdsForMatch.map((id) => `[Source ${id}]`).join(" ");
  });

  return {
    sanitizedAnswer: sanitizedAnswer.replace(/\s{2,}/g, " ").trim(),
    validCitations: Array.from(validCitations),
    invalidCitations: Array.from(invalidCitations),
  };
}

/**
 * Generates an evidence-grounded answer using local Mistral via Ollama.
 *
 * @param {string} query
 * @param {Array<{id: number, title: string, url: string, text: string}>} evidence
 * @param {{ ollamaClient?: typeof ollama }} [options]
 * @returns {Promise<{
 *   answer: string,
 *   isInsufficientEvidence: boolean,
 *   citedSourceIds?: number[],
 *   invalidCitationsFound?: number[],
 *   llmUnavailable?: boolean
 * }>}
 */
export async function generateAnswer(query, evidence, options = {}) {
  const safeEvidence = Array.isArray(evidence) ? evidence.filter(Boolean) : [];

  if (safeEvidence.length === 0) {
    return {
      answer:
        "Based on the retrieved sources, there is insufficient evidence to answer this question. No relevant evidence passages were found.",
      isInsufficientEvidence: true,
      citedSourceIds: [],
    };
  }

  const client = options.ollamaClient || ollama;

  const evidenceText = safeEvidence
    .map((item) => {
      const id = item?.id ?? "?";
      const title = item?.title ?? "Untitled source";
      const url = item?.url ?? "Unknown URL";
      const text = normalizeContent(item?.text) || "No supporting text was provided.";

      return `
[Source ${id}]
Title: ${title}
URL: ${url}

Evidence passage:
${text}
`;
    })
    .join("\n--------------------\n");

  const prompt = `
You are a rigorous, factual research assistant.

Answer the user's question using ONLY the evidence passages provided below.

Strict Rules:
1. Ground every claim directly in the evidence. Do not use outside knowledge or make ungrounded inferences.
2. Every factual statement must cite its exact source using [Source N] format (e.g., [Source 1], [Source 2]).
3. If the provided evidence does NOT contain enough facts to answer the question, state:
"Based on the retrieved sources, there is insufficient evidence to answer this question."
Then describe what information is present and what is missing. Never produce a confident guess.
4. Keep the answer clear, objective, and structured.

User Question:
${query}

Evidence:
${evidenceText}
`;

  try {
    const response = await client.chat({
      model: "mistral",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      keep_alive: "15m",
      options: {
        num_predict: 350,
        temperature: 0.15, // Low temperature for high factual adherence
      },
    });

    const content = normalizeContent(response?.message?.content ?? response?.content ?? "");
    const isInsufficient = checkIfInsufficientEvidence(content);

    // Validate citations against actually supplied evidence IDs
    const validEvidenceIds = new Set(safeEvidence.map((e) => e.id));
    const { sanitizedAnswer, validCitations, invalidCitations } = validateAndSanitizeCitations(
      content,
      validEvidenceIds
    );

    return {
      answer: sanitizedAnswer,
      isInsufficientEvidence: isInsufficient,
      citedSourceIds: validCitations,
      invalidCitationsFound: invalidCitations.length > 0 ? invalidCitations : undefined,
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    console.error("Ollama synthesis notice:", errorMessage);

    const lower = errorMessage.toLowerCase();

    if (
      error?.code === "ECONNREFUSED" ||
      lower.includes("econnrefused") ||
      lower.includes("connect") ||
      lower.includes("timeout") ||
      lower.includes("fetch failed") ||
      lower.includes("socket hang up")
    ) {
      return {
        answer:
          "The local Ollama service is not running on http://localhost:11434. The relevant sources and evidence passages were retrieved and are shown below. Run 'ollama serve' in your terminal to enable local AI synthesis.",
        isInsufficientEvidence: true,
        llmUnavailable: true,
        citedSourceIds: [],
      };
    }

    if (lower.includes("not found") || lower.includes("model not found") || lower.includes("404")) {
      return {
        answer:
          "The Mistral model was not found in Ollama. Please run 'ollama run mistral' to download the model.",
        isInsufficientEvidence: true,
        llmUnavailable: true,
        citedSourceIds: [],
      };
    }

    return {
      answer:
        "The local Ollama service could not generate a grounded answer at this time. The retrieved evidence is available for review, but the model is unavailable or failed to respond.",
      isInsufficientEvidence: true,
      llmUnavailable: true,
      citedSourceIds: [],
    };
  }
}

/**
 * Asks local Mistral to evaluate if it already has the data and can answer the query
 * directly (for less knowledge-intensive questions, conceptual explanations, coding,
 * math, general established facts), or if an up-to-date web search is needed.
 *
 * @param {string} query
 * @returns {Promise<{
 *   canAnswer: boolean,
 *   answer?: string,
 *   reason?: string,
 *   llmUnavailable?: boolean
 * }>}
 */
export async function tryDirectAnswer(query, options = {}) {
  const normalizedQuery = typeof query === "string" ? query.trim() : "";
  if (!normalizedQuery) {
    return { canAnswer: false, reason: "Empty query provided" };
  }

  const client = options.ollamaClient || ollama;

  const prompt = `You are Mistral, a knowledgeable AI assistant.

Analyze the user's query and decide whether you can provide a reliable, complete, and accurate answer directly from your existing internal knowledge, OR if an up-to-date web search is needed.

A web search IS REQUIRED if:
1. The query asks for real-time, live, current, or time-sensitive data (e.g. today's news, current weather, live sports scores, current stock prices, exchange rates).
2. The query asks about recent events, recent releases, or developments that occurred recently or after your knowledge cutoff.
3. The query asks for specific live URLs, external source citations, or deep verification of obscure/niche facts that you are not confident about.
4. You do not possess sufficient, reliable knowledge to answer completely and accurately.

A web search is NOT required (you should answer directly) if:
1. The question is less knowledge-intensive, such as conceptual explanations, definitions, logic, mathematics, coding/programming, syntax, standard algorithms, or language translations.
2. The question asks about well-established scientific, historical, technical, or general knowledge that you know thoroughly.
3. Common reasoning, writing, brainstorming, or analysis.

INSTRUCTIONS:
- If a web search IS REQUIRED or you are unsure of the facts, reply with EXACTLY this format:
SEARCH_REQUIRED: <brief explanation of what recent or specific information is needed>

- If you ALREADY HAVE the data and can answer accurately and thoroughly without web search, provide your direct, helpful, and comprehensive answer now. Do NOT include "SEARCH_REQUIRED".

User Query:
${normalizedQuery}`;

  try {
    const response = await client.chat({
      model: "mistral",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      keep_alive: "15m",
      options: {
        num_predict: 800,
        temperature: 0.15,
      },
    });

    const content = normalizeContent(
      response?.message?.content ?? response?.content ?? ""
    ).trim();

    if (!content) {
      return { canAnswer: false, reason: "Empty response from local model" };
    }

    // Check if the response explicitly requests a search
    if (/search_(?:required|needed)/i.test(content)) {
      const match = content.match(/search_(?:required|needed)[:\s]*(.*)/i);
      const reason =
        match && match[1]?.trim()
          ? match[1].trim()
          : "Model determined web search is required";
      return { canAnswer: false, reason };
    }

    // Check for phrases indicating outdated knowledge, cutoff limitations, or uncertainty
    const lower = content.toLowerCase();
    const uncertaintyPatterns = [
      "as of my last update",
      "as of my knowledge cutoff",
      "my knowledge cutoff",
      "as of my last training",
      "i do not have access to real-time",
      "i don't have access to real-time",
      "i do not have access to current",
      "i don't have access to current",
      "cannot provide real-time",
      "do not have access to the internet",
      "don't have access to the internet",
      "recommend checking a reliable news source",
      "check a reliable source",
      "check a reliable news source",
      "i do not have sufficient information",
      "i don't have sufficient information",
      "insufficient knowledge",
      "cannot answer this question based on my",
      "i am not certain",
      "i do not know the answer",
      "i don't know the answer",
    ];

    const hasUncertainty = uncertaintyPatterns.some((pattern) =>
      lower.includes(pattern)
    );
    if (hasUncertainty) {
      return {
        canAnswer: false,
        reason: "Model indicated lack of real-time knowledge or uncertainty",
      };
    }

    // Clean any leading "ANSWER:" prefix if present
    let cleanedAnswer = content;
    if (cleanedAnswer.startsWith("ANSWER:")) {
      cleanedAnswer = cleanedAnswer.slice(7).trim();
    }

    return {
      canAnswer: true,
      answer: cleanedAnswer,
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    console.warn("Ollama direct answer evaluation notice:", errorMessage);

    return {
      canAnswer: false,
      reason: "Ollama unavailable or errored",
      llmUnavailable: true,
    };
  }
}