import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkOllamaHealth,
  isValidOllamaModelName,
} from "../src/llm/ollamaHealth.js";
import { classifyOllamaError } from "../src/llm/ollamaClient.js";
import { generateAnswer } from "../src/llm/ollama.js";

describe("Ollama health and failure classification", () => {
  it("reports Ollama online when the configured model is installed", async () => {
    const health = await checkOllamaHealth({
      url: "http://ollama.test",
      model: "qwen3.5:9b",
      get: async (url, options) => {
        assert.equal(url, "http://ollama.test/api/tags");
        assert.equal(options.timeout, 4000);
        return { data: { models: [{ name: "qwen3.5:9b" }] } };
      },
    });

    assert.equal(health.status, "online");
    assert.equal(health.reachable, true);
    assert.equal(health.available, true);
    assert.deepEqual(health.model, {
      name: "qwen3.5:9b",
      installed: true,
      status: "online",
    });
  });

  it("reports a missing model separately from server connectivity", async () => {
    const health = await checkOllamaHealth({
      url: "http://ollama.test",
      model: "qwen3.5:9b",
      get: async () => ({ data: { models: [{ name: "llama3.2:3b" }] } }),
    });

    assert.equal(health.status, "model_missing");
    assert.equal(health.reachable, true);
    assert.equal(health.available, true);
    assert.equal(health.model.installed, false);
    assert.match(health.error, /ollama pull qwen3\.5:9b/);
  });

  it("rejects malformed model names without reporting Ollama offline", async () => {
    const health = await checkOllamaHealth({
      url: "http://ollama.test",
      model: "bad model name",
      get: async () => ({ data: { models: [] } }),
    });

    assert.equal(isValidOllamaModelName("qwen3.5:9b"), true);
    assert.equal(isValidOllamaModelName("bad model name"), false);
    assert.equal(health.status, "error");
    assert.equal(health.reachable, true);
    assert.equal(health.errorCode, "INVALID_MODEL_NAME");
  });

  it("distinguishes an unreachable host from a health request timeout", async () => {
    const offline = await checkOllamaHealth({
      get: async () => {
        throw Object.assign(new Error("connect ECONNREFUSED"), {
          code: "ECONNREFUSED",
        });
      },
    });
    const timedOut = await checkOllamaHealth({
      get: async () => {
        throw Object.assign(new Error("timeout of 4000ms exceeded"), {
          code: "ECONNABORTED",
        });
      },
    });

    assert.equal(offline.status, "offline");
    assert.equal(offline.errorCode, "OLLAMA_UNREACHABLE");
    assert.equal(timedOut.status, "error");
    assert.equal(timedOut.errorCode, "OLLAMA_TIMEOUT");
  });

  it("treats a failed loopback bridge as unreachable, not a missing model", () => {
    const failure = classifyOllamaError({
      message: "Request failed with status code 502",
      response: {
        status: 502,
        data: {
          code: "OLLAMA_UPSTREAM_UNAVAILABLE",
          error: "Ollama loopback listener is unavailable.",
        },
      },
    });

    assert.equal(failure.status, "offline");
    assert.equal(failure.code, "OLLAMA_UNREACHABLE");
  });

  it("uses Qwen with thinking disabled and reports generation model errors distinctly", async () => {
    let request;
    const result = await generateAnswer("Question?", [
      { id: 1, title: "Source", url: "https://example.test", text: "Evidence." },
    ], {
      ollamaClient: {
        chat: async (params) => {
          request = params;
          throw new Error("model 'qwen3.5:9b' not found, try pulling it first");
        },
      },
    });

    assert.equal(request.model, "qwen3.5:9b");
    assert.equal(request.think, false);
    assert.equal(result.llmError.status, "model_missing");
    assert.match(result.answer, /Ollama is reachable/);
    assert.match(result.answer, /ollama pull qwen3\.5:9b/);
  });

  it("reports generation failures separately from service connectivity", async () => {
    const result = await generateAnswer("Question?", [
      { id: 1, title: "Source", url: "https://example.test", text: "Evidence." },
    ], {
      ollamaClient: {
        chat: async () => {
          throw new Error("The Ollama runner exited unexpectedly.");
        },
      },
    });

    assert.equal(result.llmError.status, "error");
    assert.equal(result.llmError.code, "OLLAMA_REQUEST_FAILED");
    assert.match(result.llmError.message, /runner exited unexpectedly/);
  });
});
