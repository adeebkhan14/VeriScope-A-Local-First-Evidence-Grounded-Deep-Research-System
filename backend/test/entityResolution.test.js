import test from "node:test";
import assert from "node:assert/strict";
import { resolveConversationEntities } from "../src/llm/entityResolution.js";

function exchange(question, answer = "A completed answer.") {
  return [
    { role: "user", content: question, status: "completed" },
    { role: "assistant", content: answer, status: "completed" },
  ];
}

test("resolves he to the only named person in prior conversation", () => {
  const conversation = [
    ...exchange("What is Jensen Huang's role at NVIDIA?", "Jensen Huang is NVIDIA's CEO."),
  ];
  const resolved = resolveConversationEntities(
    "How long has he held that position?",
    conversation
  );
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.resolvedEntity, "Jensen Huang");
  assert.equal(resolved.resolvedQuery.includes("Jensen Huang"), true);
});

test("preserves Jensen Huang across a follow-up without repeating the name", () => {
  const conversation = [
    ...exchange("Did Jensen Huang step down?", "No evidence showed a resignation."),
  ];
  const resolved = resolveConversationEntities(
    "For how long was he CEO?",
    conversation
  );
  assert.equal(resolved.resolvedEntity, "Jensen Huang");
  assert.equal(resolved.resolvedQuery.includes("Jensen Huang"), true);
  assert.equal(resolved.resolvedQuery.includes("tenure"), true);
});

test("flags ambiguous pronouns after a comparison of two people", () => {
  const conversation = [
    ...exchange(
      "Compare Jensen Huang and Tim Cook.",
      "Jensen Huang leads NVIDIA and Tim Cook leads Apple."
    ),
  ];
  const resolved = resolveConversationEntities("How long was he CEO?", conversation);
  assert.equal(resolved.status, "ambiguous");
  assert.equal(resolved.resolvedEntity, null);
});

test("explicit topic switch does not inherit the previous person", () => {
  const conversation = [
    ...exchange("Who is NVIDIA's CEO?", "Jensen Huang is NVIDIA's CEO."),
  ];
  const resolved = resolveConversationEntities(
    "What is the latest Kubernetes version?",
    conversation
  );
  assert.equal(resolved.resolvedEntity, null);
});

