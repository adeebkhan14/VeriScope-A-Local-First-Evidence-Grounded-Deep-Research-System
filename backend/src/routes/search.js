import express from "express";
import { research } from "../research.js";
import { normalizeResearchSettings } from "../retrieval/depth.js";
import { recordResearchMetrics } from "../monitoring.js";

export function createSearchRouter(researchFn = research) {
  const router = express.Router();
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
    const query = req.body?.query;
    const forceWebSearch = req.body?.forceWebSearch ?? false;
    const depth = req.body?.depth ?? "NORMAL";
    const alpha = req.body?.alpha ?? 0.5;
    const conversation = req.body?.conversation ?? [];
    const sessionId = req.body?.sessionId;
    const wantsStream = req.get("accept")?.includes("text/event-stream");

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
      !Array.isArray(conversation) ||
      conversation.length > 32 ||
      conversation.some(
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
      sessionId !== undefined &&
      (typeof sessionId !== "string" || sessionId.length > 128)
    ) {
      return res.status(400).json({
        error: "Invalid request",
        message: "sessionId must be a string no longer than 128 characters.",
      });
    }

    console.log("\n========================================");
    console.log("API REQUEST");
    console.log("========================================");
    console.log("Query:", query.trim());
    if (forceWebSearch) console.log("Force Web Search: true");

    const sendEvent = (event, payload) => {
      if (res.destroyed || res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    const requestController = new AbortController();
    req.once("aborted", () => requestController.abort());
    res.once("close", () => {
      if (!res.writableEnded) requestController.abort();
    });
    const researchOptions = {
      forceWebSearch,
      depth,
      alpha,
      conversation,
      sessionId,
      signal: requestController.signal,
    };

    try {
      if (!wantsStream) {
        const result = await runSerializedResearch(() =>
          researchFn(query.trim(), researchOptions)
        );
        recordResearchMetrics(result);
        return res.json(result);
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
      sendEvent("done", { result });
      return res.end();
    } catch (error) {
      if (requestController.signal.aborted || res.destroyed) return;
      console.error("\nSearch error caught in route handler:", error);

      const message =
        error instanceof Error ? error.message : "An unexpected error occurred";

      if (wantsStream && res.headersSent) {
        const errorPayload =
          error?.code === "SERVICE_UNAVAILABLE" ||
          error?.code === "TIMEOUT" ||
          error?.code === "UPSTREAM_ERROR" ||
          error?.code === "UPSTREAM_INVALID_RESPONSE"
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