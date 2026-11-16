import express from "express";
import cors from "cors";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createSearchRouter } from "./routes/search.js";
import { checkServiceHealth } from "./llm/ollamaHealth.js";
import { getMonitoringSnapshot } from "./monitoring.js";

export function createApp({
  researchFn,
  healthCheckFn = checkServiceHealth,
  monitoringFn = getMonitoringSnapshot,
} = {}) {
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