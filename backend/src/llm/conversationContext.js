import { estimateTokenCount } from "../retrieval/depth.js";

const MAX_MESSAGES = 32;
const MAX_MESSAGE_LENGTH = 6000;
const MAX_EVIDENCE_REFERENCES = 4;
const DEFAULT_HISTORY_TOKEN_BUDGET = 600;

function normalizeMessage(message) {
  if (
    !message ||
    (message.role !== "user" && message.role !== "assistant") ||
    typeof message.content !== "string"
  ) {
    return null;
  }

  const content = message.content.trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!content) return null;

  const evidenceReferences = Array.isArray(message.evidenceReferences)
    ? message.evidenceReferences
        .slice(0, MAX_EVIDENCE_REFERENCES)
        .filter(
          (reference) =>
            reference &&
            typeof reference.title === "string" &&
            typeof reference.url === "string"
        )
        .map((reference) => ({
          title: reference.title.trim().slice(0, 200),
          url: reference.url.trim().slice(0, 500),
          chunkId: Number.isInteger(reference.chunkId) ? reference.chunkId : null,
        }))
    : [];

  return { role: message.role, content, evidenceReferences };
}

function formatMessage(message) {
  const role = message.role === "user" ? "User" : "Assistant";
  const references = message.evidenceReferences.length
    ? `\nPrior research references (context only): ${message.evidenceReferences
        .map(
          (reference) =>
            `${reference.title} (${reference.url})${
              reference.chunkId === null ? "" : `, chunk ${reference.chunkId}`
            }`
        )
        .join("; ")}`
    : "";
  return `${role}: ${message.content}${references}`;
}

function summarizeMessage(message) {
  const firstSentence =
    message.content.match(/^.{1,280}?(?:[.!?](?=\s|$)|$)/)?.[0] ??
    message.content.slice(0, 280);
  const role = message.role === "user" ? "Earlier question" : "Earlier answer";
  return `${role}: ${firstSentence.trim()}`;
}

export function buildConversationContext(
  messages,
  { tokenBudget = DEFAULT_HISTORY_TOKEN_BUDGET } = {}
) {
  const validMessages = Array.isArray(messages)
    ? messages.slice(-MAX_MESSAGES).map(normalizeMessage).filter(Boolean)
    : [];
  if (validMessages.length === 0) {
    return {
      prompt: "",
      tokenCount: 0,
      messagesIncluded: 0,
      summarizedMessages: 0,
    };
  }

  const recentBudget = Math.floor(tokenBudget * 0.75);
  const recent = [];
  let recentTokens = 0;
  let firstRecentIndex = validMessages.length;

  for (let index = validMessages.length - 1; index >= 0; index -= 1) {
    const formatted = formatMessage(validMessages[index]);
    const messageTokens = estimateTokenCount(formatted);
    if (recentTokens + messageTokens > recentBudget) break;
    recent.unshift(formatted);
    recentTokens += messageTokens;
    firstRecentIndex = index;
  }

  const olderMessages = validMessages.slice(0, firstRecentIndex);
  let summary = "";
  let summaryTokens = 0;
  if (olderMessages.length > 0) {
    const summaryLines = olderMessages.map(summarizeMessage);
    const candidateSummary = `Earlier conversation summary:\n${summaryLines.join("\n")}`;
    const remaining = Math.max(0, tokenBudget - recentTokens);
    if (estimateTokenCount(candidateSummary) <= remaining) {
      summary = candidateSummary;
      summaryTokens = estimateTokenCount(candidateSummary);
    } else {
      const shortened = summaryLines
        .map((line) => line.slice(0, 120))
        .join("\n");
      const shortenedSummary = `Earlier conversation summary:\n${shortened}`;
      if (estimateTokenCount(shortenedSummary) <= remaining) {
        summary = shortenedSummary;
        summaryTokens = estimateTokenCount(shortenedSummary);
      }
    }
  }

  const sections = [];
  if (summary) sections.push(summary);
  if (recent.length > 0) {
    sections.push(`Recent conversation:\n${recent.join("\n")}`);
  }
  const prompt = sections.join("\n\n");

  return {
    prompt,
    tokenCount: estimateTokenCount(prompt),
    messagesIncluded: recent.length,
    summarizedMessages: summary ? olderMessages.length : 0,
    summaryTokens,
  };
}
