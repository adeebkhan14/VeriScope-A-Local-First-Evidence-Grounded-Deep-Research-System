import { discoverUrls } from "./scraper/searchEngine.js";
import { scrapePage } from "./scraper/scraper.js";
import { chunkText } from "./retrieval/chunker.js";
import { createBM25Index } from "./retrieval/bm25.js";
import { getEmbeddingsSafe } from "./retrieval/embeddings.js";
import { cosineSimilarity } from "./retrieval/semanticsearch.js";
import { minMaxNormalize } from "./retrieval/normalize.js";
import { buildEvidencePackage } from "./retrieval/evidence.js";
import {
  deduplicateChunks,
  diversifySources,
} from "./retrieval/deduplicate.js";
import { generateAnswer, tryDirectAnswer } from "./llm/ollama.js";
import { evaluateEvidenceSufficiency } from "./llm/evidenceJudge.js";
import { attributeClaims } from "./llm/evidenceAttribution.js";
import {
  buildConversationContext,
} from "./llm/conversationContext.js";
import {
  OLLAMA_CONTEXT_LENGTH,
  OLLAMA_HISTORY_TOKEN_BUDGET,
  OLLAMA_NUM_PREDICT,
} from "./llm/ollamaClient.js";
import { buildGroundedAnswerPrompt } from "./llm/ollama.js";
import {
  estimateEvidenceTokens,
  estimateTokenCount,
  normalizeResearchSettings,
  selectEvidenceWithinBudget,
} from "./retrieval/depth.js";

const MAX_PAGES_TO_SCRAPE = 5;
const MAX_PAGE_CHARACTERS = 6000;
const MAX_EMBEDDING_CANDIDATES = 20;

/**
 * Main research pipeline:
 * 0. Direct answer evaluation via the local Ollama model (for non-knowledge-intensive / internal-knowledge queries)
 * 1. Web search & URL deduplication via SearXNG (for knowledge-intensive / real-time queries)
 * 2. Parallel scraping with search-snippet fallback for inaccessible pages
 * 3. Text chunking & near-duplicate chunk suppression
 * 4. BM25 lexical retrieval
 * 5. MiniLM semantic embeddings with graceful lexical fallback
 * 6. Hybrid scoring & source diversification
 * 7. Evidence packaging with supporting excerpts for every citation
 * 8. Factual synthesis via the local Ollama model with insufficient-evidence detection
 *
 * @param {string} query
 * @param {{ forceWebSearch?: boolean }} [options]
 * @returns {Promise<{
 *   query: string,
 *   answer: string,
 *   citations: Array<{id: number, title: string, url: string, snippet: string, score: number}>,
 *   evidence: Array<{id: number, chunkId: number|null, title: string, sourceTitle: string|null, url: string, text: string, score: number}>,
 *   claimAttribution?: {
 *     status: "available" | "unavailable",
 *     claims: Array<{
 *       claimId: string,
 *       claimText: string,
 *       status: "direct" | "partial" | "related" | "unsupported",
 *       evidence: Array<{
 *         sourceId: number|null,
 *         title: string|null,
 *         domain: string|null,
 *         url: string|null,
 *         extractedText: string,
 *         chunkId: number,
 *         relevanceScore: number|null,
 *         supportStatus: "direct" | "partial" | "related"
 *       }>
 *     }>
 *   },
 *   insufficientEvidence: boolean,
 *   llmUnavailable?: boolean,
 *   llmError?: { status: string, code: string, message: string },
 *   source?: "local_llm" | "web_search",
 *   answeredByLLM?: boolean,
 *   searchedWeb?: boolean,
 *   warnings?: string[]
 * }>}
 */
export async function research(query, options = {}) {
  if (typeof query !== "string" || !query.trim()) {
    const error = new Error("Query must be a non-empty string.");
    error.code = "INVALID_REQUEST";
    throw error;
  }
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    (options.forceWebSearch !== undefined &&
      typeof options.forceWebSearch !== "boolean")
  ) {
    const error = new Error("Research options must be a valid object.");
    error.code = "INVALID_REQUEST";
    throw error;
  }

  const {
    forceWebSearch = false,
    ollamaClient,
    judgeTimeoutMs,
    discoverFn = discoverUrls,
    scrapeFn = scrapePage,
    embeddingsFn = getEmbeddingsSafe,
    onProgress,
    onToken,
  } = options;
  const researchSettings = normalizeResearchSettings({
    depth: options.depth,
    alpha: options.alpha,
  });
  const conversation = buildConversationContext(options.conversation, {
    tokenBudget: OLLAMA_HISTORY_TOKEN_BUDGET,
  });
  const promptOverheadTokens = estimateTokenCount(
    buildGroundedAnswerPrompt(query.trim(), [], conversation.prompt)
  );
  const effectiveEvidenceTokenBudget = Math.max(
    0,
    Math.min(
      researchSettings.evidenceTokenBudget,
      OLLAMA_CONTEXT_LENGTH - OLLAMA_NUM_PREDICT - promptOverheadTokens
    )
  );
  const sessionId =
    typeof options.sessionId === "string" ? options.sessionId : null;
  const createResearchMetadata = ({
    retrievedChunkCount = 0,
    chunksSent = 0,
    evidenceTokenCount = 0,
    retrievalTimeMs = null,
    timeToFirstTokenMs = null,
    generationTimeMs = null,
  } = {}) => ({
    depth: researchSettings.depth,
    alpha: researchSettings.alpha,
    topK: researchSettings.topK,
    evidenceTokenBudget: researchSettings.evidenceTokenBudget,
    effectiveEvidenceTokenBudget,
    retrievedChunkCount,
    chunksSent,
    evidenceTokenCount,
    contextLength: OLLAMA_CONTEXT_LENGTH,
    conversationTokens: conversation.tokenCount,
    conversationMessages: conversation.messagesIncluded,
    summarizedConversationMessages: conversation.summarizedMessages,
    retrievalTimeMs,
    timeToFirstTokenMs,
    generationTimeMs,
  });
  const reportProgress = (message) => onProgress?.(message);
  const warnings = [];

  if (options.signal?.aborted) {
    const error = new Error("Research request was cancelled.");
    error.name = "AbortError";
    error.code = "ABORT_ERR";
    throw error;
  }

  console.log("\n========================================");
  console.log("STARTING RESEARCH / QUERY EVALUATION");
  console.log("========================================");
  query = query.trim();
  console.log("Query:", query);

  // ========================================
  // 0. DIRECT ANSWER EVALUATION (Local Ollama model)
  // ========================================
  if (!forceWebSearch) {
    reportProgress("Checking local model...");
    console.log("\n[0] Checking if the local model can answer directly...");
    let directAnswerStarted = false;
    const directResult = await tryDirectAnswer(query, {
      ollamaClient,
      signal: options.signal,
      conversationContext: conversation.prompt,
      onToken: (token) => {
        if (!directAnswerStarted) {
          reportProgress("Generating answer...");
          directAnswerStarted = true;
        }
        onToken?.(token);
      },
    });

    if (directResult.canAnswer && directResult.answer) {
      console.log(
        "✓ Answered directly by the local model (internal knowledge / less knowledge-intensive)"
      );
      return {
        query,
        answer: directResult.answer,
        sessionId,
        citations: [],
        evidence: [],
        insufficientEvidence: false,
        llmUnavailable: false,
        source: "local_llm",
        answeredByLLM: true,
        searchedWeb: false,
        researchMetadata: createResearchMetadata({
          timeToFirstTokenMs: directResult.timing?.timeToFirstTokenMs ?? null,
          generationTimeMs: directResult.timing?.generationTimeMs ?? null,
        }),
      };
    }

    if (directResult.llmUnavailable) {
      warnings.push(
        directResult.llmError?.message ||
          "Ollama could not evaluate a direct answer; proceeding with web search."
      );
    }

    console.log(
      `Web search required: ${
        directResult.reason || "Knowledge-intensive or external facts required"
      }`
    );
  } else {
    console.log("\n[0] Web search explicitly requested (forceWebSearch = true)");
  }

  // ========================================
  // 1. SEARCH WITH SEARXNG (Deduplicated URLs)
  // ========================================
  reportProgress("Querying SearXNG...");
  console.log("\n[1] Searching with SearXNG...");
  const searchResults = await discoverFn(query);
  console.log(`Found ${searchResults.length} unique search results`);

  if (searchResults.length === 0) {
    return {
      query,
      sessionId,
      answer:
        "Not enough evidence. The web search returned 0 results for your query. Try broadening your terms or using different keywords.",
      citations: [],
      evidence: [],
      insufficientEvidence: true,
      evidenceStatus: "insufficient",
      missingEvidence: "No search results returned for the query.",
      evidenceEvaluation: {
        sufficient: false,
        reason: "SearXNG returned 0 search results.",
        missing: "All requested information is missing because no web pages were found.",
        status: "insufficient",
      },
      source: "web_search",
      answeredByLLM: false,
      searchedWeb: true,
      warnings: ["SearXNG returned no search results."],
      researchMetadata: createResearchMetadata(),
    };
  }

  // ========================================
  // 2. SCRAPE WEBPAGES (With fallback snippets)
  // ========================================
  console.log("\n[2] Scraping webpages in parallel...");
  const selectedResults = searchResults.slice(0, MAX_PAGES_TO_SCRAPE);
  reportProgress(`Scraping ${selectedResults.length} pages...`);

  const scrapeOutcomes = await Promise.allSettled(
    selectedResults.map(async (result) => {
      const page = await scrapeFn(result, { allowBrowserFallback: false });
      const pageContent =
        typeof page?.content === "string" ? page.content.trim() : "";
      const snippet =
        typeof result.content === "string" ? result.content.trim() : "";
      const content = pageContent || snippet;

      if (page?.error) {
        warnings.push(`Could not fully scrape ${result.title}: ${page.error}`);
      }
      if ((!pageContent || page.isSnippetFallback) && snippet) {
        warnings.push(`Used search snippet for ${result.title} (full page unreadable).`);
      }

      if (!content) {
        console.log(`- Inaccessible page: ${result.url}`);
        return null;
      }

      return {
        ...page,
        content: content.slice(0, MAX_PAGE_CHARACTERS),
      };
    })
  );
  const scrapedPages = scrapeOutcomes.map((outcome, index) => {
    if (outcome.status === "fulfilled") return outcome.value;

    const result = selectedResults[index];
    const detail =
      outcome.reason instanceof Error
        ? outcome.reason.message
        : "Unknown scraping error";
    const snippet =
      typeof result.content === "string" ? result.content.trim() : "";
    if (snippet) {
      warnings.push(
        `Could not scrape ${result.title}: ${detail}. Used the search snippet instead.`
      );
      return {
        title: result.title,
        url: result.url,
        content: snippet.slice(0, MAX_PAGE_CHARACTERS),
        method: "snippet-fallback",
        isSnippetFallback: true,
      };
    }

    warnings.push(`Could not scrape ${result.title}: ${detail}`);
    console.error(`[Research] Scraping failed for ${result.url}:`, outcome.reason);
    return null;
  });

  const pages = scrapedPages.filter(Boolean);
  console.log(`Successfully extracted content from ${pages.length} pages`);

  if (pages.length === 0) {
    return {
      query,
      sessionId,
      answer:
        "Not enough evidence. Web search discovered links, but none of the pages were accessible or contained readable text.",
      citations: searchResults.slice(0, 3).map((r, i) => ({
        id: i + 1,
        title: r.title,
        url: r.url,
        snippet: r.content || "Content was inaccessible.",
        score: 0,
      })),
      evidence: [],
      insufficientEvidence: true,
      evidenceStatus: "insufficient",
      missingEvidence: "All discovered web pages were inaccessible or contained no readable text.",
      evidenceEvaluation: {
        sufficient: false,
        reason: "None of the discovered web pages were accessible or contained readable text.",
        missing: "All requested information is missing because web page content could not be read.",
        status: "insufficient",
      },
      source: "web_search",
      answeredByLLM: false,
      searchedWeb: true,
      warnings: [
        "All discovered pages were inaccessible.",
        ...warnings,
      ],
      researchMetadata: createResearchMetadata(),
    };
  }

  // ========================================
  // 3. CHUNK & DEDUPLICATE WEBPAGES
  // ========================================
  console.log("\n[3] Chunking & deduplicating text...");
  const rawChunks = [];
  let chunkId = 0;

  for (const page of pages) {
    const pageChunks = chunkText(page.content, {
      chunkSize: 1000,
      overlap: 200,
    });

    pageChunks.forEach((text) => {
      rawChunks.push({
        id: chunkId++,
        title: page.title,
        url: page.url,
        text,
      });
    });
  }

  // Deduplicate exact and near-duplicate chunks
  const chunks = deduplicateChunks(rawChunks, 0.7);
  console.log(
    `Extracted ${rawChunks.length} raw chunks -> deduplicated to ${chunks.length} unique chunks`
  );

  if (chunks.length === 0) {
    return {
      query,
      sessionId,
      answer:
        "Not enough evidence. No substantial text chunks could be extracted from the pages.",
      citations: [],
      evidence: [],
      insufficientEvidence: true,
      evidenceStatus: "insufficient",
      missingEvidence: "No substantial text chunks could be extracted from the pages.",
      evidenceEvaluation: {
        sufficient: false,
        reason: "No substantial text chunks could be extracted from the pages.",
        missing: "All requested information is missing.",
        status: "insufficient",
      },
      source: "web_search",
      answeredByLLM: false,
      searchedWeb: true,
      researchMetadata: createResearchMetadata(),
    };
  }

  // ========================================
  // 4. BM25 LEXICAL RETRIEVAL
  // ========================================
  const retrievalStartedAt = Date.now();
  console.log("\n[4] Building BM25 index & scoring...");
  const bm25Index = createBM25Index(chunks);
  const bm25Results = bm25Index.search(query, chunks.length);

  const bm25Scores = new Map(
    bm25Results.map((result) => [result.id, result.bm25Score])
  );
  chunks.forEach((chunk) => {
    chunk.bm25Score = bm25Scores.get(chunk.id) ?? 0;
  });

  // Select candidates with highest BM25 score for embedding
  const candidates = [...chunks]
    .sort((a, b) => b.bm25Score - a.bm25Score)
    .slice(0, MAX_EMBEDDING_CANDIDATES);

  // ========================================
  // 5. SEMANTIC EMBEDDINGS (With graceful lexical fallback)
  // ========================================
  reportProgress("Reranking with MiniLM...");
  console.log("\n[5] Embedding candidate chunks...");
  const embeddingResponse = await embeddingsFn([
    query,
    ...candidates.map((chunk) => chunk.text),
  ]);

  const normalizedBM25 = minMaxNormalize(
    candidates.map((chunk) => chunk.bm25Score)
  );

  if (embeddingResponse.available && embeddingResponse.embeddings?.length > 1) {
    const [queryEmbedding, ...chunkEmbeddings] = embeddingResponse.embeddings;

    candidates.forEach((chunk, index) => {
      chunk.semanticScore = cosineSimilarity(
        queryEmbedding,
        chunkEmbeddings[index]
      );
    });

    const normalizedSemantic = minMaxNormalize(
      candidates.map((chunk) => chunk.semanticScore)
    );

    candidates.forEach((chunk, index) => {
      chunk.hybridScore =
        researchSettings.alpha * normalizedBM25[index] +
        (1 - researchSettings.alpha) * normalizedSemantic[index];
    });
    console.log(
      `✓ Ranked ${candidates.length} candidates using hybrid fusion (alpha ${researchSettings.alpha})`
    );
  } else {
    // Graceful fallback to BM25 lexical score
    candidates.forEach((chunk, index) => {
      chunk.semanticScore = 0;
      chunk.hybridScore = normalizedBM25[index];
    });
    warnings.push(
      "Local embedding service (MiniLM) was offline; results retrieved using BM25 lexical search."
    );
    console.log("✓ Ranked candidates using BM25 lexical fallback");
  }

  // ========================================
  // 6. SOURCE DIVERSIFICATION & SELECTION
  // ========================================
  console.log("\n[6] Selecting top diversified evidence...");
  const rankedCandidates = [...candidates].sort(
    (a, b) => b.hybridScore - a.hybridScore
  );

  // Ensure near-duplicate chunks do not fill multiple top evidence slots
  const nonDuplicateCandidates = deduplicateChunks(rankedCandidates, 0.65);

  // Diversify across URLs so no single source dominates completely
  const topEvidence = diversifySources(
    nonDuplicateCandidates,
    2,
    researchSettings.topK
  );

  const budgetedEvidence = selectEvidenceWithinBudget(
    topEvidence,
    researchSettings.topK,
    effectiveEvidenceTokenBudget
  );
  const evidenceTokenCount = estimateEvidenceTokens(budgetedEvidence);
  const retrievalTimeMs = Date.now() - retrievalStartedAt;

  console.log(
    `Selected ${budgetedEvidence.length}/${topEvidence.length} evidence passages within ${effectiveEvidenceTokenBudget} tokens`
  );

  // ========================================
  // 7. BUILD EVIDENCE PACKAGE
  // ========================================
  const evidencePackage = buildEvidencePackage(query, budgetedEvidence);
  const researchMetadata = createResearchMetadata({
    retrievedChunkCount: rankedCandidates.length,
    chunksSent: evidencePackage.evidence.length,
    evidenceTokenCount,
    retrievalTimeMs,
  });

  // Format citations with supporting text snippets
  const citations = evidencePackage.evidence.map((source) => ({
    id: source.id,
    title: source.title,
    url: source.url,
    snippet: source.text,
    score: source.score,
  }));

  // ========================================
  // 8. EVALUATE EVIDENCE SUFFICIENCY (Evidence Gate)
  // ========================================
  console.log("\n[7] Evaluating evidence sufficiency with the local model...");
  const evaluation = await evaluateEvidenceSufficiency(
    evidencePackage.query,
    evidencePackage.evidence,
    {
      ollamaClient,
      timeoutMs: judgeTimeoutMs,
      signal: options.signal,
    }
  );

  // If evidence judge rejects the evidence, fail closed and DO NOT generate answer
  if (!evaluation.sufficient) {
    console.log(
      `✗ Evidence rejected by gate (${evaluation.status}): ${evaluation.reason}`
    );

    const isVerificationFailed = evaluation.status === "verification_failed";
    const reasonText =
      evaluation.reason ||
      "The retrieved evidence does not adequately support an answer to this query.";
    const missingDetail = evaluation.missing
      ? ` Missing information: ${evaluation.missing}`
      : "";

    return {
      query,
      sessionId,
      answer: isVerificationFailed
        ? "Not enough evidence. Evidence verification could not be completed at this time."
        : `Not enough evidence. ${reasonText}${missingDetail ? ` ${missingDetail}` : ""}`,
      citations,
      evidence: evidencePackage.evidence,
      insufficientEvidence: true,
      evidenceStatus: evaluation.status, // "insufficient" | "verification_failed"
      evidenceEvaluation: {
        sufficient: false,
        reason: evaluation.reason,
        missing: evaluation.missing,
        status: evaluation.status,
        llmError: evaluation.llmError,
      },
      llmError: evaluation.llmError,
      missingEvidence: evaluation.missing || evaluation.reason,
      source: "web_search",
      answeredByLLM: false,
      searchedWeb: true,
      warnings: warnings.length > 0 ? warnings : undefined,
      researchMetadata,
    };
  }

  // ========================================
  // 9. GENERATE GROUNDED ANSWER (Only when evidence is sufficient)
  // ========================================
  console.log(
    "\n[8] Evidence is sufficient! Generating grounded answer with the local model..."
  );
  reportProgress("Generating answer...");
  const generation = await generateAnswer(
    evidencePackage.query,
    evidencePackage.evidence,
    {
      ollamaClient,
      onToken,
      signal: options.signal,
      conversationContext: conversation.prompt,
    }
  );

  let claimAttribution;
  const resultWarnings = [...warnings];
  if (!generation.llmUnavailable && !generation.isInsufficientEvidence) {
    reportProgress("Mapping claims to evidence...");
    claimAttribution = await attributeClaims(
      generation.answer,
      evidencePackage.evidence,
      { ollamaClient, signal: options.signal }
    );
    if (claimAttribution.status === "unavailable") {
      resultWarnings.push(
        "Claim-level evidence attribution was unavailable; the answer and source citations are unchanged."
      );
    }
  }

  return {
    query,
    sessionId,
    answer: generation.answer,
    citations,
    evidence: evidencePackage.evidence,
    claimAttribution,
    insufficientEvidence: generation.isInsufficientEvidence || false,
    llmUnavailable: generation.llmUnavailable || false,
    llmError: generation.llmError,
    evidenceStatus: generation.isInsufficientEvidence ? "insufficient" : "sufficient",
    evidenceEvaluation: {
      sufficient: !generation.isInsufficientEvidence,
      reason: evaluation.reason,
      missing: evaluation.missing,
      status: evaluation.status,
    },
    missingEvidence: generation.isInsufficientEvidence
      ? "Generation detected remaining gaps in retrieved sources."
      : null,
    source: "web_search",
    answeredByLLM: false,
    searchedWeb: true,
    warnings: resultWarnings.length > 0 ? resultWarnings : undefined,
    researchMetadata: {
      ...researchMetadata,
      timeToFirstTokenMs: generation.timing?.timeToFirstTokenMs ?? null,
      generationTimeMs: generation.timing?.generationTimeMs ?? null,
    },
  };
}