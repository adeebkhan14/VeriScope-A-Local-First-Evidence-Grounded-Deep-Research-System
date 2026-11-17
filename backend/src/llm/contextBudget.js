import {
  OLLAMA_CONTEXT_LENGTH,
  OLLAMA_CONTEXT_SAFETY_MARGIN,
  OLLAMA_DEBUG_CONTEXT,
  OLLAMA_MIN_OUTPUT_TOKENS,
  OLLAMA_NUM_PREDICT,
} from "./ollamaClient.js";
import { estimateTokenCount } from "../retrieval/depth.js";

export function estimateMessageTokens(messages) {
  return (
    8 +
    messages.reduce(
      (total, message) =>
        total + estimateTokenCount(message?.content || "") + 4,
      0
    )
  );
}

export function getPromptTokenBudget(contextLength = OLLAMA_CONTEXT_LENGTH) {
  return Math.max(
    0,
    contextLength - OLLAMA_CONTEXT_SAFETY_MARGIN - OLLAMA_MIN_OUTPUT_TOKENS
  );
}

export function getOutputTokenLimit(
  promptTokenCount,
  {
    contextLength = OLLAMA_CONTEXT_LENGTH,
    maxOutputTokens = OLLAMA_NUM_PREDICT,
    minimumOutputTokens = OLLAMA_MIN_OUTPUT_TOKENS,
  } = {}
) {
  const available = contextLength - OLLAMA_CONTEXT_SAFETY_MARGIN - promptTokenCount;
  if (
    !Number.isFinite(promptTokenCount) ||
    promptTokenCount >
      contextLength - OLLAMA_CONTEXT_SAFETY_MARGIN - minimumOutputTokens ||
    available < minimumOutputTokens
  ) {
    const error = new Error(
      `The estimated prompt exceeds the safe ${contextLength}-token context budget.`
    );
    error.code = "CONTEXT_BUDGET_EXCEEDED";
    throw error;
  }
  return Math.max(1, Math.min(maxOutputTokens, available));
}

export function logContextDiagnostics(conversationId, diagnostics) {
  if (process.env.NODE_ENV === "production" || !OLLAMA_DEBUG_CONTEXT) return;
  console.info("[Context] inference budget", {
    conversationId: typeof conversationId === "string" ? conversationId : null,
    ...diagnostics,
  });
}

