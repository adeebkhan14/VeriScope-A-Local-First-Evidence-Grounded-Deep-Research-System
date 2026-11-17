import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { createConversationStore } from "../src/conversationStore.js";

function createStore() {
  return createConversationStore({
    dbPath: join(mkdtempSync(join(tmpdir(), "veriscope-")), "conversations.db"),
  });
}

describe("Conversation persistence", () => {
  it("creates, stores, and retrieves messages for a conversation", () => {
    const store = createStore();
    const conversation = store.createConversation({ title: "Test conversation" });

    const userMessage = store.saveMessage({
      conversationId: conversation.id,
      role: "user",
      content: "What is the answer?",
    });

    const assistantMessage = store.saveAssistantMessage({
      conversationId: conversation.id,
      content: "The answer is 42.",
      evidenceReferences: [
        { sourceId: 1, chunkId: 7, title: "Source one", url: "https://example.test/1" },
      ],
    });

    assert.equal(conversation.title, "Test conversation");
    assert.equal(userMessage.role, "user");
    assert.equal(assistantMessage.role, "assistant");
    assert.equal(assistantMessage.evidenceReferences.length, 1);

    const retrieved = store.getConversation(conversation.id);
    assert.equal(retrieved.messages.length, 2);
    assert.equal(retrieved.messages[1].content, "The answer is 42.");
  });

  it("deletes conversations and rejects invalid ids", () => {
    const store = createStore();
    const conversation = store.createConversation({ title: "Delete me" });

    const deleted = store.deleteConversation(conversation.id);
    assert.equal(deleted.deleted, true);
    assert.equal(store.getConversation(conversation.id), null);

    assert.throws(() => store.getMessages("missing-id"), /Conversation not found/);
    assert.throws(() => store.deleteConversation("missing-id"), /Conversation not found/);
  });

  it("lists conversations in update order and tracks message counts", () => {
    const store = createStore();
    const first = store.createConversation({ title: "One" });
    const second = store.createConversation({ title: "Two" });

    store.saveMessage({ conversationId: first.id, role: "user", content: "First question" });
    store.saveMessage({ conversationId: second.id, role: "user", content: "Second question" });
    store.saveMessage({ conversationId: second.id, role: "assistant", content: "Second answer" });

    const list = store.listConversations();
    assert.equal(list.length, 2);
    assert.equal(list[0].id, second.id);
    assert.equal(list[0].messageCount, 2);
    assert.equal(list[1].messageCount, 1);
  });

  it("marks abandoned streaming messages failed when reopening the database", () => {
    const dbPath = join(
      mkdtempSync(join(tmpdir(), "veriscope-restart-")),
      "conversations.db"
    );
    const firstStore = createConversationStore({ dbPath });
    const conversation = firstStore.createConversation({
      title: "Interrupted response",
    });
    firstStore.saveMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "",
      status: "streaming",
    });
    firstStore.close();

    const restartedStore = createConversationStore({ dbPath });
    const [message] = restartedStore.getMessages(conversation.id);
    assert.equal(message.status, "failed");
    assert.equal(
      message.content,
      "Research was interrupted by a backend restart."
    );
    restartedStore.close();
  });
});
