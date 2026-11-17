import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { describe, it } from "node:test";

import { createConversationStore } from "../src/conversationStore.js";
import { createApp } from "../src/server.js";
import { routeResearchQuery } from "../src/llm/researchRouting.js";
import { research } from "../src/research.js";

const priorConversation = [
  {
    id: "question-1",
    role: "user",
    status: "completed",
    content: "What is Kubernetes service discovery?",
  },
  {
    id: "answer-1",
    role: "assistant",
    status: "completed",
    content: "Kubernetes Services provide stable discovery endpoints.",
    evidenceReferences: [
      {
        sourceId: 2,
        chunkId: 12,
        title: "Kubernetes deployments",
        url: "https://example.test/kubernetes-deployments",
        snippet:
          "Kubernetes deployments manage desired pod replicas and rollout status.",
      },
      {
        sourceId: 7,
        chunkId: 41,
        title: "Kubernetes Services",
        url: "https://example.test/kubernetes-services",
        snippet:
          "Kubernetes service discovery uses stable virtual IPs. Its limitations include dependence on DNS and correctly configured selectors.",
      },
    ],
  },
];

const nvidiaConversation = [
  {
    id: "nvidia-question",
    role: "user",
    status: "completed",
    content: "What was in NVIDIA's recent announcement?",
  },
  {
    id: "nvidia-answer",
    role: "assistant",
    status: "completed",
    content: "NVIDIA announced a new product line.",
    evidenceReferences: [
      {
        sourceId: 4,
        chunkId: 91,
        title: "NVIDIA announcement",
        url: "https://example.test/nvidia-announcement",
        snippet:
          "NVIDIA announced a new product line and described its technical features.",
      },
    ],
  },
];

function createGroundedOllama({ firstJudgeInsufficient = false } = {}) {
  const requests = [];
  let judgeCalls = 0;
  return {
    requests,
    client: {
      chat: async (request) => {
        requests.push(request);
        const prompt = request.messages[0]?.content || "";
        if (prompt.includes("evidence-sufficiency evaluator")) {
          judgeCalls += 1;
          const sufficient = !firstJudgeInsufficient || judgeCalls > 1;
          return {
            message: {
              content: JSON.stringify({
                sufficient,
                reason: sufficient
                  ? "The supplied passages directly support the follow-up."
                  : "The stored evidence does not address the requested details.",
                missing: sufficient ? null : "The requested follow-up details.",
              }),
            },
          };
        }
        if (prompt.includes("rigorous, factual research assistant")) {
          const sourceId = request.messages
            .at(-1)
            .content.match(/\[Source (\d+)\]/)?.[1];
          return {
            message: {
              content: `The available evidence supports this answer [Source ${sourceId || 1}].`,
            },
          };
        }
        if (prompt.includes("claim-to-evidence attribution assistant")) {
          return { message: { content: JSON.stringify({ claims: [] }) } };
        }
        return { message: { content: "A simpler explanation." } };
      },
    },
  };
}

function webPage() {
  return {
    title: "Kubernetes service discovery limitations",
    url: "https://example.test/kubernetes-limitations",
    content:
      "Kubernetes service discovery has several operational limitations. " +
      "DNS and service selectors must be configured correctly. ".repeat(120),
  };
}

describe("Research-aware follow-up routing", () => {
  it("routes the requested stable, time-sensitive, leadership, and evidence-follow-up examples", () => {
    for (const question of [
      "Explain how Kubernetes Services work.",
      "What is the difference between TCP and UDP?",
      "Tell me a joke.",
    ]) {
      assert.equal(
        routeResearchQuery(question).category,
        "local_knowledge",
        question
      );
    }

    for (const question of [
      "Did Jensen Huang step down as CEO?",
      "Who is NVIDIA's current CEO?",
      "What happened in the latest NVIDIA announcement?",
      "Did Jensen Huang resign?",
      "Is Jensen Huang still working at NVIDIA?",
      "What is NVIDIA stock price?",
      "What version of Node.js is available?",
      "Who ranks highest in current AI chip companies?",
    ]) {
      assert.equal(
        routeResearchQuery(question).category,
        "new_research",
        question
      );
    }

    assert.equal(
      routeResearchQuery(
        "Explain the NVIDIA announcement you just researched.",
        { conversation: nvidiaConversation }
      ).category,
      "existing_evidence"
    );
  });

  it("classifies transformations, evidence follow-ups, explicit research, and unresolved references", () => {
    assert.equal(
      routeResearchQuery("Explain it in simpler terms.", {
        conversation: priorConversation,
      }).category,
      "conversation_only"
    );
    assert.equal(
      routeResearchQuery("What are its limitations?", {
        conversation: priorConversation,
      }).category,
      "existing_evidence"
    );
    assert.equal(
      routeResearchQuery("What are the latest limitations?", {
        conversation: priorConversation,
      }).category,
      "new_research"
    );
    assert.equal(
      routeResearchQuery("What are its limitations?").category,
      "ambiguous"
    );
  });

  it("streams deterministic local answers without invoking the classifier or web search", async () => {
    for (const query of [
      "Explain how Kubernetes Services work.",
      "What is the difference between TCP and UDP?",
      "Tell me a joke.",
    ]) {
      const streamed = [];
      let modelCalls = 0;
      const result = await research(query, {
        ollamaClient: {
          chat: async (request) => {
            modelCalls += 1;
            assert.equal(request.stream, true);
            return (async function* () {
              yield { message: { content: "Local " } };
              yield { message: { content: "answer." } };
            })();
          },
        },
        onToken: (token) => streamed.push(token),
        discoverFn: async () => {
          assert.fail("Stable local questions must not trigger web search.");
        },
      });

      assert.equal(result.source, "local_llm");
      assert.equal(result.searchedWeb, false);
      assert.equal(modelCalls, 1);
      assert.deepEqual(streamed, ["Local ", "answer."]);
    }
  });

  it("finishes fallback classification before the local answer can emit tokens", async () => {
    const events = [];
    let classifierFinished = false;
    const result = await research(
      "Who designed the original Kubernetes architecture?",
      {
        ollamaClient: {
          chat: async (request) => {
            if (!request.stream) {
              assert.deepEqual(events, []);
              assert.equal(request.messages[0].role, "system");
              classifierFinished = true;
              return { message: { content: "LOCAL_KNOWLEDGE" } };
            }
            assert.equal(classifierFinished, true);
            return (async function* () {
              yield { message: { content: "The local " } };
              yield { message: { content: "answer." } };
            })();
          },
        },
        onToken: (token) => events.push(token),
        discoverFn: async () => {
          assert.fail("The classifier selected local knowledge.");
        },
      }
    );

    assert.equal(result.source, "local_llm");
    assert.equal(result.researchMetadata.routeCategory, "local_knowledge");
    assert.deepEqual(events, ["The local ", "answer."]);
  });

  it("does not switch to web research after a local stream fails mid-response", async () => {
    const tokens = [];
    let searches = 0;
    await assert.rejects(
      research("Explain how Kubernetes Services work.", {
        ollamaClient: {
          chat: async () => (async function* () {
            yield { message: { content: "Partial local answer." } };
            throw new Error("Ollama stream disconnected.");
          })(),
        },
        onToken: (token) => tokens.push(token),
        discoverFn: async () => {
          searches += 1;
          return [];
        },
      }),
      { code: "UPSTREAM_ERROR" }
    );

    assert.deepEqual(tokens, ["Partial local answer."]);
    assert.equal(searches, 0);
  });

  it("sends current leadership and news questions to web research without local inference", async () => {
    for (const query of [
      "Did Jensen Huang step down as CEO?",
      "Who is NVIDIA's current CEO?",
      "What happened in the latest NVIDIA announcement?",
    ]) {
      let searches = 0;
      let modelCalls = 0;
      const tokens = [];
      const result = await research(query, {
        ollamaClient: {
          chat: async () => {
            modelCalls += 1;
            throw new Error("Local inference must not run for current facts.");
          },
        },
        discoverFn: async () => {
          searches += 1;
          return [];
        },
        onToken: (token) => tokens.push(token),
      });

      assert.equal(result.source, "web_search", query);
      assert.equal(result.searchedWeb, true, query);
      assert.equal(result.insufficientEvidence, true, query);
      assert.equal(searches, 1, query);
      assert.equal(modelCalls, 0, query);
      assert.deepEqual(tokens, [], query);
    }
  });

  it("keeps a classifier-selected research mode fixed until retrieval finishes", async () => {
    const events = [];
    let searchFinished = false;
    const result = await research(
      "Who designed the original Kubernetes architecture?",
      {
        ollamaClient: {
          chat: async (request) => {
            assert.equal(request.stream, false);
            assert.deepEqual(events, []);
            return { message: { content: "WEB_RESEARCH" } };
          },
        },
        discoverFn: async () => {
          searchFinished = true;
          return [];
        },
        onToken: (token) => events.push(token),
      }
    );

    assert.equal(searchFinished, true);
    assert.equal(result.source, "web_search");
    assert.equal(result.researchMetadata.routeCategory, "new_research");
    assert.deepEqual(events, []);
  });

  it("does not stream an answer when fresh research fails evidence sufficiency", async () => {
    const tokens = [];
    let generationStarted = false;
    const result = await research(
      "What happened in the latest NVIDIA announcement?",
      {
        forceWebSearch: true,
        discoverFn: async () => [webPage()],
        scrapeFn: async (page) => page,
        embeddingsFn: async () => ({ embeddings: null, available: false }),
        ollamaClient: {
          chat: async ({ messages }) => {
            if (messages[0].content.includes("evidence-sufficiency evaluator")) {
              return {
                message: {
                  content: JSON.stringify({
                    sufficient: false,
                    reason: "The retrieved passages do not answer the query.",
                    missing: "Verified NVIDIA announcement details.",
                  }),
                },
              };
            }
            generationStarted = true;
            return { message: { content: "An ungrounded answer." } };
          },
        },
        onToken: (token) => tokens.push(token),
      }
    );

    assert.equal(result.evidenceStatus, "insufficient");
    assert.equal(generationStarted, false);
    assert.deepEqual(tokens, []);
  });

  it("returns an SSE error without answer tokens when SearXNG fails", async () => {
    const store = createConversationStore({ dbPath: ":memory:" });
    const app = createApp({
      researchFn: (query, options) =>
        research(query, {
          ...options,
          discoverFn: async () => {
            const error = new Error("SearXNG is unavailable.");
            error.code = "SERVICE_UNAVAILABLE";
            error.service = "SearXNG";
            throw error;
          },
        }),
      healthCheckFn: async () => ({}),
      monitoringFn: async () => ({}),
      conversationStore: store,
    });
    const server = app.listen(0);
    await once(server, "listening");

    try {
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/api/search`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({ query: "Who is NVIDIA's current CEO?" }),
        }
      );
      const body = await response.text();

      assert.equal(response.status, 200);
      assert.match(body, /event: error/);
      assert.match(body, /SearXNG is unavailable/);
      assert.doesNotMatch(body, /event: token/);
      assert.doesNotMatch(body, /event: done/);
    } finally {
      if (server.listening) {
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        );
      }
      store.close();
    }
  });

  it("uses the evidence-backed mode for the researched NVIDIA announcement follow-up", async () => {
    const ollama = createGroundedOllama();
    let searches = 0;
    const result = await research(
      "Explain the NVIDIA announcement you just researched.",
      {
        conversation: nvidiaConversation,
        ollamaClient: ollama.client,
        discoverFn: async () => {
          searches += 1;
          return [];
        },
      }
    );

    assert.equal(result.source, "existing_evidence");
    assert.equal(result.searchedWeb, false);
    assert.deepEqual(result.evidence.map(({ id }) => id), [4]);
    assert.deepEqual(result.citations.map(({ id }) => id), [4]);
    assert.match(result.answer, /\[Source 4\]/);
    assert.equal(searches, 0);
  });

  it("reuses older evidence for a follow-up after many unrelated exchanges", async () => {
    const longConversation = [...nvidiaConversation];
    for (let index = 0; index < 12; index += 1) {
      longConversation.push(
        {
          id: `other-question-${index}`,
          role: "user",
          status: "completed",
          content: `Unrelated topic ${index}: explain a stable programming concept.`,
        },
        {
          id: `other-answer-${index}`,
          role: "assistant",
          status: "completed",
          content: `A general explanation for unrelated topic ${index}.`,
        }
      );
    }

    const result = await research(
      "Explain the NVIDIA announcement you just researched.",
      {
        conversation: longConversation,
        ollamaClient: createGroundedOllama().client,
        discoverFn: async () => {
          assert.fail("Relevant saved evidence should be reused.");
        },
      }
    );

    assert.equal(result.source, "existing_evidence");
    assert.equal(result.evidence[0].id, 4);
    assert.equal(result.evidence[0].chunkId, 91);
  });

  it("answers a clear conversation transformation without web search", async () => {
    const requests = [];
    let searches = 0;
    const result = await research("Explain it in simpler terms.", {
      conversation: priorConversation,
      ollamaClient: {
        chat: async (request) => {
          requests.push(request);
          return {
            message: { content: "It is a built-in way to find a service." },
          };
        },
      },
      discoverFn: async () => {
        searches += 1;
        return [];
      },
    });

    assert.equal(result.source, "local_llm");
    assert.equal(result.searchedWeb, false);
    assert.equal(result.answer, "It is a built-in way to find a service.");
    assert.equal(requests.length, 1);
    assert.equal(searches, 0);
    assert.match(requests[0].messages[0].content, /Do not introduce new factual claims/);
    assert.equal(requests[0].messages.at(-1).content, "Explain it in simpler terms.");
  });

  it("reuses one prior evidence set, preserves source and chunk IDs, and verifies citations", async () => {
    const ollama = createGroundedOllama();
    let searches = 0;
    const result = await research("What are its limitations?", {
      conversation: priorConversation,
      ollamaClient: ollama.client,
      discoverFn: async () => {
        searches += 1;
        return [];
      },
    });

    assert.equal(result.source, "existing_evidence");
    assert.equal(result.searchedWeb, false);
    assert.equal(searches, 0);
    assert.deepEqual(result.evidence.map(({ id }) => id), [7]);
    assert.equal(result.evidence[0].id, 7);
    assert.equal(result.evidence[0].chunkId, 41);
    assert.deepEqual(result.citations.map(({ id }) => id), [7]);
    assert.match(result.answer, /\[Source 7\]/);
    assert.deepEqual(result.researchMetadata.routeCategory, "existing_evidence");
    assert.ok(
      ollama.requests[0].messages[0].content.includes(
        "What is Kubernetes service discovery?"
      )
    );
  });

  it("starts fresh web research when the existing evidence gate rejects stored passages", async () => {
    const ollama = createGroundedOllama({ firstJudgeInsufficient: true });
    const searchQueries = [];
    const result = await research("What are its limitations?", {
      conversation: priorConversation,
      ollamaClient: ollama.client,
      discoverFn: async (query) => {
        searchQueries.push(query);
        return [webPage()];
      },
      scrapeFn: async (page) => page,
      embeddingsFn: async () => ({ embeddings: null, available: false }),
    });

    assert.equal(searchQueries.length, 1);
    assert.match(searchQueries[0], /Kubernetes service discovery/);
    assert.match(searchQueries[0], /Follow-up question: What are its limitations/);
    assert.equal(result.source, "web_search");
    assert.equal(result.searchedWeb, true);
    assert.equal(result.researchMetadata.routeCategory, "new_research");
    assert.ok(
      result.warnings.some((warning) =>
        warning.includes("Previous research evidence was insufficient")
      )
    );
    assert.equal(ollama.requests.filter((request) =>
      request.messages[0]?.content.includes("evidence-sufficiency evaluator")
    ).length, 2);
  });

  it("uses the fresh retrieval pipeline for explicit research requests", async () => {
    const ollama = createGroundedOllama();
    let searchedQuery = "";
    const result = await research(
      "Search the web for current Kubernetes service discovery limitations.",
      {
        ollamaClient: ollama.client,
        discoverFn: async (query) => {
          searchedQuery = query;
          return [webPage()];
        },
        scrapeFn: async (page) => page,
        embeddingsFn: async () => ({ embeddings: null, available: false }),
      }
    );

    assert.match(searchedQuery, /current Kubernetes/);
    assert.equal(result.searchedWeb, true);
    assert.equal(result.researchMetadata.routeCategory, "new_research");
    assert.equal(
      ollama.requests.filter((request) =>
        request.messages[0]?.content.includes("evidence-sufficiency evaluator")
      ).length,
      1
    );
  });

  it("asks for clarification without model inference or search when no antecedent exists", async () => {
    let modelCalls = 0;
    let searches = 0;
    const result = await research("What are its limitations?", {
      ollamaClient: {
        chat: async () => {
          modelCalls += 1;
          return { message: { content: "Unexpected inference." } };
        },
      },
      discoverFn: async () => {
        searches += 1;
        return [];
      },
    });

    assert.equal(result.source, "clarification");
    assert.match(result.answer, /What topic/);
    assert.equal(modelCalls, 0);
    assert.equal(searches, 0);
  });

  it("integrates stored conversation summaries into deterministic follow-ups", async () => {
    const store = createConversationStore({
      dbPath: join(mkdtempSync(join(tmpdir(), "veriscope-routing-summary-")), "chat.db"),
    });
    const conversation = store.createConversation({ title: "Summary integration" });
    for (let index = 0; index < 8; index += 1) {
      store.saveMessage({
        conversationId: conversation.id,
        role: "user",
        content: `Question ${index}: Kubernetes service discovery decision.`,
      });
      store.saveAssistantMessage({
        conversationId: conversation.id,
        content: `Answer ${index}: preserve the service discovery endpoint.`,
      });
    }

    const history = store.getConversationMessages(conversation.id, {
      completedOnly: true,
    });
    const requests = [];
    try {
      const result = await research("Rephrase that more simply.", {
        conversation: history,
        conversationStore: store,
        sessionId: conversation.id,
        ollamaClient: {
          chat: async (request) => {
            requests.push(request);
            if (request.stream === false) {
              return {
                message: {
                  content:
                    "The conversation concerns Kubernetes service discovery and preserving its endpoint decision.",
                },
              };
            }
            return { message: { content: "Keep the endpoint simple." } };
          },
        },
        discoverFn: async () => {
          assert.fail("A deterministic rewrite must not search the web.");
        },
      });

      assert.equal(result.source, "local_llm");
      assert.equal(requests.length, 2);
      assert.ok(store.getConversationSummary(conversation.id));
      assert.match(JSON.stringify(requests[1].messages), /Older conversation summary/);
      assert.equal(
        store.getConversationMessages(conversation.id, { completedOnly: true })
          .length,
        16
      );
    } finally {
      store.close();
    }
  });
});
