import express from "express";
import cors from "cors";
import axios from "axios";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createSearchRouter } from "./routes/search.js";

export function createApp({ researchFn } = {}) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/", (req, res) => {
    res.json({
      name: "VeriScope API",
      status: "running",
    });
  });

  /**
   * Health check endpoint verifying connectivity to local auxiliary services.
   */
  app.get("/api/health", async (req, res) => {
    const checkService = async (url) => {
      try {
        await axios.get(url, { timeout: 5000 });
        return { available: true };
      } catch (err) {
        return { available: false, error: err.code || err.message };
      }
    };

    const searxngUrl = process.env.SEARXNG_URL || "http://localhost:8080";
    const ollamaUrl =
      process.env.OLLAMA_URL || "http://localhost:11434/api/tags";
    const embeddingBaseUrl = process.env.EMBEDDING_URL
      ? process.env.EMBEDDING_URL.replace(/\/embed\/?$/, "")
      : "http://127.0.0.1:8000";

    const [searxng, ollama, embedding] = await Promise.all([
      checkService(`${searxngUrl}/search?q=test&format=json`),
      checkService(ollamaUrl),
      checkService(`${embeddingBaseUrl}/`),
    ]);

    res.json({
      status: "running",
      services: {
        searxng: { ...searxng, url: searxngUrl },
        ollama: { ...ollama, url: "http://localhost:11434" },
        embedding: { ...embedding, url: embeddingBaseUrl },
      },
    });
  });

  app.use("/api/search", createSearchRouter(researchFn));

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