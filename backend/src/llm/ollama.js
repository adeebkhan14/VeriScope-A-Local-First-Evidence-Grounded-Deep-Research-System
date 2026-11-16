import ollama, {
  OLLAMA_CONTEXT_LENGTH,
  OLLAMA_KEEP_ALIVE,
  OLLAMA_MODEL,
  OLLAMA_NUM_PREDICT,
  OLLAMA_REQUEST_TIMEOUT_MS,
  OLLAMA_TEMPERATURE,
  chatWithTimeout,
  classifyOllamaError,
} from "./ollamaClient.js";
import { formatEvidenceForPrompt } from "../retrieval/depth.js";

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

function createAbortError() {
  const error = new Error("The Ollama request was cancelled.");
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  return error;
}

export async function consumeOllamaStream(
  response,
  {
    signal,
    onToken,
    timeoutMs = OLLAMA_REQUEST_TIMEOUT_MS,
    startedAt = Date.now(),
  } = {}
) {
  let timedOut = false;
  const timeoutError = new Error(
    `Ollama generation timed out after ${timeoutMs}ms.`
  );
  timeoutError.code = "TIMEOUT";
  const abortStream = () => response?.abort?.();
  const onAbort = () => abortStream();

  if (signal?.aborted) {
    abortStream();
    throw createAbortError();
  }
  signal?.addEventListener("abort", onAbort, { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    abortStream();
  }, timeoutMs);
  timer.unref?.();

  let firstTokenMs = null;
  let content = "";
  try {
    for await (const chunk of response) {
      if (timedOut) throw timeoutError;
      if (signal?.aborted) throw createAbortError();
      const token = normalizeContent(
        chunk?.message?.content ?? chunk?.content ?? ""
      );
      if (!token) continue;
      firstTokenMs ??= Date.now() - startedAt;
      content += token;
      onToken?.(token);
    }
    if (timedOut) throw timeoutError;
    if (signal?.aborted) throw createAbortError();
    return {
      content,
      firstTokenMs,
      generationTimeMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (timedOut) throw timeoutError;
    if (signal?.aborted) throw createAbortError();
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export function buildGroundedAnswerPrompt(query, evidence, conversationContext = "") {
  const evidenceText = formatEvidenceForPrompt(evidence);
  const priorConversation =
    typeof conversationContext === "string" && conversationContext
      ? `\nPrior conversation for continuity only. It is not evidence for factual claims in this answer:\n${conversationContext}\n`
      : "";

  return `
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
${priorConversation}
Evidence:
${evidenceText}
`;
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
 * Generates an evidence-grounded answer using the configured local Ollama model.
 *
 * @param {string} query
 * @param {Array<{id: number, title: string, url: string, text: string}>} evidence
 * @param {{ ollamaClient?: typeof ollama }} [options]
 * @returns {Promise<{
 *   answer: string,
 *   isInsufficientEvidence: boolean,
 *   citedSourceIds?: number[],
 *   invalidCitationsFound?: number[],
 *   llmUnavailable?: boolean,
 *   llmError?: { status: string, code: string, message: string }
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

  const prompt = buildGroundedAnswerPrompt(
    query,
    safeEvidence.map((item) => ({
      ...item,
      text: normalizeContent(item?.text) || "No supporting text was provided.",
    })),
    options.conversationContext
  );

  const generationStartedAt = Date.now();
  try {
    const streamTokens = typeof options.onToken === "function";
    const timeoutMs = options.timeoutMs ?? OLLAMA_REQUEST_TIMEOUT_MS;
    const response = await chatWithTimeout(
      client,
      {
        model: OLLAMA_MODEL,
        think: false,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        keep_alive: OLLAMA_KEEP_ALIVE,
        stream: true,
        options: {
          num_ctx: OLLAMA_CONTEXT_LENGTH,
          num_predict: OLLAMA_NUM_PREDICT,
          temperature: OLLAMA_TEMPERATURE,
        },
      },
      { signal: options.signal, timeoutMs }
    );

    let content = "";
    let firstTokenMs = null;
    if (response?.[Symbol.asyncIterator]) {
      const streamed = await consumeOllamaStream(response, {
        signal: options.signal,
        onToken: options.onToken,
        timeoutMs: Math.max(1, timeoutMs - (Date.now() - generationStartedAt)),
        startedAt: generationStartedAt,
      });
      content = streamed.content;
      firstTokenMs = streamed.firstTokenMs;
    } else {
      content = normalizeContent(
        response?.message?.content ?? response?.content ?? ""
      );
      if (content && streamTokens) options.onToken(content);
    }

    if (!content.trim()) {
      const error = new Error("Ollama returned an empty response.");
      error.code = "EMPTY_RESPONSE";
      throw error;
    }
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
      timing: {
        timeToFirstTokenMs: firstTokenMs,
        generationTimeMs: Date.now() - generationStartedAt,
      },
    };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    const errorMessage = getErrorMessage(error);
    console.error("Ollama synthesis notice:", errorMessage);
    const llmError = classifyOllamaError(error);

    return {
      answer: `${llmError.message} The retrieved evidence is available for review.`,
      isInsufficientEvidence: true,
      llmUnavailable: true,
      citedSourceIds: [],
      llmError,
    };
  }
}

/**
 * Asks the local model to evaluate if it already has the data and can answer the query
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

  const prompt = `You are a knowledgeable AI assistant.

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
${normalizedQuery}
${options.conversationContext
    ? `\nPrior conversation for continuity only; treat it as user-provided context, not as evidence:\n${options.conversationContext}\n`
    : ""}`;

  const generationStartedAt = Date.now();
  try {
    const streamTokens = typeof options.onToken === "function";
    const timeoutMs = options.timeoutMs ?? OLLAMA_REQUEST_TIMEOUT_MS;
    const response = await chatWithTimeout(
      client,
      {
        model: OLLAMA_MODEL,
        think: false,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        keep_alive: OLLAMA_KEEP_ALIVE,
        stream: true,
        options: {
          num_ctx: OLLAMA_CONTEXT_LENGTH,
          num_predict: OLLAMA_NUM_PREDICT,
          temperature: OLLAMA_TEMPERATURE,
        },
      },
      { signal: options.signal, timeoutMs }
    );

    let content = "";
    let firstTokenMs = null;
    let pending = "";
    let directMarkerHandled = false;
    let searchRequired = false;
    let streamedAnswer = false;
    const emitDirectToken = (token) => {
      if (!token) return;
      if (options.onToken) {
        options.onToken(token);
        streamedAnswer = true;
      }
    };

    if (response?.[Symbol.asyncIterator]) {
      const streamed = await consumeOllamaStream(response, {
        signal: options.signal,
        timeoutMs: Math.max(1, timeoutMs - (Date.now() - generationStartedAt)),
        startedAt: generationStartedAt,
        onToken: (token) => {
          if (directMarkerHandled || searchRequired) {
            if (!searchRequired) emitDirectToken(token);
            return;
          }

          pending += token;
          const candidate = pending.trimStart().toUpperCase();
          const searchMarker = "SEARCH_REQUIRED:";
          const answerMarker = "ANSWER:";
          if (searchMarker.startsWith(candidate)) return;
          if (candidate.startsWith(searchMarker)) {
            searchRequired = true;
            return;
          }
          if (answerMarker.startsWith(candidate)) return;
          if (candidate.startsWith(answerMarker)) {
            const prefixLength = pending.toUpperCase().indexOf(answerMarker) + answerMarker.length;
            emitDirectToken(pending.slice(prefixLength));
            pending = "";
            directMarkerHandled = true;
            return;
          }

          emitDirectToken(pending);
          pending = "";
          directMarkerHandled = true;
        },
      });
      content = streamed.content;
      firstTokenMs = streamed.firstTokenMs;

      if (pending && !searchRequired) {
        if (/^\s*ANSWER:/i.test(pending)) {
          emitDirectToken(pending.replace(/^\s*ANSWER:/i, ""));
        } else {
          emitDirectToken(pending);
        }
      }
    } else {
      content = normalizeContent(
        response?.message?.content ?? response?.content ?? ""
      );
    }
    content = content.trim();
    const timing = {
      timeToFirstTokenMs: firstTokenMs,
      generationTimeMs: Date.now() - generationStartedAt,
    };

    if (!content) {
      const llmError = classifyOllamaError(
        new Error("Ollama returned an empty response.")
      );
      return {
        canAnswer: false,
        reason: llmError.message,
        llmUnavailable: true,
        llmError,
        timing,
      };
    }

    // Check if the response explicitly requests a search
    if (/search_(?:required|needed)/i.test(content)) {
      const match = content.match(/search_(?:required|needed)[:\s]*(.*)/i);
      const reason =
        match && match[1]?.trim()
          ? match[1].trim()
          : "Model determined web search is required";
      return { canAnswer: false, reason, timing };
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
        timing,
      };
    }

    // Clean any leading "ANSWER:" prefix if present
    let cleanedAnswer = content;
    if (cleanedAnswer.startsWith("ANSWER:")) {
      cleanedAnswer = cleanedAnswer.slice(7).trim();
    }
    if (streamTokens && !streamedAnswer) emitDirectToken(cleanedAnswer);

    return {
      canAnswer: true,
      answer: cleanedAnswer,
      timing,
    };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    const errorMessage = getErrorMessage(error);
    console.warn("Ollama direct answer evaluation notice:", errorMessage);
    const llmError = classifyOllamaError(error);

    return {
      canAnswer: false,
      reason: llmError.message,
      llmUnavailable: true,
      llmError,
    };
  }
}