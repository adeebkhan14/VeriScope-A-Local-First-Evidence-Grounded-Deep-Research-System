import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConversationStore } from "../src/conversationStore.js";

function temporaryStore(t) {
  const directory = mkdtempSync(join(tmpdir(), "veriscope-store-"));
  const store = createConversationStore({ dbPath: join(directory, "veriscope.db") });
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return store;
}

test("persists a conversation with a streaming message and evidence atomically", (t) => {
  const store = temporaryStore(t);
  const conversation = store.createConversation({ title: "Evidence test" });

  const assistant = store.saveMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: "",
    status: "streaming",
  });
  assert.equal(assistant.status, "streaming");

  const completed = store.updateMessage({
    conversationId: conversation.id,
    messageId: assistant.id,
    content: "A grounded answer.",
    status: "completed",
    evidenceReferences: [
      {
        sourceId: 1,
        chunkId: 3,
        title: "Example source",
        url: "https://example.com/article",
        snippet: "Supporting passage.",
        evidenceId: "original-evidence-id",
        originalCreatedAt: "2026-11-20T12:00:00.000Z",
        originalResearchTurn: "assistant-original-turn",
        reused: true,
      },
    ],
  });

  assert.equal(completed.status, "completed");
  assert.equal(completed.evidenceReferences.length, 1);
  assert.equal(completed.evidenceReferences[0].sourceId, 1);
  assert.equal(completed.evidenceReferences[0].evidenceId, "original-evidence-id");
  assert.equal(completed.evidenceReferences[0].originalCreatedAt, "2026-11-20T12:00:00.000Z");
  assert.equal(completed.evidenceReferences[0].reused, true);

  const restored = store.getConversation(conversation.id);
  assert.equal(restored.messages.find((message) => message.id === assistant.id).status, "completed");
  assert.equal(restored.messages.find((message) => message.id === assistant.id).evidenceReferences.length, 1);
});

test("rejects empty completed messages and leaves existing data unchanged", (t) => {
  const store = temporaryStore(t);
  const conversation = store.createConversation();
  const message = store.saveMessage({
    conversationId: conversation.id,
    role: "user",
    content: "Original question",
  });

  assert.throws(
    () => store.updateMessage({
      conversationId: conversation.id,
      messageId: message.id,
      content: "",
      status: "completed",
    }),
    (error) => error.code === "INVALID_MESSAGE"
  );

  const restored = store.getConversation(conversation.id);
  assert.equal(restored.messages[0].content, "Original question");
});
