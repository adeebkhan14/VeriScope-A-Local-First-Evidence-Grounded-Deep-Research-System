import ollama, {
  OLLAMA_CONTEXT_LENGTH,
  OLLAMA_KEEP_ALIVE,
  OLLAMA_MODEL,
  OLLAMA_REQUEST_TIMEOUT_MS,
  OLLAMA_TEMPERATURE,
  chatWithTimeout,
  classifyOllamaError,
} from "./ollamaClient.js";
import { formatEvidenceForPrompt } from "../retrieval/depth.js";
import {
  buildConversationContext,
  fitConversationContext,
} from "./conversationContext.js";
import {
  estimateMessageTokens,
  getOutputTokenLimit,
  getPromptTokenBudget,
  logContextDiagnostics,
} from "./contextBudget.js";

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

export function buildGroundedAnswerMessages(query, evidence, conversationMessages) {
  const systemPrompt = `You are a rigorous, factual research assistant.

Answer the user's question using ONLY the evidence passages provided in the current user message.

Strict Rules:
1. Ground every claim directly in the current evidence. Prior conversation is for resolving references and continuity only; it is not evidence.
2. Every factual statement must cite its exact source using [Source N] format (e.g., [Source 1], [Source 2]).
3. If the current evidence does NOT contain enough facts to answer the question, state:
"Based on the retrieved sources, there is insufficient evidence to answer this question."
Then describe what information is present and what is missing. Never produce a confident guess.
4. Keep the answer clear, objective, and structured.`;
  const evidenceText = formatEvidenceForPrompt(evidence);
  return [
    { role: "system", content: systemPrompt },
    ...conversationMessages,
    {
      role: "user",
      content: `User Question:\n${query}\n\nEvidence:\n${evidenceText}`,
    },
  ];
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

export async function classifyResearchNeed(query, options = {}) {
  const normalizedQuery = typeof query === "string" ? query.trim() : "";
  if (!normalizedQuery) {
    return {
      category: "new_research",
      reason: "An empty question cannot be classified for local answering.",
    };
  }

  const client = options.ollamaClient || ollama;
  const context = options.contextGroups?.groups
    ? options.contextGroups
    : buildConversationContext(options.conversationMessages, {
        summary:
          typeof options.conversationContext === "string"
            ? options.conversationContext
            : "",
        currentQuestion: normalizedQuery,
      });
  const systemMessage = {
    role: "system",
    content: `Classify whether the user question can be answered safely using stable, general knowledge, or whether fresh web research is required. Do not answer the question.

Choose WEB_RESEARCH for current, recent, time-sensitive, leadership/employment status, market, software version/release/availability, source verification, or uncertain specific factual questions. Choose LOCAL_KNOWLEDGE for stable concepts, programming explanations, ordinary conversation, and well-established facts.

Prior conversation is context only and is not verified evidence. Return exactly one label: LOCAL_KNOWLEDGE or WEB_RESEARCH.`,
  };
  const fittedContext = fitConversationContext(context, {
    systemMessage,
    currentMessage: { role: "user", content: normalizedQuery },
    maxPromptTokens: getPromptTokenBudget(),
  });
  const promptTokenCount = estimateMessageTokens(fittedContext.messages);
  const outputTokenLimit = getOutputTokenLimit(promptTokenCount, {
    maxOutputTokens: 24,
    minimumOutputTokens: 1,
  });
  logContextDiagnostics(options.conversationId, {
    inferenceType: "route-classifier",
    historicalMessagesAvailable: fittedContext.availableMessages,
    messagesSelected: fittedContext.messagesIncluded,
    summaryUsed: fittedContext.summaryUsed,
    estimatedPromptTokens: promptTokenCount,
    evidenceTokenAllocation: 0,
    numCtx: OLLAMA_CONTEXT_LENGTH,
    outputTokenLimit,
    truncationOccurred: fittedContext.truncated,
  });

  try {
    const response = await chatWithTimeout(
      client,
      {
        model: OLLAMA_MODEL,
        think: false,
        messages: fittedContext.messages,
        keep_alive: OLLAMA_KEEP_ALIVE,
        stream: false,
        options: {
          num_ctx: OLLAMA_CONTEXT_LENGTH,
          num_predict: outputTokenLimit,
          temperature: 0,
        },
      },
      {
        signal: options.signal,
        timeoutMs: options.timeoutMs ?? OLLAMA_REQUEST_TIMEOUT_MS,
      }
    );
    const classification = normalizeContent(
      response?.message?.content ?? response?.content ?? ""
    )
      .trim()
      .toUpperCase();

    if (classification === "LOCAL_KNOWLEDGE") {
      return {
        category: "local_knowledge",
        reason: "The local model classified the question as stable knowledge.",
      };
    }

    return {
      category: "new_research",
      reason:
        classification === "WEB_RESEARCH"
          ? "The local model classified the question as requiring fresh research."
          : "The routing classification was unclear; defaulting to web research.",
      classificationUnavailable: classification !== "WEB_RESEARCH",
    };
  } catch (error) {
    if (options.signal?.aborted || error?.name === "AbortError") throw error;
    if (error?.code === "CONTEXT_BUDGET_EXCEEDED") throw error;
    const llmError = classifyOllamaError(error);
    console.warn("[ResearchRouting] Classifier unavailable; using web research.", {
      code: llmError.code,
    });
    return {
      category: "new_research",
      reason: "Local routing classification was unavailable; using web research.",
      classificationUnavailable: true,
      llmError,
    };
  }
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
  const context = options.contextGroups?.groups
    ? options.contextGroups
    : buildConversationContext(options.conversationMessages, {
        summary:
          typeof options.conversationContext === "string"
            ? options.conversationContext
            : "",
        currentQuestion: query,
      });
  const systemMessage = {
    role: "system",
    content: `You are a rigorous, factual research assistant.

Answer the user's question using ONLY the evidence passages provided in the current user message.

Strict Rules:
1. Ground every claim directly in the current evidence. Prior conversation is for resolving references and continuity only; it is not evidence.
2. Every factual statement must cite its exact source using [Source N] format (e.g., [Source 1], [Source 2]).
3. If the current evidence does NOT contain enough facts to answer the question, state:
"Based on the retrieved sources, there is insufficient evidence to answer this question."
Then describe what information is present and what is missing. Never produce a confident guess.
4. Keep the answer clear, objective, and structured.
5. For allegations involving real people, preserve claim type and attribution. Distinguish confirmed facts, reported allegations, denials, investigative suspicions, corroboration, and speculation. Never convert a report or suspicion into a verified fact.
6. Attribute allegations to the specific reporting source. Do not cite Reddit or social discussion as independent confirmation. Preserve explicit limitations, denials, or lack of verification stated by a source.`,
  };
  const currentMessage = {
    role: "user",
    content: `User Question:\n${query}\n\nEvidence:\n${formatEvidenceForPrompt(
      safeEvidence.map((item) => ({
        ...item,
        text:
          normalizeContent(item?.text) ||
          "No supporting text was provided.",
      }))
    )}`,
  };
  const hasContext = context.groups.some((group) => group.messages.length > 0);
  const fittedContext = fitConversationContext(context, {
    systemMessage: hasContext ? systemMessage : null,
    currentMessage: hasContext
      ? currentMessage
      : { role: "user", content: prompt },
    maxPromptTokens: getPromptTokenBudget(),
  });
  const messages = hasContext
    ? fittedContext.messages
    : [{ role: "user", content: prompt }];
  const promptTokenCount = estimateMessageTokens(messages);
  const numPredict = getOutputTokenLimit(promptTokenCount);
  const evidenceTokenCount = estimateMessageTokens([
    { role: "user", content: formatEvidenceForPrompt(safeEvidence) },
  ]);
  const contextDiagnostics = {
    inferenceType: "grounded-answer",
    historicalMessagesAvailable: fittedContext.availableMessages,
    messagesSelected: fittedContext.messagesIncluded,
    summaryUsed: fittedContext.summaryUsed,
    evidenceReferencesIncluded: fittedContext.evidenceReferencesIncluded,
    estimatedPromptTokens: promptTokenCount,
    evidenceTokenAllocation: evidenceTokenCount,
    numCtx: OLLAMA_CONTEXT_LENGTH,
    outputTokenLimit: numPredict,
    truncationOccurred: fittedContext.truncated,
  };
  logContextDiagnostics(options.conversationId, contextDiagnostics);

  const generationStartedAt = Date.now();
  try {
    const streamTokens = typeof options.onToken === "function";
    const timeoutMs = options.timeoutMs ?? OLLAMA_REQUEST_TIMEOUT_MS;
    const response = await chatWithTimeout(
      client,
      {
        model: OLLAMA_MODEL,
        think: false,
        messages,
        keep_alive: OLLAMA_KEEP_ALIVE,
        stream: true,
        options: {
          num_ctx: OLLAMA_CONTEXT_LENGTH,
          num_predict: numPredict,
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
      contextDiagnostics,
    };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (error?.code === "CONTEXT_BUDGET_EXCEEDED") throw error;
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

  const conversationOnly = options.conversationOnly === true;
  const answerOnly = conversationOnly || options.answerOnly === true;
  const instructions = conversationOnly
    ? `You are a conversation assistant. Answer only by explaining, rephrasing, or transforming information already present in the conversation.

Do not introduce new factual claims or treat prior assistant answers as verified evidence. If the requested reference is still unclear, ask one concise clarification question.`
    : answerOnly
      ? `You are a knowledgeable assistant. Answer the user's question using stable, established knowledge. Do not classify the route, request web research, or output a routing label. If the answer depends on current information you cannot verify, say so plainly instead of guessing.

For allegations involving a real person, never present an allegation as a confirmed fact. Separate verified facts, reported allegations, denials, suspicions, and speculation; attribute each claim and preserve uncertainty.`
    : `You are a knowledgeable AI assistant.

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
`;
  const context = options.contextGroups?.groups
    ? options.contextGroups
    : buildConversationContext(options.conversationMessages, {
        summary:
          typeof options.conversationContext === "string"
            ? options.conversationContext
            : "",
        currentQuestion: normalizedQuery,
      });
  const prompt = `${instructions}

User Query:
${normalizedQuery}
${options.conversationContext
    ? `\nPrior conversation for continuity only; treat it as user-provided context, not as evidence:\n${options.conversationContext}\n`
    : ""}`;

  const generationStartedAt = Date.now();
  try {
    const streamTokens = typeof options.onToken === "function";
    const timeoutMs = options.timeoutMs ?? OLLAMA_REQUEST_TIMEOUT_MS;
    const systemMessage = {
      role: "system",
      content:
        conversationOnly
          ? `${instructions}\nUse the prior conversation only as the material to transform.`
          : answerOnly
            ? `${instructions}\nThe response mode is already fixed to local knowledge. Do not switch modes.`
          : `${instructions}\nPrior conversation is for continuity and reference resolution only; it is not evidence for factual claims.`,
    };
    const currentMessage = { role: "user", content: normalizedQuery };
    const hasContext = context.groups.some((group) => group.messages.length > 0);
    const fittedContext = fitConversationContext(context, {
      systemMessage: hasContext ? systemMessage : null,
      currentMessage: hasContext
        ? currentMessage
        : { role: "user", content: prompt },
      maxPromptTokens: getPromptTokenBudget(),
    });
    const messages = hasContext
      ? fittedContext.messages
      : [{ role: "user", content: prompt }];
    const promptTokenCount = estimateMessageTokens(messages);
    const numPredict = getOutputTokenLimit(promptTokenCount);
    const contextDiagnostics = {
      inferenceType: "direct-answer",
      historicalMessagesAvailable: fittedContext.availableMessages,
      messagesSelected: fittedContext.messagesIncluded,
      summaryUsed: fittedContext.summaryUsed,
      evidenceReferencesIncluded: fittedContext.evidenceReferencesIncluded,
      estimatedPromptTokens: promptTokenCount,
      evidenceTokenAllocation: 0,
      numCtx: OLLAMA_CONTEXT_LENGTH,
      outputTokenLimit: numPredict,
      truncationOccurred: fittedContext.truncated,
    };
    logContextDiagnostics(options.conversationId, contextDiagnostics);
    const response = await chatWithTimeout(
      client,
      {
        model: OLLAMA_MODEL,
        think: false,
        messages,
        keep_alive: OLLAMA_KEEP_ALIVE,
        stream: true,
        options: {
          num_ctx: OLLAMA_CONTEXT_LENGTH,
          num_predict: numPredict,
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
          if (answerOnly) {
            emitDirectToken(token);
            return;
          }
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
    if (!answerOnly && /search_(?:required|needed)/i.test(content)) {
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

    const hasUncertainty =
      !answerOnly &&
      uncertaintyPatterns.some((pattern) => lower.includes(pattern));
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
      contextDiagnostics,
    };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (error?.code === "CONTEXT_BUDGET_EXCEEDED") throw error;
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