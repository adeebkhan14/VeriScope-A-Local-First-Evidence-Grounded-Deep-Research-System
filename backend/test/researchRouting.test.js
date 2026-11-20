import test from "node:test";
import assert from "node:assert/strict";
import {
  decideResearchRoute,
  routeResearchQuery,
} from "../src/llm/researchRouting.js";

test("routes stable explanations to local knowledge", () => {
  const decision = routeResearchQuery("What is Kubernetes?");
  assert.equal(decision.category, "local_knowledge");
});

test("routes explicit freshness requests to web research", () => {
  const decision = routeResearchQuery("What is the latest Kubernetes version?");
  assert.equal(decision.category, "new_research");
});

test("forced web search bypasses local routing", async () => {
  const decision = await decideResearchRoute("Explain Kubernetes", {
    forceWebSearch: true,
  });
  assert.equal(decision.route, "WEB");
  assert.equal(decision.requiresFreshEvidence, true);
  assert.equal(decision.category, "new_research");
});

test("reformulation requests reuse conversation-only context", () => {
  const conversation = [
    { role: "user", content: "What is Kubernetes?", status: "completed" },
    { role: "assistant", content: "A container orchestration system.", status: "completed" },
  ];
  const decision = routeResearchQuery("Explain that in simpler terms.", { conversation });
  assert.equal(decision.category, "conversation_only");
});

test("ambiguous references without conversation history ask for clarification", () => {
  const decision = routeResearchQuery("Explain that in simpler terms.");
  assert.equal(decision.category, "ambiguous");
});

test("freshness rule is deterministic for current facts", async () => {
  const decision = await decideResearchRoute("What is NVIDIA's current market cap?");
  assert.equal(decision.route, "WEB");
  assert.equal(decision.category, "new_research");
  assert.equal(decision.requiresFreshEvidence, true);
});

test("Jensen Huang tenure follow-up resolves a targeted query", async () => {
  const conversation = [
    { role: "user", content: "Did Jensen Huang step down as CEO?", status: "completed" },
    { role: "assistant", content: "No evidence confirmed a resignation.", status: "completed" },
  ];
  const decision = await decideResearchRoute("For how long was he the CEO?", {
    conversation,
  });
  assert.equal(decision.resolvedEntities[0].canonicalName, "Jensen Huang");
  assert.equal(decision.resolvedQuery.includes("Jensen Huang"), true);
  assert.equal(decision.resolvedQuery.includes("tenure"), true);
});

test("topic switch to Kubernetes is not contaminated by NVIDIA context", async () => {
  const conversation = [
    { role: "user", content: "Who is NVIDIA's CEO?", status: "completed" },
    { role: "assistant", content: "Jensen Huang is NVIDIA's CEO.", status: "completed" },
  ];
  const decision = await decideResearchRoute("What is the latest Kubernetes version?", {
    conversation,
  });
  assert.equal(decision.route, "WEB");
  assert.equal(decision.resolvedQuery.includes("Jensen Huang"), false);
  assert.equal(decision.resolvedQuery.includes("Kubernetes"), true);
});

test("ambiguous he in a comparison asks for clarification", async () => {
  const conversation = [
    { role: "user", content: "Compare Jensen Huang and Tim Cook.", status: "completed" },
    { role: "assistant", content: "Jensen Huang leads NVIDIA. Tim Cook leads Apple.", status: "completed" },
  ];
  const decision = await decideResearchRoute("How long was he CEO?", { conversation });
  assert.equal(decision.category, "ambiguous");
  assert.equal(decision.referenceResolution, "ambiguous");
});

test("irrelevant conversation evidence is not reused for Jensen tenure", () => {
  const conversation = [
    { role: "user", content: "Did Jensen Huang step down as CEO?", status: "completed" },
    {
      role: "assistant",
      content: "No evidence confirmed a resignation.",
      status: "completed",
      evidenceReferences: [
        {
          evidenceId: "turn-1-source",
          sourceId: 1,
          chunkId: 1,
          title: "CEO comparison",
          url: "https://example.com/ceos",
          snippet: "Elon Musk leads Tesla. Satya Nadella leads Microsoft.",
          createdAt: "2026-11-20T12:00:00.000Z",
        },
      ],
    },
  ];
  const decision = routeResearchQuery("For how long was he the CEO?", { conversation });
  assert.notEqual(decision.category, "existing_evidence");
});
