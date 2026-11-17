import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { describe, it } from "node:test";

import { createApp } from "../src/server.js";
import { createConversationStore } from "../src/conversationStore.js";
import { generateAnswer, tryDirectAnswer } from "../src/llm/ollama.js";

async function createHarness(researchFn, dbPath = null) {
  const resolvedDbPath =
    dbPath || join(mkdtempSync(join(tmpdir(), "veriscope-chat-")), "chat.db");
  const store = createConversationStore({ dbPath: resolvedDbPath });
  const app = createApp({
    researchFn,
    conversationStore: store,
    healthCheckFn: async () => ({}),
    monitoringFn: async () => ({}),
  });
  const server = app.listen(0);
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  return {
    baseUrl,
    dbPath: resolvedDbPath,
    store,
    close: async () => {
      if (server.listening) {
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        );
      }
      store.close();
    },
  };
}

async function postMessage(
  baseUrl,
  conversationId,
  query,
  { stream = false, signal } = {}
) {
  return fetch(
    `${baseUrl}/api/conversations/${conversationId}/messages`,
    {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        ...(stream ? { Accept: "text/event-stream" } : {}),
      },
      body: JSON.stringify({ query }),
    }
  );
}

describe("Conversation-aware research requests", () => {
  it("retrieves only prior turns in chronological order across follow-up questions", async () => {
    const observedHistory = [];
    const harness = await createHarness(async (query, options) => {
      observedHistory.push({ query, messages: options.conversation });
      return {
        query,
        answer: `Answer to: ${query}`,
        citations: [],
        evidence:
          query === "What is Kubernetes service discovery?"
            ? [
                {
                  id: 1,
                  chunkId: 7,
                  title: "Kubernetes networking",
                  url: "https://example.test/kubernetes",
                  text: "Services provide stable network discovery.",
                },
              ]
            : [],
      };
    });

    try {
      const conversation = harness.store.createConversation({
        title: "Kubernetes service discovery",
      });
      const questions = [
        "What is Kubernetes service discovery?",
        "Explain it in simpler terms.",
        "Give me a practical example.",
        "What are its limitations?",
      ];

      for (const question of questions) {
        const response = await postMessage(
          harness.baseUrl,
          conversation.id,
          question
        );
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.equal(result.conversationId, conversation.id);
        assert.equal(result.answer, `Answer to: ${question}`);
      }

      assert.deepEqual(
        observedHistory.map(({ messages }) =>
          messages.map(({ role, content }) => [role, content])
        ),
        [
          [],
          [
            ["user", questions[0]],
            ["assistant", `Answer to: ${questions[0]}`],
          ],
          [
            ["user", questions[0]],
            ["assistant", `Answer to: ${questions[0]}`],
            ["user", questions[1]],
            ["assistant", `Answer to: ${questions[1]}`],
          ],
          [
            ["user", questions[0]],
            ["assistant", `Answer to: ${questions[0]}`],
            ["user", questions[1]],
            ["assistant", `Answer to: ${questions[1]}`],
            ["user", questions[2]],
            ["assistant", `Answer to: ${questions[2]}`],
          ],
        ]
      );
      assert.deepEqual(
        observedHistory[1].messages[1].evidenceReferences,
        [
          {
            sourceId: 1,
            title: "Kubernetes networking",
            url: "https://example.test/kubernetes",
            chunkId: 7,
            snippet: "Services provide stable network discovery.",
          },
        ]
      );
      assert.equal(
        harness.store.getConversation(conversation.id).messages.length,
        8
      );
    } finally {
      await harness.close();
    }
  });

  it("keeps new and separate conversations isolated", async () => {
    let captured;
    const harness = await createHarness(async (query, options) => {
      captured = { query, messages: options.conversation };
      return { answer: `Answer to ${query}`, citations: [], evidence: [] };
    });

    try {
      const first = harness.store.createConversation({ title: "First" });
      const second = harness.store.createConversation({ title: "Second" });
      harness.store.saveMessage({
        conversationId: first.id,
        role: "user",
        content: "First conversation topic",
      });
      harness.store.saveAssistantMessage({
        conversationId: first.id,
        content: "First conversation answer",
      });

      const response = await postMessage(
        harness.baseUrl,
        second.id,
        "What did we discuss?"
      );
      assert.equal(response.status, 200);
      assert.deepEqual(captured.messages, []);

      const firstResponse = await postMessage(
        harness.baseUrl,
        first.id,
        "Continue the first topic."
      );
      assert.equal(firstResponse.status, 200);
      assert.deepEqual(
        captured.messages.map(({ content }) => content),
        ["First conversation topic", "First conversation answer"]
      );
    } finally {
      await harness.close();
    }
  });

  it("loads conversation history after recreating the store and backend", async () => {
    const dbPath = join(
      mkdtempSync(join(tmpdir(), "veriscope-restart-")),
      "chat.db"
    );
    const firstHarness = await createHarness(async (_query, options) => ({
      answer: "Initial response",
      citations: [],
      evidence: [],
    }), dbPath);
    const conversation = firstHarness.store.createConversation({
      title: "Persistent conversation",
    });

    try {
      await postMessage(
        firstHarness.baseUrl,
        conversation.id,
        "First question"
      );
    } finally {
      await firstHarness.close();
    }

    let receivedHistory;
    const restartedHarness = await createHarness(async (_query, options) => {
      receivedHistory = options.conversation;
      return { answer: "Follow-up response", citations: [], evidence: [] };
    }, dbPath);

    try {
      const response = await postMessage(
        restartedHarness.baseUrl,
        conversation.id,
        "Follow-up question"
      );
      assert.equal(response.status, 200);
      assert.deepEqual(
        receivedHistory.map(({ role, content }) => [role, content]),
        [
          ["user", "First question"],
          ["assistant", "Initial response"],
        ]
      );
    } finally {
      await restartedHarness.close();
    }
  });

  it("rejects unknown conversations without invoking research", async () => {
    let invoked = false;
    const harness = await createHarness(async () => {
      invoked = true;
      return {};
    });

    try {
      const response = await postMessage(
        harness.baseUrl,
        "missing-conversation",
        "Question?"
      );
      assert.equal(response.status, 404);
      assert.equal(invoked, false);
    } finally {
      await harness.close();
    }
  });

  it("returns an explicit error when the context budget cannot preserve the question", async () => {
    const harness = await createHarness(async () => {
      const error = new Error("The estimated prompt exceeds the safe context budget.");
      error.code = "CONTEXT_BUDGET_EXCEEDED";
      throw error;
    });

    try {
      const conversation = harness.store.createConversation({
        title: "Context overflow",
      });
      const response = await postMessage(
        harness.baseUrl,
        conversation.id,
        "A question too large for the configured context."
      );
      const result = await response.json();

      assert.equal(response.status, 413);
      assert.equal(result.code, "CONTEXT_BUDGET_EXCEEDED");
      const messages = harness.store.getConversationMessages(conversation.id);
      assert.equal(messages.at(-1).status, "failed");
    } finally {
      await harness.close();
    }
  });

  it("preserves successful token and done SSE events and persists one assistant message", async () => {
    const harness = await createHarness(async (query, options) => {
      options.onProgress("Generating answer...");
      options.onToken("A streamed ");
      options.onToken("answer.");
      return {
        query,
        answer: "A streamed answer.",
        citations: [],
        evidence: [],
      };
    });

    try {
      const conversation = harness.store.createConversation({
        title: "Streaming response",
      });
      const response = await postMessage(
        harness.baseUrl,
        conversation.id,
        "Stream this answer.",
        { stream: true }
      );
      const body = await response.text();

      assert.equal(response.status, 200);
      assert.match(body, /event: status/);
      assert.match(body, /event: token\ndata: {"text":"A streamed "}/);
      assert.match(body, /event: done\ndata: {"result":/);
      const persisted = harness.store.getMessages(conversation.id);
      assert.equal(persisted.length, 2);
      assert.equal(persisted[1].role, "assistant");
      assert.equal(persisted[1].content, "A streamed answer.");
      assert.equal(persisted[1].status, "completed");
    } finally {
      await harness.close();
    }
  });

  it("marks failed inference as failed and streams a useful error event", async () => {
    const harness = await createHarness(async () => {
      const error = new Error("Local Ollama is unavailable.");
      error.code = "SERVICE_UNAVAILABLE";
      error.service = "Ollama";
      throw error;
    });

    try {
      const conversation = harness.store.createConversation({
        title: "Unavailable model",
      });
      const response = await postMessage(
        harness.baseUrl,
        conversation.id,
        "A question",
        { stream: true }
      );
      const body = await response.text();

      assert.equal(response.status, 200);
      assert.match(body, /event: error/);
      assert.match(body, /Local Ollama is unavailable/);
      const messages = harness.store.getMessages(conversation.id);
      assert.equal(messages.at(-1).role, "assistant");
      assert.equal(messages.at(-1).status, "failed");
    } finally {
      await harness.close();
    }
  });

  it("marks a disconnected streaming request as interrupted", async () => {
    let started;
    const startedPromise = new Promise((resolve) => {
      started = resolve;
    });
    const harness = await createHarness(
      (_query, options) =>
        new Promise((resolve, reject) => {
          options.signal.addEventListener(
            "abort",
            () => {
              const error = new Error("Request interrupted.");
              error.code = "ABORT_ERR";
              reject(error);
            },
            { once: true }
          );
          started();
        })
    );

    try {
      const conversation = harness.store.createConversation({
        title: "Interrupted stream",
      });
      const controller = new AbortController();
      const pendingResponse = postMessage(
        harness.baseUrl,
        conversation.id,
        "A long question",
        { stream: true, signal: controller.signal }
      );
      await startedPromise;
      controller.abort();
      await assert.rejects(pendingResponse);
      await new Promise((resolve) => setTimeout(resolve, 20));

      const messages = harness.store.getMessages(conversation.id);
      assert.equal(messages.at(-1).role, "assistant");
      assert.equal(messages.at(-1).status, "failed");
      assert.equal(messages.at(-1).content, "Research was interrupted.");
    } finally {
      await harness.close();
    }
  });
});

describe("Ollama role-based follow-up context", () => {
  it("sends prior turns and the current question once to direct-answer inference", async () => {
    let request;
    const history = [
      { role: "user", content: "What is Kubernetes service discovery?" },
      { role: "assistant", content: "It helps services locate each other." },
    ];

    await tryDirectAnswer("Explain it in simpler terms.", {
      conversationMessages: history,
      ollamaClient: {
        chat: async (params) => {
          request = params;
          return {
            message: { content: "It is like a built-in address book." },
          };
        },
      },
    });

    assert.deepEqual(
      request.messages.map(({ role }) => role),
      ["system", "user", "assistant", "user"]
    );
    assert.match(request.messages[0].content, /SEARCH_REQUIRED/);
    assert.deepEqual(request.messages.slice(1).map(({ content }) => content), [
      history[0].content,
      history[1].content,
      "Explain it in simpler terms.",
    ]);
  });

  it("retains citation instructions and validates research answers with prior turns", async () => {
    let request;
    const history = [
      { role: "user", content: "What is Kubernetes service discovery?" },
      { role: "assistant", content: "It lets services find each other." },
    ];

    const result = await generateAnswer(
      "Give me a practical example.",
      [
        {
          id: 1,
          title: "Kubernetes docs",
          url: "https://example.test/kubernetes",
          text: "A Service exposes a stable endpoint for selected Pods.",
        },
      ],
      {
        conversationMessages: history,
        ollamaClient: {
          chat: async (params) => {
            request = params;
            return {
              message: {
                content:
                  "A Service gives clients a stable endpoint for Pods [Source 1].",
              },
            };
          },
        },
      }
    );

    assert.deepEqual(
      request.messages.map(({ role }) => role),
      ["system", "user", "assistant", "user"]
    );
    assert.match(request.messages[0].content, /Every factual statement must cite/);
    assert.match(request.messages.at(-1).content, /Give me a practical example\./);
    assert.match(request.messages.at(-1).content, /Evidence passage:/);
    assert.equal(
      request.messages
        .map(({ content }) => content)
        .join("\n")
        .split("Give me a practical example.").length - 1,
      1
    );
    assert.equal(result.answer, "A Service gives clients a stable endpoint for Pods [Source 1].");
    assert.deepEqual(result.citedSourceIds, [1]);
  });
});
