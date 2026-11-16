import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { attributeClaims } from "../src/llm/evidenceAttribution.js";
import { research } from "../src/research.js";

function createOllamaWithAttribution(claims) {
  return {
    chat: async () => ({
      message: { content: JSON.stringify({ claims }) },
    }),
  };
}

describe("Claim-level evidence attribution", () => {
  it("maps direct, multi-source, partial, related, and unsupported claims to exact passages", async () => {
    const answer =
      "RAG combines information retrieval with generative AI. " +
      "It retrieves documents and supplies them as context to an LLM. " +
      "The system runs on a private GPU cluster. " +
      "A proprietary chip launched yesterday.";
    const evidence = [
      {
        id: 1,
        chunkId: 4,
        title: "RAG overview",
        sourceTitle: "RAG overview",
        url: "https://example.test/rag",
        text: "RAG combines information retrieval with generative AI. It retrieves documents.",
        score: 0.94,
      },
      {
        id: 2,
        chunkId: 5,
        title: "RAG context",
        sourceTitle: "RAG context",
        url: "https://research.test/rag",
        text: "It supplies retrieved documents as additional context to an LLM.",
        score: 0.81,
      },
      {
        id: 3,
        chunkId: 6,
        title: "Duplicate RAG overview",
        sourceTitle: "Duplicate RAG overview",
        url: "https://example.test/rag",
        text: "RAG combines information retrieval with generative AI. It retrieves documents.",
        score: 0.73,
      },
      {
        id: 4,
        chunkId: 7,
        title: "Private hosting",
        sourceTitle: "Private hosting",
        url: "https://hosting.test/private",
        text: "Teams often choose private GPU clusters to host language models.",
        score: 0.61,
      },
    ];
    const ollamaClient = createOllamaWithAttribution([
      {
        claim_text: "RAG combines information retrieval with generative AI.",
        evidence: [
          {
            chunk_id: 4,
            quote: "RAG combines information retrieval with generative AI.",
            support_status: "direct",
          },
          {
            chunk_id: 6,
            quote: "RAG combines information retrieval with generative AI.",
            support_status: "direct",
          },
        ],
      },
      {
        claim_text: "It retrieves documents and supplies them as context to an LLM.",
        evidence: [
          {
            chunk_id: 4,
            quote: "It retrieves documents.",
            support_status: "partial",
          },
          {
            chunk_id: 5,
            quote: "It supplies retrieved documents as additional context to an LLM.",
            support_status: "partial",
          },
        ],
      },
      {
        claim_text: "The system runs on a private GPU cluster.",
        evidence: [
          {
            chunk_id: 7,
            quote: "Teams often choose private GPU clusters to host language models.",
            support_status: "related",
          },
        ],
      },
      {
        claim_text: "A proprietary chip launched yesterday.",
        evidence: [],
      },
    ]);

    const result = await attributeClaims(answer, evidence, { ollamaClient });

    assert.equal(result.status, "available");
    assert.equal(result.claims.length, 4);
    assert.equal(result.claims[0].status, "direct");
    assert.equal(result.claims[0].evidence.length, 1);
    assert.equal(
      result.claims[0].evidence[0].extractedText,
      "RAG combines information retrieval with generative AI."
    );
    assert.equal(result.claims[1].status, "partial");
    assert.equal(result.claims[1].evidence.length, 2);
    assert.equal(result.claims[1].evidence[1].domain, "research.test");
    assert.equal(result.claims[2].status, "related");
    assert.equal(result.claims[3].status, "unsupported");
    assert.deepEqual(result.claims[3].evidence, []);
  });

  it("rejects invented quotes and chunk IDs without fabricating missing metadata", async () => {
    const answer =
      "The application uses Express for its local API. " +
      "The system launched in 2024.";
    const evidence = [
      {
        id: 2,
        chunkId: 11,
        sourceTitle: null,
        url: null,
        text: "The application uses Express for its local API.",
        score: undefined,
      },
    ];
    const ollamaClient = createOllamaWithAttribution([
      {
        claim_text: "The application uses Express for its local API.",
        evidence: [
          {
            chunk_id: 11,
            quote: "The application uses a cloud-hosted API.",
            support_status: "direct",
          },
          {
            chunk_id: 11,
            quote: "The application uses Express for its local API.",
            support_status: "direct",
          },
          {
            chunk_id: 999,
            quote: "The application uses Express for its local API.",
            support_status: "direct",
          },
        ],
      },
      {
        claim_text: "The system launched in 2024.",
        evidence: [
          {
            chunk_id: 11,
            quote: "The system launched in 2024.",
            support_status: "direct",
          },
        ],
      },
    ]);

    const result = await attributeClaims(answer, evidence, { ollamaClient });

    assert.equal(result.claims[0].status, "direct");
    assert.equal(result.claims[0].evidence.length, 1);
    assert.equal(result.claims[0].evidence[0].title, null);
    assert.equal(result.claims[0].evidence[0].domain, null);
    assert.equal(result.claims[0].evidence[0].relevanceScore, null);
    assert.equal(result.claims[1].status, "unsupported");
    assert.deepEqual(result.claims[1].evidence, []);
  });

  it("returns an explicit unavailable status when the local model fails", async () => {
    const result = await attributeClaims(
      "The application uses Express.",
      [{ id: 1, chunkId: 0, text: "The application uses Express." }],
      {
        ollamaClient: {
          chat: async () => {
            throw new Error("local model offline");
          },
        },
      }
    );

    assert.equal(result.status, "unavailable");
    assert.deepEqual(result.claims, []);
    assert.ok(result.error);
  });

  it("adds claim evidence in forced-web research but not for a direct local answer", async () => {
    const snippet =
      "The backend uses Express for API routing, while SearXNG performs web searches.";
    const direct = await research("What does the local model know?", {
      ollamaClient: {
        chat: async () => ({
          message: { content: "A direct answer from local knowledge." },
        }),
      },
    });

    assert.equal(direct.answeredByLLM, true);
    assert.equal(direct.claimAttribution, undefined);

    let scrapeCount = 0;
    const webResult = await research("What framework does the backend use?", {
      forceWebSearch: true,
      ollamaClient: {
        chat: async ({ messages }) => {
          const prompt = messages[0].content;
          if (prompt.includes("evidence-sufficiency evaluator")) {
            return {
              message: {
                content: JSON.stringify({
                  sufficient: true,
                  reason: "The retrieved page states the framework.",
                  missing: null,
                }),
              },
            };
          }
          if (prompt.includes("rigorous, factual research assistant")) {
            return {
              message: {
                content: "The backend uses Express for API routing [Source 1].",
              },
            };
          }
          return {
            message: {
              content: JSON.stringify({
                claims: [
                  {
                    claim_text: "The backend uses Express for API routing",
                    evidence: [
                      {
                        chunk_id: 0,
                        quote: "The backend uses Express for API routing",
                        support_status: "direct",
                      },
                    ],
                  },
                ],
              }),
            },
          };
        },
      },
      discoverFn: async () => [
        {
          title: "VeriScope backend",
          url: "https://docs.test/backend",
          content: snippet,
        },
      ],
      scrapeFn: async (page) => {
        scrapeCount += 1;
        return { ...page, content: snippet };
      },
      embeddingsFn: async () => ({ embeddings: null, available: false }),
    });

    assert.equal(webResult.searchedWeb, true);
    assert.equal(webResult.claimAttribution.status, "available");
    assert.equal(webResult.claimAttribution.claims[0].evidence[0].chunkId, 0);
    assert.equal(webResult.claimAttribution.claims[0].evidence[0].sourceId, 1);
    assert.equal(scrapeCount, 1);
  });
});
