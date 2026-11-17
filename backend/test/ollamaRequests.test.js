import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { generateAnswer } from "../src/llm/ollama.js";
import {
  chatWithTimeout,
  OLLAMA_CONTEXT_LENGTH,
  OLLAMA_CONTEXT_SAFETY_MARGIN,
  OLLAMA_KEEP_ALIVE,
  OLLAMA_NUM_PREDICT,
  OLLAMA_TEMPERATURE,
} from "../src/llm/ollamaClient.js";
import {
  estimateMessageTokens,
  getOutputTokenLimit,
} from "../src/llm/contextBudget.js";

describe("Ollama request cancellation and timeout", () => {
  it("uses the centralized model, context, generation, keep-alive, and streaming options", async () => {
    let request;
    await generateAnswer(
      "Question?",
      [{ id: 1, title: "Source", url: "https://example.test", text: "Evidence." }],
      {
        ollamaClient: {
          chat: async (params) => {
            request = params;
            return { message: { content: "Grounded answer [Source 1]." } };
          },
        },
      }
    );

    assert.equal(request.stream, true);
    assert.equal(request.keep_alive, OLLAMA_KEEP_ALIVE);
    assert.equal(request.options.num_ctx, OLLAMA_CONTEXT_LENGTH);
    assert.equal(request.options.num_predict, OLLAMA_NUM_PREDICT);
    assert.equal(request.options.temperature, OLLAMA_TEMPERATURE);
    assert.ok(
      estimateMessageTokens(request.messages) +
        request.options.num_predict +
        OLLAMA_CONTEXT_SAFETY_MARGIN <=
        OLLAMA_CONTEXT_LENGTH
    );
  });

  it("rejects a prompt that cannot fit while preserving the current question", () => {
    assert.throws(
      () => getOutputTokenLimit(OLLAMA_CONTEXT_LENGTH),
      { code: "CONTEXT_BUDGET_EXCEEDED" }
    );
  });

  it("times out a pending request and asks the client to abort it", async () => {
    let aborted = false;
    const client = {
      chat: () => new Promise(() => {}),
      abort: () => {
        aborted = true;
      },
    };

    await assert.rejects(
      chatWithTimeout(client, {}, { timeoutMs: 15 }),
      (error) => error.code === "TIMEOUT"
    );
    assert.equal(aborted, true);
  });

  it("aborts the active streaming answer when the caller cancels", async () => {
    let streamAborted = false;
    const controller = new AbortController();
    const client = {
      chat: async () => ({
        abort() {
          streamAborted = true;
        },
        async *[Symbol.asyncIterator]() {
          yield { message: { content: "Partial " } };
          await new Promise((resolve) => setTimeout(resolve, 30));
          yield { message: { content: "answer" } };
        },
      }),
    };
    const request = generateAnswer(
      "Question?",
      [{ id: 1, title: "Source", url: "https://example.test", text: "Evidence." }],
      {
        ollamaClient: client,
        onToken: () => {},
        signal: controller.signal,
      }
    );
    setTimeout(() => controller.abort(), 5);

    await assert.rejects(request, { name: "AbortError" });
    assert.equal(streamAborted, true);
  });
});
