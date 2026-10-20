import ollama, { OLLAMA_URL } from "./ollamaClient.js";

/**
 * Builds the strict evidence-sufficiency prompt for Mistral.
 * Enforces evaluation ONLY on the provided retrieved passages and ignores pretrained knowledge.
 *
 * @param {string} query
 * @param {Array<{id: number, title: string, url: string, text: string}>} evidence
 * @returns {string}
 */
export function buildEvidenceJudgePrompt(query, evidence) {
  const passagesText = evidence
    .map((item) => {
      const id = item?.id ?? "?";
      const title = item?.title ?? "Untitled";
      const url = item?.url ?? "Unknown URL";
      const rawText = typeof item?.text === "string" ? item.text.trim() : "";
      // Trim to 750 chars per passage to keep context concise and speed up local prompt evaluation
      const text = rawText.length > 750 ? `${rawText.slice(0, 750)}...` : rawText;
      return `[Source ${id}]
Title: ${title}
URL: ${url}
Passage:
${text || "No text available."}`;
    })
    .join("\n\n--------------------\n\n");

  return `You are a strict, skeptical evidence-sufficiency evaluator for a factual research system.
Your sole job is to evaluate whether the retrieved web passages contain concrete, adequate evidence to answer the user's query accurately and completely.

STRICT EVALUATION RULES:
1. JUDGE ONLY FROM PROVIDED PASSAGES: Base your judgment EXCLUSIVELY on facts explicitly stated in the retrieved passages below.
2. IGNORE PRETRAINED KNOWLEDGE: You MUST completely ignore any prior knowledge or pretrained facts you have about the topic. If a fact is not explicitly in the passages, it DOES NOT EXIST.
3. MULTI-PART QUESTIONS: If the query asks multiple questions or asks for multiple details (e.g. who and when, or what is X and how does it compare to Y), ALL parts must be supported by the passages. If any requested aspect is missing or only partially addressed, you MUST mark sufficient as false.
4. TOPICALITY IS NOT SUFFICIENCY: Passages that discuss the same general topic, entity, or domain but do not contain the specific facts requested by the query are INSUFFICIENT. Never infer that a source supports a claim merely because it discusses the same topic.
5. VAGUE OR INSUFFICIENTLY INFORMATIVE PASSAGES: Treat relevant but insufficiently informative or vague passages as INSUFFICIENT.
6. NO SPECULATION: Do not make ungrounded inferences or assume facts that are not explicitly stated.

You must respond with ONLY a valid JSON object (no markdown formatting, no text before or after the JSON) with this exact schema:
{
  "sufficient": false,
  "reason": "Clear explanation of whether and why the provided passages are sufficient or insufficient to answer the query.",
  "missing": "Explicit description of which requested aspects or facts are unsupported or missing. If sufficient is true, this must be null or an empty string."
}

User Query:
${query}

Retrieved Passages:
${passagesText}`;
}

/**
 * Validates and normalizes the parsed evaluator output.
 * Throws an error with code 'MALFORMED_OUTPUT' if the output is not valid.
 *
 * @param {unknown} parsed
 * @returns {{sufficient: boolean, reason: string, missing: string | null, status: "sufficient" | "insufficient"}}
 */
export function validateJudgeObject(parsed) {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    const err = new Error("Evidence evaluator response is not a valid JSON object");
    err.code = "MALFORMED_OUTPUT";
    throw err;
  }

  // Validate 'sufficient'
  let sufficient = parsed.sufficient;
  if (typeof sufficient === "string") {
    if (sufficient.toLowerCase() === "true") sufficient = true;
    else if (sufficient.toLowerCase() === "false") sufficient = false;
  }

  if (typeof sufficient !== "boolean") {
    const err = new Error("Evidence evaluator response missing or invalid boolean 'sufficient' field");
    err.code = "MALFORMED_OUTPUT";
    throw err;
  }

  // Validate 'reason'
  const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : "";
  if (!reason) {
    const err = new Error("Evidence evaluator response missing or empty 'reason' field");
    err.code = "MALFORMED_OUTPUT";
    throw err;
  }

  // Validate 'missing'
  let missing = parsed.missing;
  if (missing === null || missing === undefined) {
    missing = null;
  } else if (typeof missing === "string") {
    missing = missing.trim() || null;
  } else if (Array.isArray(missing)) {
    missing = missing.map((s) => String(s).trim()).filter(Boolean).join("; ") || null;
  }

  if (!sufficient && !missing) {
    missing = reason;
  }

  return {
    sufficient,
    reason,
    missing: sufficient ? null : missing,
    status: sufficient ? "sufficient" : "insufficient",
  };
}

/**
 * Parses and validates raw model text into a structured evidence judge result.
 * Safely extracts JSON even if surrounded by markdown fences or extraneous text.
 *
 * @param {string} rawText
 * @returns {{sufficient: boolean, reason: string, missing: string | null, status: "sufficient" | "insufficient"}}
 */
export function parseAndValidateJudgeResponse(rawText) {
  if (typeof rawText !== "string" || !rawText.trim()) {
    const err = new Error("Empty response received from evidence evaluator");
    err.code = "MALFORMED_OUTPUT";
    throw err;
  }

  let text = rawText.trim();

  // Strip markdown code fences if present
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }

  // Find outermost JSON object if there is leading/trailing text
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    text = text.substring(firstBrace, lastBrace + 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (jsonErr) {
    const err = new Error(`Malformed JSON returned by evidence evaluator: ${jsonErr.message}`);
    err.code = "MALFORMED_OUTPUT";
    err.raw = rawText;
    throw err;
  }

  return validateJudgeObject(parsed);
}

/**
 * Evaluates whether the retrieved web evidence directly and adequately supports
 * answering the user's query, ignoring any pretrained model knowledge.
 *
 * Fails closed on any model failure, timeout, or malformed output.
 *
 * @param {string} query
 * @param {Array<{id: number, title: string, url: string, text: string}>} evidence
 * @param {{
 *   ollamaClient?: typeof ollama,
 *   model?: string,
 *   timeoutMs?: number
 * }} [options]
 * @returns {Promise<{
 *   sufficient: boolean,
 *   reason: string,
 *   missing: string | null,
 *   status: "sufficient" | "insufficient" | "verification_failed",
 *   error?: string,
 *   errorCode?: string
 * }>}
 */
export async function evaluateEvidenceSufficiency(query, evidence, options = {}) {
  const safeEvidence = Array.isArray(evidence) ? evidence.filter(Boolean) : [];
  const normalizedQuery = typeof query === "string" ? query.trim() : "";

  // Guard: Empty query
  if (!normalizedQuery) {
    return {
      sufficient: false,
      reason: "No query provided to evaluate.",
      missing: "Query was empty.",
      status: "insufficient",
    };
  }

  // Guard: Empty evidence passages
  if (safeEvidence.length === 0) {
    return {
      sufficient: false,
      reason: "No evidence chunks were retrieved to support the query.",
      missing: "All requested information is missing because no web evidence was retrieved.",
      status: "insufficient",
    };
  }

  const client = options.ollamaClient || ollama;
  const model = options.model || "mistral";
  // Generous 60-second default for local 7B models on Apple Silicon / CPU
  const timeoutMs =
    options.timeoutMs ??
    (Number(process.env.EVIDENCE_JUDGE_TIMEOUT_MS) || 60000);

  const prompt = buildEvidenceJudgePrompt(normalizedQuery, safeEvidence);

  let timer;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const timeoutError = new Error(`Evidence evaluation timed out after ${timeoutMs}ms`);
        timeoutError.code = "TIMEOUT";
        reject(timeoutError);
      }, timeoutMs);
      if (timer?.unref) timer.unref();
    });

    const chatPromise = client.chat({
      model,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      format: "json",
      keep_alive: "15m", // Keep model warm in memory to avoid cold reload delays
      options: {
        temperature: 0.0,
        num_predict: 250, // Short output needed for structured JSON
      },
    });

    const response = await Promise.race([chatPromise, timeoutPromise]);

    const rawContent =
      response?.message?.content ??
      response?.content ??
      (typeof response === "string" ? response : "");

    const evaluated = parseAndValidateJudgeResponse(rawContent);

    console.log(`[EvidenceJudge] Sufficiency: ${evaluated.sufficient ? "SUFFICIENT" : "INSUFFICIENT"}`);
    console.log(`[EvidenceJudge] Reason: ${evaluated.reason}`);
    if (evaluated.missing) {
      console.log(`[EvidenceJudge] Missing aspects: ${evaluated.missing}`);
    }

    return evaluated;
  } catch (error) {
    // Fail closed: Log diagnostic details on server and return verification_failed
    console.error("[EvidenceJudge] Verification failed (failing closed):", error.message || error);
    if (error.raw) {
      console.error("[EvidenceJudge] Raw model response:", error.raw);
    }

    const errMsg = error.message || "";
    const lower = errMsg.toLowerCase();
    const isConnRefused =
      error.code === "ECONNREFUSED" ||
      lower.includes("econnrefused") ||
      lower.includes("fetch failed") ||
      lower.includes("connect") ||
      lower.includes("socket hang up");
    const isTimeout = error.code === "TIMEOUT" || lower.includes("timeout");
    const isModelNotFound = lower.includes("not found") || lower.includes("404");

    let reason = "Evidence verification could not be completed at this time.";
    let missing = "Evidence sufficiency could not be established due to an evaluator error.";

    if (isConnRefused) {
      reason = `Local Ollama service is not running at ${OLLAMA_URL}.`;
      missing = "Ollama is offline. Start it by running 'ollama serve' in your terminal.";
    } else if (isTimeout) {
      reason = `Evidence evaluator timed out after ${timeoutMs}ms.`;
      missing = "The local model took too long to evaluate the evidence.";
    } else if (isModelNotFound) {
      reason = `The '${model}' model was not found in Ollama.`;
      missing = `Download the model by running 'ollama run ${model}' in your terminal.`;
    }

    return {
      sufficient: false,
      reason,
      missing,
      status: "verification_failed",
      error: error.message || "Unknown error during evidence evaluation",
      errorCode: error.code || "EVALUATOR_ERROR",
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
