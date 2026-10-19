import express from "express";
import { research } from "../research.js";

export function createSearchRouter(researchFn = research) {
  const router = express.Router();

  router.post("/", async (req, res) => {
    const query = req.body?.query;
    const forceWebSearch = req.body?.forceWebSearch ?? false;

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

    console.log("\n========================================");
    console.log("API REQUEST");
    console.log("========================================");
    console.log("Query:", query.trim());
    if (forceWebSearch) console.log("Force Web Search: true");

    try {
      const result = await researchFn(query.trim(), { forceWebSearch });
      return res.json(result);
    } catch (error) {
      console.error("\nSearch error caught in route handler:", error);

      const message =
        error instanceof Error ? error.message : "An unexpected error occurred";

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