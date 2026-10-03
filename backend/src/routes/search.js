import express from "express";
import { research } from "../research.js";

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const { query } = req.body;

    // Check query
    if (!query || !query.trim()) {
      return res.status(400).json({
        error: "Query is required",
      });
    }

    console.log("\n========================================");
    console.log("API REQUEST");
    console.log("========================================");
    console.log("Query:", query);

    // Run complete research pipeline
    const result = await research(query.trim());

    // Send result to React
    res.json(result);

  } catch (error) {

    console.error("\nSearch error:");
    console.error(error);

    res.status(500).json({
      error: "Research failed",
      message: error.message,
    });
  }
});

export default router;