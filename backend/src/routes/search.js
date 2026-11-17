import express from "express";
import { randomUUID } from "node:crypto";
import { research } from "../research.js";
import { normalizeResearchSettings } from "../retrieval/depth.js";
import { recordResearchMetrics } from "../monitoring.js";

export function createSearchRouter(
  researchFn = research,
  { conversationStore } = {}
) {
  const router = express.Router({ mergeParams: true });
  let researchQueue = Promise.resolve();
  let activeResearchCount = 0;

  async function runSerializedResearch(operation, onWait) {
    const previous = researchQueue;
    let release;
    const turn = new Promise((resolve) => {
      release = resolve;
    });
    researchQueue = previous.then(() => turn);
    if (activeResearchCount > 0) onWait?.();
    await previous;
    activeResearchCount += 1;
    try {
      return await operation();
    } finally {
      activeResearchCount -= 1;
      release();
    }
  }

  router.post("/", async (req, res) => {
    const query = req.body?.query ?? req.body?.content ?? req.body?.message;
    const forceWebSearch = req.body?.forceWebSearch ?? false;
    const depth = req.body?.depth ?? "NORMAL";
    const alpha = req.body?.alpha ?? 0.5;
    const legacyConversation = req.body?.conversation ?? [];
    const pathConversationId = req.params.conversationId;
    const requestedSessionId = pathConversationId ?? req.body?.sessionId;
    const wantsStream =
      req.get("accept")?.includes("text/event-stream") ||
      req.body?.stream === true;

    if (typeof query !== "string" || !query.trim()) {
      return res.status(400).json({
        error: "Invalid request",
        message: "Query must be a non-empty string",
      });
    }

    if (typeof forceWebSearch !== "boolean") {
      return res.status(400).json({
        error: "Invalid request",
        message: "forceWebSearch must be a boolean when provided",
      });
    }

    try {
      normalizeResearchSettings({ depth, alpha });
    } catch (error) {
      return res.status(400).json({
        error: "Invalid request",
        message: error.message,
      });
    }

    if (
      !Array.isArray(legacyConversation) ||
      legacyConversation.length > 32 ||
      legacyConversation.some(
        (message) =>
          !message ||
          !["user", "assistant"].includes(message.role) ||
          typeof message.content !== "string" ||
          message.content.length > 6000
      )
    ) {
      return res.status(400).json({
        error: "Invalid request",
        message: "conversation must contain at most 32 valid user or assistant messages.",
      });
    }

    if (
      requestedSessionId !== undefined &&
      (typeof requestedSessionId !== "string" ||
        requestedSessionId.length === 0 ||
        requestedSessionId.length > 128)
    ) {
      return res.status(400).json({
        error: "Invalid request",
        message: "sessionId must be a non-empty string no longer than 128 characters.",
      });
    }

    const sendEvent = (event, payload) => {
      if (res.destroyed || res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    let conversationId = requestedSessionId;
    let userMessage;
    let assistantMessage;
    let conversationContext = legacyConversation;

    try {
      if (conversationId && conversationStore) {
        if (pathConversationId) {
          const existingConversation =
            conversationStore.getConversation(conversationId);
          if (!existingConversation) {
            return res.status(404).json({
              error: "Conversation not found",
              message: `Conversation ${conversationId} does not exist.`,
            });
          }
        } else {
          conversationStore.ensureConversationWithTitle(
            conversationId,
            query.trim()
          );
        }

        userMessage = conversationStore.saveMessage({
          conversationId,
          role: "user",
          content: query.trim(),
          status: "completed",
        });

        conversationContext = conversationStore
          .getConversationMessages(conversationId, {
            excludeMessageId: userMessage.id,
            completedOnly: true,
          })
          .filter((message) => message.role === "user" || message.role === "assistant")
          .map(({ id, role, content, status, evidenceReferences }) => ({
            id,
            role,
            content,
            status,
            evidenceReferences: evidenceReferences.map((reference) => ({
              sourceId: reference.sourceId,
              title: reference.title,
              url: reference.url,
              chunkId: reference.chunkId,
              snippet: reference.snippet,
            })),
          }));

        assistantMessage = conversationStore.saveMessage({
          conversationId,
          role: "assistant",
          content: "",
          status: "streaming",
        });

        if (
          process.env.NODE_ENV !== "production" &&
          process.env.VERISCOPE_DEBUG_CONVERSATION === "true"
        ) {
          console.info("[Conversation] Ollama context", {
            conversationId,
            messages: [
              ...conversationContext.map(({ role, content }) => ({
                role,
                contentLength: content.length,
              })),
              { role: "user", contentLength: query.trim().length },
            ],
            currentQuestionCount: 1,
          });
        }
      } else if (pathConversationId) {
        return res.status(503).json({
          error: "Conversation storage unavailable",
          message: "Conversation storage is not configured.",
        });
      } else if (!conversationId && conversationStore) {
        conversationId = randomUUID();
        conversationStore.ensureConversationWithTitle(
          conversationId,
          query.trim()
        );
        userMessage = conversationStore.saveMessage({
          conversationId,
          role: "user",
          content: query.trim(),
          status: "completed",
        });
        assistantMessage = conversationStore.saveMessage({
          conversationId,
          role: "assistant",
          content: "",
          status: "streaming",
        });
        conversationContext = [];
      }
    } catch (error) {
      if (error?.code === "CONVERSATION_NOT_FOUND") {
        return res.status(404).json({
          error: "Conversation not found",
          message: error.message,
        });
      }
      console.error("[Conversation] Could not persist user message:", error);
      return res.status(500).json({
        error: "Conversation persistence failed",
        message: "The message could not be saved.",
      });
    }

    const requestController = new AbortController();
    req.once("aborted", () => requestController.abort());
    res.once("close", () => {
      if (!res.writableEnded) requestController.abort();
    });
    const researchOptions = {
      forceWebSearch,
      depth,
      alpha,
      conversation: conversationContext,
      conversationStore,
      sessionId: conversationId,
      signal: requestController.signal,
    };

    const markFailed = (error) => {
      if (!assistantMessage || !conversationStore) return;
      try {
        conversationStore.updateMessage({
          messageId: assistantMessage.id,
          conversationId,
          content:
            error?.code === "ABORT_ERR"
              ? "Research was interrupted."
              : `Research failed: ${error?.message || "Unexpected error."}`,
          status: "failed",
        });
      } catch (persistenceError) {
        console.error(
          "[Conversation] Could not mark assistant message as failed:",
          persistenceError
        );
      }
    };

    const persistResult = (result) => {
      if (!assistantMessage || !conversationStore) return;
      const evidenceReferences = Array.isArray(result?.evidence)
        ? result.evidence.map((evidence) => ({
            sourceId: Number.isInteger(evidence?.id) ? evidence.id : null,
            chunkId: Number.isInteger(evidence?.chunkId)
              ? evidence.chunkId
              : null,
            title:
              typeof evidence?.title === "string" ? evidence.title : null,
            url: typeof evidence?.url === "string" ? evidence.url : null,
            snippet:
              typeof evidence?.text === "string"
                ? evidence.text
                : typeof evidence?.snippet === "string"
                  ? evidence.snippet
                  : null,
          }))
        : [];
      const completed = conversationStore.updateMessage({
        messageId: assistantMessage.id,
        conversationId,
        content: result?.answer,
        status: "completed",
        evidenceReferences,
      });

      if (result?.researchMetadata) {
        conversationStore.saveResearchRun({
          conversationId,
          messageId: completed.id,
          query: query.trim(),
          metadata: result.researchMetadata,
        });
      }
      return completed;
    };

    console.log("\n========================================");
    console.log("API REQUEST");
    console.log("========================================");
    if (process.env.NODE_ENV === "production") {
      console.log("Query length:", query.trim().length);
    } else {
      console.log("Query:", query.trim());
    }
    if (forceWebSearch) console.log("Force Web Search: true");

    try {
      if (!wantsStream) {
        const result = await runSerializedResearch(() =>
          researchFn(query.trim(), researchOptions)
        );
        recordResearchMetrics(result);
        const completedMessage = persistResult(result);
        return res.json({
          ...result,
          sessionId: conversationId ?? result?.sessionId,
          conversationId: conversationId ?? null,
          userMessageId: userMessage?.id,
          assistantMessageId: completedMessage?.id,
        });
      }

      res.status(200).set({
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();

      const result = await runSerializedResearch(
        () =>
          researchFn(query.trim(), {
            ...researchOptions,
            onProgress: (message) => sendEvent("status", { message }),
            onToken: (text) => sendEvent("token", { text }),
          }),
        () => sendEvent("status", { message: "Waiting for the local model..." })
      );
      recordResearchMetrics(result);
      const completedMessage = persistResult(result);
      sendEvent("done", {
        result: {
          ...result,
          sessionId: conversationId ?? result?.sessionId,
          conversationId: conversationId ?? null,
          userMessageId: userMessage?.id,
          assistantMessageId: completedMessage?.id,
        },
      });
      return res.end();
    } catch (error) {
      markFailed(error);
      if (requestController.signal.aborted || res.destroyed) return;
      if (process.env.NODE_ENV === "production") {
        console.error("[Search] Research request failed", {
          code: error?.code || "UNKNOWN",
          service: error?.service || null,
        });
      } else {
        console.error("\nSearch error caught in route handler:", error);
      }

      const message =
        error instanceof Error ? error.message : "An unexpected error occurred";

      if (wantsStream && res.headersSent) {
        const errorPayload =
          error?.code === "SERVICE_UNAVAILABLE" ||
          error?.code === "TIMEOUT" ||
          error?.code === "UPSTREAM_ERROR" ||
          error?.code === "UPSTREAM_INVALID_RESPONSE" ||
          error?.code === "CONTEXT_BUDGET_EXCEEDED"
            ? {
                error: error.message,
                service: error.service,
                code: error.code,
              }
            : {
                error:
                  "Research could not be completed due to an unexpected server error.",
                code: "RESEARCH_FAILED",
              };
        sendEvent("error", errorPayload);
        return res.end();
      }

      if (error?.code === "CONTEXT_BUDGET_EXCEEDED") {
        return res.status(413).json({
          error: "Context budget exceeded",
          code: error.code,
          message,
        });
      }

      if (error?.code === "SERVICE_UNAVAILABLE") {
        return res.status(503).json({
          error: "Service unavailable",
          service: error.service,
          message,
        });
      }

      if (error?.code === "TIMEOUT") {
        return res.status(504).json({
          error: "Request timed out",
          service: error.service,
          message,
        });
      }

      if (
        error?.code === "UPSTREAM_ERROR" ||
        error?.code === "UPSTREAM_INVALID_RESPONSE"
      ) {
        return res.status(502).json({
          error: "Upstream service error",
          service: error.service,
          message,
        });
      }

      return res.status(500).json({
        error: "Research failed",
        message: "Research could not be completed due to an unexpected server error.",
      });
    }
  });

  return router;
}

export default createSearchRouter();
