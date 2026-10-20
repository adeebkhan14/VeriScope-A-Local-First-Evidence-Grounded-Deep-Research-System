import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

import { createApp } from "../src/server.js";
import { research } from "../src/research.js";

let nextResearch = async (query, options) => ({ query, options });
const app = createApp({ researchFn: (...args) => nextResearch(...args) });
let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server?.listening) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

async function postSearch(body, rawBody) {
  return fetch(`${baseUrl}/api/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: rawBody ?? JSON.stringify(body),
  });
}

describe("Search API error handling", () => {
  it("rejects empty queries without starting research", async () => {
    let called = false;
    nextResearch = async () => {
      called = true;
    };

    const response = await postSearch({ query: "  " });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Invalid request",
      message: "Query must be a non-empty string",
    });
    assert.equal(called, false);
  });

  it("requires forceWebSearch to be a boolean", async () => {
    const response = await postSearch({
      query: "valid query",
      forceWebSearch: "true",
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /must be a boolean/);
  });

  it("returns a JSON error for malformed request bodies", async () => {
    const response = await postSearch(null, "{");
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Invalid request",
      message: "Request body must contain valid JSON",
    });
  });

  it("maps unavailable upstream services to 503", async () => {
    nextResearch = async () => {
      const error = new Error("SearXNG is unavailable.");
      error.code = "SERVICE_UNAVAILABLE";
      error.service = "SearXNG";
      throw error;
    };

    const response = await postSearch({ query: "valid query" });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "Service unavailable",
      service: "SearXNG",
      message: "SearXNG is unavailable.",
    });
  });

  it("maps existing upstream timeout failures to 504", async () => {
    nextResearch = async () => {
      const error = new Error("SearXNG request timed out.");
      error.code = "TIMEOUT";
      error.service = "SearXNG";
      throw error;
    };

    const response = await postSearch({ query: "valid query" });
    assert.equal(response.status, 504);
    assert.deepEqual(await response.json(), {
      error: "Request timed out",
      service: "SearXNG",
      message: "SearXNG request timed out.",
    });
  });

  it("maps invalid upstream responses to 502", async () => {
    nextResearch = async () => {
      const error = new Error("SearXNG returned an invalid response.");
      error.code = "UPSTREAM_INVALID_RESPONSE";
      error.service = "SearXNG";
      throw error;
    };

    const response = await postSearch({ query: "valid query" });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: "Upstream service error",
      service: "SearXNG",
      message: "SearXNG returned an invalid response.",
    });
  });

  it("does not expose unexpected internal errors to API clients", async () => {
    nextResearch = async () => {
      throw new Error("private database path");
    };

    const response = await postSearch({ query: "valid query" });
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.error, "Research failed");
    assert.doesNotMatch(JSON.stringify(body), /private database path/);
  });
});

describe("Research recovery from scraper failures", () => {
  it("continues with usable pages when another scrape rejects", async () => {
    const ollamaClient = {
      chat: async ({ messages }) => {
        if (messages[0].content.includes("evidence-sufficiency evaluator")) {
          return {
            message: {
              content: JSON.stringify({
                sufficient: true,
                reason: "The source contains relevant details.",
                missing: null,
              }),
            },
          };
        }
        return {
          message: { content: "The source provides the answer [Source 1]." },
        };
      },
    };
    const snippet =
      "Research sources explain that reliable error handling makes search systems " +
      "recoverable. Clear validation messages help users correct bad requests, " +
      "while continuing after one failed page preserves useful evidence from " +
      "other sources. This source describes predictable failures and useful " +
      "recovery behavior for web research applications.";

    const result = await research("error handling", {
      forceWebSearch: true,
      ollamaClient,
      embeddingsFn: async () => ({ embeddings: null, available: false }),
      discoverFn: async () => [
        {
          title: "Unavailable page",
          url: "https://example.test/unavailable",
          content: snippet,
        },
        {
          title: "Usable page",
          url: "https://example.test/usable",
        },
      ],
      scrapeFn: async (page) => {
        if (page.title === "Unavailable page") {
          throw new Error("Connection reset");
        }
        return { ...page, content: snippet };
      },
    });

    assert.equal(result.searchedWeb, true);
    assert.equal(result.answeredByLLM, false);
    assert.ok(result.citations.length > 0);
    assert.ok(
      result.warnings.some((warning) =>
        warning.includes("Connection reset. Used the search snippet instead.")
      )
    );
  });
});
