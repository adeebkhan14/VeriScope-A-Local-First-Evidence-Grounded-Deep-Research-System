import {
  OLLAMA_CONTEXT_LENGTH,
  OLLAMA_KEEP_ALIVE,
  OLLAMA_MODEL,
  OLLAMA_REQUEST_TIMEOUT_MS,
  OLLAMA_TEMPERATURE,
  chatWithTimeout,
  classifyOllamaError,
} from "./ollamaClient.js";
import ollama from "./ollamaClient.js";
import {
  buildConversationContext,
  fitConversationContext,
} from "./conversationContext.js";
import {
  estimateMessageTokens,
  getOutputTokenLimit,
  getPromptTokenBudget,
} from "./contextBudget.js";

const STOP_WORDS = new Set([
  "about", "after", "again", "also", "and", "are", "because", "before",
  "between", "could", "does", "from", "give", "have", "into", "more",
  "other", "please", "that", "their", "there", "these", "this", "those",
  "what", "when", "where", "which", "with", "would", "your", "its",
]);

const REFERENTIAL_PATTERN =
  /\b(?:it|its|they|them|their|this|that|these|those|there|same|previous|earlier|above)\b/i;
const FRESH_RESEARCH_PATTERN =
  /\b(?:current|currently|latest|today|live|real[- ]time|recent(?:ly)?|as of now|this week|this month|breaking|web search|search(?: the web)?|look up|research again|verify|fact[- ]?check)\b/i;
const FIND_SOURCES_PATTERN =
  /\bfind (?:new|more|reliable|credible|current)?\s*(?:sources?|evidence|references?|citations?)\b/i;
const LEADERSHIP_ROLE_PATTERN =
  /\b(?:ceo|chief executive|president|chair(?:man|woman|person)?|leader|leadership|executive|employer|employment|position)\b/i;
const LEADERSHIP_CHANGE_PATTERN =
  /\b(?:step(?:ped)? down|resign(?:ed|ation)?|appoint(?:ed|ment)?|named|replace(?:d|ment)?|retir(?:e|ed|ement)|left|leav(?:e|ing)|join(?:ed)?|became|elect(?:ed|ion))\b/i;
const CURRENT_LEADER_QUESTION_PATTERN =
  /\b(?:who\s+(?:is|are|runs|leads)|who's|still|remain(?:s)?|serves as|works? at|employed at|job status)\b/i;
const EMPLOYMENT_STATUS_PATTERN =
  /\b(?:still (?:employed|working|at|with)|currently employed|currently working|works? (?:at|for)|working (?:at|for)|employed (?:at|by)|left (?:the )?company|employment status)\b/i;
const DYNAMIC_MARKET_PATTERN =
  /\b(?:stock price|share price|market price|price of|how much (?:is|does|are)|cost of|market cap|trading at|exchange rate|crypto price|bitcoin price|market conditions?|market performance|stock rankings?|share rankings?)\b/i;
const DYNAMIC_METRIC_PATTERN =
  /^(?:what|which|who|where|how many|how much)\b.{0,100}\b(?:statistics|statistic|rank(?:ed|ing)?|GDP|population|inflation rate|unemployment rate|market share|revenue|sales numbers)\b/i;
const SOFTWARE_STATUS_PATTERN =
  /\b(?:what|which)\s+(?:is\s+)?(?:the\s+)?(?:current\s+|latest\s+|newest\s+)?version\s+of\b|\b(?:is|are)\b.{1,60}\b(?:available|released)\b|\bwhen\b.{1,60}\breleased?\b/i;
const EVIDENCE_FOLLOWUP_PATTERN =
  /\b(?:according to|based on|what did .* (?:study|paper|report|source)|(?:study|paper|report|source)s?|announcements?|just researched|findings|results|limitations?|drawbacks?|risks?|benefits?|effects?|impact|example|examples|trade[- ]offs?)\b/i;
const TRANSFORMATION_PATTERN =
  /\b(?:rephrase|rewrite|simplify|simpler terms|more simply|plain language|put (?:it|that|this) simply|summari[sz]e|shorten|translate|bullet points|format as)\b/i;
const LOCAL_KNOWLEDGE_PATTERN =
  /^(?:please\s+)?(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|thanks|thank\s+you|explain|define|describe|how\s+(?:do|does|is|can)|why\s+(?:do|does|is|are)|what(?:'s|\s+is|\s+are|\s+does|\s+do|\s+can)\b|difference\s+between|compare|tell\s+me\s+a\s+joke|(?:a\s+)?joke\b|write\b|help\s+me\b|can\s+you\b)\b/i;

function requiresFreshResearch(question) {
  const asksCurrentLeader =
    LEADERSHIP_ROLE_PATTERN.test(question) &&
    CURRENT_LEADER_QUESTION_PATTERN.test(question);
  const reportsLeadershipChange =
    LEADERSHIP_CHANGE_PATTERN.test(question) &&
    LEADERSHIP_ROLE_PATTERN.test(question);
  const asksLeadershipChange =
    LEADERSHIP_CHANGE_PATTERN.test(question) &&
    /^(?:did|has|have|was|were|when|who|is|are)\b/i.test(question);

  return (
    FRESH_RESEARCH_PATTERN.test(question) ||
    FIND_SOURCES_PATTERN.test(question) ||
    asksCurrentLeader ||
    reportsLeadershipChange ||
    asksLeadershipChange ||
    EMPLOYMENT_STATUS_PATTERN.test(question) ||
    DYNAMIC_MARKET_PATTERN.test(question) ||
    DYNAMIC_METRIC_PATTERN.test(question) ||
    SOFTWARE_STATUS_PATTERN.test(question)
  );
}

function completedExchanges(messages) {
  const exchanges = [];
  let pendingUser = null;
  for (const message of Array.isArray(messages) ? messages : []) {
    if (
      !message ||
      (message.role !== "user" && message.role !== "assistant") ||
      (message.status && message.status !== "completed") ||
      typeof message.content !== "string" ||
      !message.content.trim()
    ) {
      continue;
    }

    if (message.role === "user") {
      pendingUser = message;
    } else if (pendingUser) {
      exchanges.push([pendingUser, message]);
      pendingUser = null;
    }
  }
  return exchanges;
}

function termsIn(text) {
  return new Set(
    (String(text || "").toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])
      .filter((term) => !STOP_WORDS.has(term))
  );
}

function normalizeHistoricalEvidence(assistantMessage) {
  const seenIds = new Set();
  return (Array.isArray(assistantMessage?.evidenceReferences)
    ? assistantMessage.evidenceReferences
    : []
  )
    .filter((reference) => {
      if (
        !Number.isInteger(reference?.sourceId) ||
        reference.sourceId < 1 ||
        typeof reference.snippet !== "string" ||
        !reference.snippet.trim() ||
        typeof reference.url !== "string"
      ) {
        return false;
      }
      try {
        const url = new URL(reference.url);
        if (url.protocol !== "http:" && url.protocol !== "https:") return false;
      } catch {
        return false;
      }
      if (seenIds.has(reference.sourceId)) return false;
      seenIds.add(reference.sourceId);
      return true;
    })
    .map((reference) => ({
      id: reference.sourceId,
      chunkId: Number.isInteger(reference.chunkId) ? reference.chunkId : null,
      title:
        typeof reference.title === "string" && reference.title.trim()
          ? reference.title.trim()
          : "Previous research source",
      sourceTitle:
        typeof reference.title === "string" && reference.title.trim()
          ? reference.title.trim()
          : null,
      url: reference.url,
      text: reference.snippet.trim(),
      score: null,
    }));
}

function latestCompletedUserQuestion(exchanges) {
  return exchanges.at(-1)?.[0]?.content.trim() || "";
}

function resolveSearchQuery(question, previousQuestion) {
  if (!previousQuestion) return question;
  const isFollowup =
    REFERENTIAL_PATTERN.test(question) ||
    EVIDENCE_FOLLOWUP_PATTERN.test(question) ||
    question.trim().split(/\s+/).length <= 6;
  return isFollowup
    ? `${previousQuestion}\nFollow-up question: ${question}`
    : question;
}

function findLatestEvidenceSet(exchanges, currentQuestion) {
  const questionTerms = termsIn(currentQuestion);
  const candidates = [];

  exchanges.forEach(([userMessage, assistantMessage], exchangeIndex) => {
    const allEvidence = normalizeHistoricalEvidence(assistantMessage);
    if (allEvidence.length === 0) return;

    const topicTerms = termsIn(userMessage.content);
    const rankedEvidence = allEvidence.map((item, index) => {
      const evidenceTerms = termsIn(
        `${item.title} ${item.url} ${item.text}`
      );
      const currentOverlap = [...questionTerms].filter((term) =>
        evidenceTerms.has(term)
      ).length;
      const topicOverlap = [...topicTerms].filter((term) =>
        evidenceTerms.has(term)
      ).length;
      return {
        item,
        index,
        currentOverlap,
        topicOverlap,
        score: currentOverlap * 3 + topicOverlap,
      };
    });
    const currentMatches = rankedEvidence.filter(
      (candidate) => candidate.currentOverlap > 0
    );
    const topicMatches = rankedEvidence.filter(
      (candidate) => candidate.topicOverlap > 0
    );
    const selectedEvidence = currentMatches.length
      ? currentMatches
      : topicMatches.length
        ? topicMatches
        : rankedEvidence;
    selectedEvidence.sort(
      (first, second) =>
        second.score - first.score || first.index - second.index
    );
    const evidence = selectedEvidence.map(({ item }) => item);
    const overlap = Math.max(
      ...rankedEvidence.map(
        (candidate) => candidate.currentOverlap + candidate.topicOverlap
      )
    );
    const latestBonus = exchangeIndex === exchanges.length - 1 ? 1 : 0;
    candidates.push({
      sourceQuestion: userMessage.content.trim(),
      evidence,
      score: overlap + latestBonus,
      exchangeIndex,
    });
  });

  candidates.sort(
    (first, second) =>
      second.score - first.score || second.exchangeIndex - first.exchangeIndex
  );
  return candidates[0] || null;
}

function isUnresolvedReference(question, hasHistory) {
  if (hasHistory || !REFERENTIAL_PATTERN.test(question)) return false;
  const words = question.trim().split(/\s+/);
  return words.length <= 8 && /^(?:what|how|why|where|when|can|does|do|is|are)\b/i.test(question);
}

export function routeResearchQuery(
  question,
  { conversation = [], forceWebSearch = false } = {}
) {
  const currentQuestion = typeof question === "string" ? question.trim() : "";
  const exchanges = completedExchanges(conversation);
  const latestQuestion = latestCompletedUserQuestion(exchanges);
  const evidenceSet = findLatestEvidenceSet(exchanges, currentQuestion);
  const searchQuery = resolveSearchQuery(
    currentQuestion,
    evidenceSet?.sourceQuestion || latestQuestion
  );

  if (
    forceWebSearch ||
    requiresFreshResearch(currentQuestion)
  ) {
    return {
      category: "new_research",
      reason: forceWebSearch
        ? "Web research was explicitly requested."
        : "The question asks for current or freshly verified information.",
      searchQuery,
      sourceQuestion: evidenceSet?.sourceQuestion || latestQuestion,
    };
  }

  if (isUnresolvedReference(currentQuestion, exchanges.length > 0)) {
    return {
      category: "ambiguous",
      reason: "The question refers to a topic that is not present in this conversation.",
      clarification:
        "What topic or earlier answer are you referring to?",
      searchQuery: currentQuestion,
      sourceQuestion: "",
    };
  }

  if (
    exchanges.length > 0 &&
    TRANSFORMATION_PATTERN.test(currentQuestion)
  ) {
    return {
      category: "conversation_only",
      reason: "The request only reformats or clarifies prior conversation content.",
      searchQuery,
      sourceQuestion: latestQuestion,
    };
  }

  if (
    evidenceSet &&
    (REFERENTIAL_PATTERN.test(currentQuestion) ||
      EVIDENCE_FOLLOWUP_PATTERN.test(currentQuestion))
  ) {
    return {
      category: "existing_evidence",
      reason: "The follow-up refers to a prior research answer with stored source passages.",
      searchQuery: resolveSearchQuery(currentQuestion, evidenceSet.sourceQuestion),
      sourceQuestion: evidenceSet.sourceQuestion,
      evidence: evidenceSet.evidence,
    };
  }

  if (LOCAL_KNOWLEDGE_PATTERN.test(currentQuestion)) {
    return {
      category: "local_knowledge",
      reason: "The question asks for a stable explanation or ordinary local response.",
      searchQuery,
      sourceQuestion: latestQuestion,
    };
  }

  return {
    category: "model_decision",
    reason: "Deterministic rules did not identify a safe route.",
    searchQuery,
    sourceQuestion: evidenceSet?.sourceQuestion || latestQuestion,
  };
}

function normalizedModelText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((entry) =>
      typeof entry === "string"
        ? entry
        : entry?.text ?? entry?.content ?? entry?.value ?? ""
    ).join(" ");
  }
  if (value && typeof value === "object") {
    return value.text ?? value.content ?? value.message?.content ?? "";
  }
  return "";
}

function parseRouterJson(text) {
  const cleaned = normalizedModelText(text)
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function selectRelevantHistoricalEvidence(conversation, question, limit = 4) {
  const exchanges = completedExchanges(conversation);
  const questionTerms = termsIn(question);
  const candidates = [];

  exchanges.forEach(([userMessage, assistantMessage], exchangeIndex) => {
    normalizeHistoricalEvidence(assistantMessage).forEach((item, evidenceIndex) => {
      const evidenceTerms = termsIn(`${item.title} ${item.url} ${item.text}`);
      const overlap = [...questionTerms].filter((term) => evidenceTerms.has(term)).length;
      const topicOverlap = [...termsIn(userMessage.content)].filter((term) =>
        evidenceTerms.has(term)
      ).length;
      candidates.push({
        item,
        score: overlap * 4 + topicOverlap * 2 + (exchangeIndex === exchanges.length - 1 ? 1 : 0),
        overlap,
        exchangeIndex,
        evidenceIndex,
      });
    });
  });

  candidates.sort(
    (first, second) =>
      second.score - first.score ||
      second.exchangeIndex - first.exchangeIndex ||
      first.evidenceIndex - second.evidenceIndex
  );
  return candidates
    .filter((candidate) => candidate.overlap > 0)
    .slice(0, limit)
    .map(({ item }) => item);
}

function withRouteMetadata(base, fields) {
  return {
    ...base,
    originalQuery: fields.originalQuery,
    resolvedQuery: fields.resolvedQuery,
    route: fields.route,
    isFollowUp: fields.isFollowUp,
    requiresFreshEvidence: fields.requiresFreshEvidence,
    reusePreviousEvidence: fields.reusePreviousEvidence,
  };
}

/**
 * Per-turn intelligent routing. Deterministic rules remain authoritative for
 * forced web search and explicit time-sensitive information. Qwen resolves
 * follow-ups and validates ambiguous/relevant cases with a short JSON decision.
 */
export async function decideResearchRoute(
  question,
  { conversation = [], forceWebSearch = false, ollamaClient, signal, timeoutMs } = {}
) {
  const originalQuery = typeof question === "string" ? question.trim() : "";
  const deterministic = routeResearchQuery(originalQuery, {
    conversation,
    forceWebSearch,
  });
  const exchanges = completedExchanges(conversation);
  const evidenceSet = findLatestEvidenceSet(exchanges, originalQuery);
  const relevantEvidence = selectRelevantHistoricalEvidence(conversation, originalQuery);
  const deterministicResolved =
    deterministic.searchQuery && deterministic.searchQuery !== originalQuery
      ? deterministic.searchQuery
      : originalQuery;

  if (forceWebSearch) {
    return withRouteMetadata(deterministic, {
      originalQuery,
      resolvedQuery: deterministicResolved,
      route: "WEB",
      isFollowUp: exchanges.length > 0,
      requiresFreshEvidence: true,
      reusePreviousEvidence: false,
    });
  }

  if (requiresFreshResearch(originalQuery)) {
    return withRouteMetadata({
      ...deterministic,
      category: "new_research",
      reason: "Fresh verification is required by explicit time-sensitive rules.",
    }, {
      originalQuery,
      resolvedQuery: deterministicResolved,
      route: "WEB",
      isFollowUp: exchanges.length > 0,
      requiresFreshEvidence: true,
      reusePreviousEvidence: false,
    });
  }

  if (deterministic.category === "ambiguous") {
    return withRouteMetadata(deterministic, {
      originalQuery,
      resolvedQuery: originalQuery,
      route: "LOCAL",
      isFollowUp: false,
      requiresFreshEvidence: false,
      reusePreviousEvidence: false,
    });
  }

  if (
    deterministic.category === "conversation_only" ||
    deterministic.category === "existing_evidence" ||
    deterministic.category === "local_knowledge"
  ) {
    const route =
      deterministic.category === "existing_evidence"
        ? "REUSE"
        : deterministic.category === "conversation_only"
          ? "LOCAL"
          : "LOCAL";
    return withRouteMetadata(deterministic, {
      originalQuery,
      resolvedQuery: deterministicResolved,
      route,
      isFollowUp: exchanges.length > 0,
      requiresFreshEvidence: false,
      reusePreviousEvidence: route === "REUSE",
    });
  }

  const evidenceSummary = relevantEvidence.slice(0, 4).map((item, index) => ({
    index: index + 1,
    title: item.title,
    domain: (() => {
      try { return new URL(item.url).hostname.replace(/^www\./, ""); }
      catch { return ""; }
    })(),
    snippet: item.text.slice(0, 300),
  }));
  const recentMessages = buildConversationContext(conversation, {
    currentQuestion: originalQuery,
    tokenBudget: 1600,
  });
  const systemMessage = {
    role: "system",
    content: `You are VeriScope's per-turn routing assistant. Resolve the current question using prior conversation only, then decide whether it needs LOCAL knowledge, REUSE of relevant prior evidence, fresh WEB research, or HYBRID evidence.

Return only a JSON object with exactly these keys:
{"route":"LOCAL|REUSE|WEB|HYBRID","isFollowUp":true,"resolvedQuery":"...","reason":"short reason","requiresFreshEvidence":true,"reusePreviousEvidence":false}

Rules:
- Preserve the original meaning; do not add assumptions or entities.
- Prefer LOCAL for stable conceptual questions.
- Prefer REUSE only when existing passages directly and explicitly answer the request.
- Prefer WEB for latest/current/time-sensitive facts, leadership, versions, prices, announcements, or uncertain recent specifics.
- Prefer HYBRID when prior context is needed and fresh external evidence is also necessary.
- If uncertain about evidence sufficiency, prefer WEB.
- Do not include chain-of-thought or markdown.`,
  };
  const currentMessage = {
    role: "user",
    content: JSON.stringify({
      originalQuery,
      evidenceAvailable: evidenceSummary,
    }),
  };
  const fittedContext = fitConversationContext(recentMessages, {
    systemMessage,
    currentMessage,
    maxPromptTokens: getPromptTokenBudget(),
  });
  const promptTokenCount = estimateMessageTokens(fittedContext.messages);
  const outputTokenLimit = getOutputTokenLimit(promptTokenCount, {
    maxOutputTokens: 180,
    minimumOutputTokens: 40,
  });

  try {
    const client = ollamaClient || ollama;
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
        signal,
        timeoutMs: timeoutMs ?? OLLAMA_REQUEST_TIMEOUT_MS,
      }
    );
    const parsed = parseRouterJson(
      normalizedModelText(response?.message?.content ?? response?.content)
    );
    const rawLabel = normalizedModelText(
      response?.message?.content ?? response?.content
    ).trim().toUpperCase();

    if (parsed && ["LOCAL", "REUSE", "WEB", "HYBRID"].includes(parsed.route)) {
      const resolvedQuery =
        typeof parsed.resolvedQuery === "string" && parsed.resolvedQuery.trim()
          ? parsed.resolvedQuery.trim()
          : originalQuery;
      let route = parsed.route;
      if (route === "REUSE" && relevantEvidence.length === 0) route = "WEB";
      if (route === "HYBRID" && relevantEvidence.length === 0) route = "WEB";
      const category =
        route === "LOCAL"
          ? "local_knowledge"
          : route === "REUSE"
            ? "existing_evidence"
            : route === "HYBRID"
              ? "hybrid_research"
              : "new_research";
      const selectedEvidence =
        route === "REUSE" || route === "HYBRID"
          ? relevantEvidence
          : [];
      const result = {
        category,
        reason:
          typeof parsed.reason === "string" && parsed.reason.trim()
            ? parsed.reason.trim()
            : "The local model selected this per-turn route.",
        searchQuery: resolvedQuery,
        sourceQuestion: latestCompletedUserQuestion(exchanges),
        evidence: selectedEvidence,
      };
      console.info("[ResearchRouting] Per-turn decision", {
        originalQuery,
        resolvedQuery,
        route,
        reason: result.reason,
      });
      return withRouteMetadata(result, {
        originalQuery,
        resolvedQuery,
        route,
        isFollowUp:
          typeof parsed.isFollowUp === "boolean"
            ? parsed.isFollowUp
            : exchanges.length > 0,
        requiresFreshEvidence:
          route === "WEB" || route === "HYBRID",
        reusePreviousEvidence:
          typeof parsed.reusePreviousEvidence === "boolean"
            ? route === "REUSE" || (route === "HYBRID" && parsed.reusePreviousEvidence)
            : route === "REUSE" || route === "HYBRID",
      });
    }

    if (rawLabel === "LOCAL_KNOWLEDGE") {
      return withRouteMetadata({
        category: "local_knowledge",
        reason: "The local model classified this stable question for local answering.",
        searchQuery: originalQuery,
        sourceQuestion: latestCompletedUserQuestion(exchanges),
      }, {
        originalQuery,
        resolvedQuery: originalQuery,
        route: "LOCAL",
        isFollowUp: exchanges.length > 0,
        requiresFreshEvidence: false,
        reusePreviousEvidence: false,
      });
    }
    if (rawLabel === "WEB_RESEARCH") {
      return withRouteMetadata({
        category: "new_research",
        reason: "The local model classified this question as requiring fresh research.",
        searchQuery: originalQuery,
        sourceQuestion: latestCompletedUserQuestion(exchanges),
      }, {
        originalQuery,
        resolvedQuery: deterministicResolved,
        route: "WEB",
        isFollowUp: exchanges.length > 0,
        requiresFreshEvidence: true,
        reusePreviousEvidence: false,
      });
    }
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") throw error;
    console.warn("[ResearchRouting] Structured routing unavailable; using safe fallback.", {
      code: classifyOllamaError(error).code,
    });
  }

  const fallback = {
    category: "new_research",
    reason: "Routing output was malformed or unavailable; conservative fresh research was selected.",
    searchQuery: deterministicResolved,
    sourceQuestion: latestCompletedUserQuestion(exchanges),
  };
  console.warn("[ResearchRouting] Per-turn fallback", {
    originalQuery,
    route: "WEB",
  });
  return withRouteMetadata(fallback, {
    originalQuery,
    resolvedQuery: deterministicResolved,
    route: "WEB",
    isFollowUp: exchanges.length > 0,
    requiresFreshEvidence: true,
    reusePreviousEvidence: false,
  });
}
