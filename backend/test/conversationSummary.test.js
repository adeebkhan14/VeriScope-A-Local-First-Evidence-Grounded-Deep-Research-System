import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { createConversationStore } from "../src/conversationStore.js";
import {
  buildConversationContext,
  updateConversationSummary,
} from "../src/llm/conversationContext.js";
import {
  OLLAMA_CONTEXT_LENGTH,
  OLLAMA_HISTORY_TOKEN_BUDGET,
  OLLAMA_MODEL,
  OLLAMA_SUMMARY_TOKEN_BUDGET,
} from "../src/llm/ollamaClient.js";

function createStore(dbPath = null) {
  return createConversationStore({
    dbPath:
      dbPath || join(mkdtempSync(join(tmpdir(), "veriscope-summary-")), "chat.db"),
  });
}

function addExchange(store, conversationId, index) {
  const user = store.saveMessage({
    conversationId,
    role: "user",
    content: `Question ${index}: Kubernetes service discovery decision ${index}.`,
  });
  const assistant = store.saveAssistantMessage({
    conversationId,
    content: `Answer ${index}: preserve the service discovery endpoint ${index}.`,
    evidenceReferences:
      index === 0
        ? [
            {
              sourceId: 2,
              chunkId: 77,
              title: "Kubernetes Services",
              url: "https://example.test/services",
              snippet: "A stable service address routes requests to selected Pods.",
            },
          ]
        : [],
  });
  return [user, assistant];
}

describe("Incremental conversation summaries", () => {
  it("summarizes older completed turns incrementally and survives a restart", async () => {
    const dbPath = join(
      mkdtempSync(join(tmpdir(), "veriscope-summary-restart-")),
      "chat.db"
    );
    const store = createStore(dbPath);
    let storeClosed = false;
    const conversation = store.createConversation({ title: "Kubernetes" });
    for (let index = 0; index < 8; index += 1) {
      addExchange(store, conversation.id, index);
    }

    const requests = [];
    const ollamaClient = {
      chat: async (request) => {
        requests.push(request);
        const summaryInput = JSON.parse(request.messages[1].content);
        return {
          message: {
            content: summaryInput.existingSummary
              ? "Incremental summary preserves the original Kubernetes decision and the newer endpoint detail."
              : "The user is discussing Kubernetes service discovery and preserving endpoint decisions.",
          },
        };
      },
    };

    try {
      const firstHistory = store.getConversationMessages(conversation.id, {
        completedOnly: true,
      });
      const firstUpdate = await updateConversationSummary({
        store,
        conversationId: conversation.id,
        messages: firstHistory,
        ollamaClient,
      });
      assert.equal(firstUpdate.updated, true);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].model, OLLAMA_MODEL);
      assert.equal(requests[0].stream, false);
      assert.equal(requests[0].options.num_ctx, OLLAMA_CONTEXT_LENGTH);
      assert.ok(
        requests[0].options.num_predict <= OLLAMA_SUMMARY_TOKEN_BUDGET
      );

      for (let index = 8; index < 11; index += 1) {
        addExchange(store, conversation.id, index);
      }
      const secondHistory = store.getConversationMessages(conversation.id, {
        completedOnly: true,
      });
      const secondUpdate = await updateConversationSummary({
        store,
        conversationId: conversation.id,
        messages: secondHistory,
        ollamaClient,
      });
      assert.equal(secondUpdate.updated, true);
      assert.equal(requests.length, 2);
      assert.match(secondUpdate.summary, /Incremental summary preserves/);
      const secondInput = JSON.parse(requests[1].messages[1].content);
      assert.match(secondInput.existingSummary, /Kubernetes service discovery/);
      assert.doesNotMatch(
        JSON.stringify(secondInput.newCompletedExchanges),
        /Question 0:/
      );

      const storedSummary = store.getConversationSummary(conversation.id);
      assert.equal(
        storedSummary.summarizedThroughMessageId,
        secondHistory[11].id
      );
      const countBeforeRestart = secondHistory.length;
      store.close();
      storeClosed = true;

      const restartedStore = createStore(dbPath);
      try {
        const restoredSummary = restartedStore.getConversationSummary(
          conversation.id
        );
        const restoredMessages = restartedStore.getConversationMessages(
          conversation.id,
          { completedOnly: true }
        );
        assert.equal(restoredSummary.summary, secondUpdate.summary);
        assert.equal(restoredMessages.length, countBeforeRestart);
        const context = buildConversationContext(restoredMessages, {
          summary: restoredSummary.summary,
          currentQuestion: "What are its limitations?",
        });
        assert.equal(context.summaryUsed, true);
        assert.match(context.messages[0].content, /not evidence/);
        assert.equal(context.messagesIncluded, 10);
      } finally {
        restartedStore.close();
      }
    } finally {
      if (!storeClosed) store.close();
    }
  });

  it("backs off after summary failure and still builds bounded recent context", async () => {
    const store = createStore();
    const conversation = store.createConversation({ title: "Fallback" });
    for (let index = 0; index < 8; index += 1) {
      addExchange(store, conversation.id, index);
    }
    let attempts = 0;
    const ollamaClient = {
      chat: async () => {
        attempts += 1;
        throw new Error("local model unavailable");
      },
    };

    try {
      const history = store.getConversationMessages(conversation.id, {
        completedOnly: true,
      });
      const failed = await updateConversationSummary({
        store,
        conversationId: conversation.id,
        messages: history,
        ollamaClient,
      });
      const retried = await updateConversationSummary({
        store,
        conversationId: conversation.id,
        messages: history,
        ollamaClient,
      });
      assert.equal(failed.updated, false);
      assert.equal(retried.updated, false);
      assert.equal(attempts, 1);

      const context = buildConversationContext(history, {
        currentQuestion: "Explain the same service discovery again.",
      });
      assert.equal(context.summaryUsed, false);
      assert.equal(context.messagesIncluded, 10);
      assert.match(context.prompt, /Question 7/);
      assert.doesNotMatch(context.prompt, /Question 0/);
      assert.ok(context.tokenCount <= OLLAMA_HISTORY_TOKEN_BUDGET);
    } finally {
      store.close();
    }
  });

  it("includes relevant stored source excerpts only as unverified context", () => {
    const history = [
      {
        id: "user-1",
        role: "user",
        status: "completed",
        content: "Research Kubernetes Service endpoints.",
      },
      {
        id: "assistant-1",
        role: "assistant",
        status: "completed",
        content: "Services provide stable addresses.",
        evidenceReferences: [
          {
            sourceId: 4,
            chunkId: 91,
            title: "Service documentation",
            url: "https://example.test/services",
            snippet: "A Service exposes a stable endpoint for selected Pods.",
          },
        ],
      },
      {
        id: "failed-user",
        role: "user",
        status: "completed",
        content: "An incomplete prior request.",
      },
      {
        id: "failed-assistant",
        role: "assistant",
        status: "failed",
        content: "This answer must not enter context.",
      },
    ];

    const context = buildConversationContext(history, {
      currentQuestion: "What are its limitations?",
    });
    const prompt = context.messages.map((message) => message.content).join("\n");
    assert.equal(context.evidenceReferencesIncluded, 1);
    assert.match(prompt, /Original source ID: 4; chunk ID: 91/);
    assert.match(prompt, /historical context only; not verified evidence/);
    assert.doesNotMatch(prompt, /This answer must not enter context/);
    assert.equal(context.messagesIncluded, 2);
  });
});
