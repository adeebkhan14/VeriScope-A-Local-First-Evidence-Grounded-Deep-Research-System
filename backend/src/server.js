import express from "express";
import cors from "cors";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createSearchRouter } from "./routes/search.js";
import { checkServiceHealth } from "./llm/ollamaHealth.js";
import { getMonitoringSnapshot } from "./monitoring.js";
import { createConversationStore } from "./conversationStore.js";

function createConversationRouter(store) {
  const router = express.Router();

  router.get("/", (req, res) => {
    res.json(store.listConversations());
  });

  router.post("/", (req, res) => {
    try {
      const title = typeof req.body?.title === "string" ? req.body.title.trim() : null;
      const text = typeof req.body?.message === "string" ? req.body.message.trim() : "";
      let conversation;
      if (text) {
        conversation = store.createConversationFromMessage(text);
        const message = store.saveMessage({
          conversationId: conversation.id,
          role: "user",
          content: text,
          status: "completed",
        });
        conversation = { ...conversation, message };
      } else {
        conversation = store.createConversation({ title: title || undefined });
      }
      res.status(201).json(conversation);
    } catch (error) {
      res.status(500).json({
        error: "Conversation creation failed",
        message: error.message,
      });
    }
  });

  router.get("/:conversationId", (req, res) => {
    try {
      const conversation = store.getConversation(req.params.conversationId);
      if (!conversation) {
        return res.status(404).json({
          error: "Conversation not found",
          message: `Conversation ${req.params.conversationId} does not exist.`,
        });
      }
      return res.json(conversation);
    } catch (error) {
      if (error?.code === "CONVERSATION_NOT_FOUND") {
        return res.status(404).json({
          error: "Conversation not found",
          message: error.message,
        });
      }
      return res.status(500).json({
        error: "Conversation lookup failed",
        message: error.message,
      });
    }
  });

  router.delete("/:conversationId", (req, res) => {
    try {
      const result = store.deleteConversation(req.params.conversationId);
      return res.json(result);
    } catch (error) {
      if (error?.code === "CONVERSATION_NOT_FOUND") {
        return res.status(404).json({
          error: "Conversation not found",
          message: error.message,
        });
      }
      return res.status(500).json({
        error: "Conversation deletion failed",
        message: error.message,
      });
    }
  });

  return router;
}

export function createApp({
  researchFn,
  healthCheckFn = checkServiceHealth,
  monitoringFn = getMonitoringSnapshot,
  conversationStore = createConversationStore(),
} = {}) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.use("/api/conversations", createConversationRouter(conversationStore));
  const searchRouter = createSearchRouter(researchFn, { conversationStore });
  app.use("/api/conversations/:conversationId/messages", searchRouter);

  app.get("/", (req, res) => {
    res.json({
      name: "VeriScope API",
      status: "running",
    });
  });

  /**
   * Health check endpoint verifying local service connectivity without model generation.
   */
  app.get("/api/health", async (req, res) => {
    const services = await healthCheckFn();
    res.json({
      status: "online",
      backend: { status: "online" },
      services,
    });
  });

  app.get("/api/monitoring", async (req, res, next) => {
    try {
      return res.json(await monitoringFn());
    } catch (error) {
      return next(error);
    }
  });

  app.use("/api/search", searchRouter);

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);

    if (error?.type === "entity.parse.failed") {
      return res.status(400).json({
        error: "Invalid request",
        message: "Request body must contain valid JSON",
      });
    }

    if (error?.type === "entity.too.large") {
      return res.status(413).json({
        error: "Invalid request",
        message: "Request body is too large",
      });
    }

    console.error("[API] Unhandled request error:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: "The request could not be completed due to an unexpected server error.",
    });
  });

  return app;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const PORT = process.env.PORT || 5001;
  createApp().listen(PORT, () => {
    console.log(`VeriScope backend running on port ${PORT}`);
  });
}