import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildConversationContext } from "../src/llm/conversationContext.js";
import { research } from "../src/research.js";
import {
  estimateEvidenceTokens,
  normalizeResearchSettings,
  selectEvidenceWithinBudget,
} from "../src/retrieval/depth.js";
import { diversifySources } from "../src/retrieval/deduplicate.js";

describe("Research depth and context budgets", () => {
  it("uses the configured FAST, NORMAL, and MAX retrieval presets", () => {
    assert.deepEqual(normalizeResearchSettings({ depth: "FAST" }), {
      depth: "FAST",
      alpha: 0.5,
      topK: 5,
      evidenceTokenBudget: 2000,
    });
    assert.deepEqual(normalizeResearchSettings({ depth: "NORMAL" }), {
      depth: "NORMAL",
      alpha: 0.5,
      topK: 10,
      evidenceTokenBudget: 4000,
    });
    assert.equal(normalizeResearchSettings({ alpha: 0.3 }).alpha, 0.3);
    assert.deepEqual(normalizeResearchSettings({ depth: "MAX", alpha: 0.7 }), {
      depth: "MAX",
      alpha: 0.7,
      topK: 20,
      evidenceTokenBudget: 5000,
    });
  });

  it("enforces evidence budgets without reordering or stripping citation metadata", () => {
    const candidates = [1, 2, 3].map((id) => ({
      id,
      title: `Source ${id}`,
      url: `https://example.test/${id}`,
      text: `Evidence passage ${id} with enough unique detail to be useful.`,
    }));
    const budget = estimateEvidenceTokens(candidates.slice(0, 2));
    const selected = selectEvidenceWithinBudget(candidates, 20, budget);

    assert.deepEqual(selected.map((item) => item.id), [1, 2]);
    assert.equal(selected[0].url, candidates[0].url);
    assert.ok(estimateEvidenceTokens(selected) <= budget);
  });

  it("preserves hybrid ranking order when filling source-diversity slots", () => {
    const ranked = [
      { id: 1, url: "https://example.test/a", hybridScore: 0.9 },
      { id: 2, url: "https://example.test/a", hybridScore: 0.8 },
      { id: 3, url: "https://example.test/a", hybridScore: 0.7 },
      { id: 4, url: "https://example.test/b", hybridScore: 0.6 },
    ];

    const selected = diversifySources(ranked, 2, 4);

    assert.deepEqual(selected.map((item) => item.id), [1, 2, 3, 4]);
  });

  it("keeps reconstructed conversation context within its token budget", () => {
    const messages = Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `Message ${index}: ${"context detail ".repeat(3)}`,
      evidenceReferences: index === 1
        ? [{ title: "Reference", url: "https://example.test/source", chunkId: 7 }]
        : [],
    }));
    const context = buildConversationContext(messages, { tokenBudget: 50 });

    assert.ok(context.tokenCount <= 50);
    assert.match(context.prompt, /Recent conversation:/);
    assert.match(context.prompt, /Message 9/);
  });

  it("applies each Top-K through hybrid retrieval and respects evidence budgets", async () => {
    const pages = Array.from({ length: 5 }, (_, pageIndex) => {
      let content = "";
      for (let index = 0; content.length < 6000; index += 1) {
        content += `research evidence source page${pageIndex} segment${pageIndex}_${index} detail${pageIndex}_${index} verification${pageIndex}_${index} `;
      }
      return {
        title: `Research source ${pageIndex}`,
        url: `https://example.test/research-${pageIndex}`,
        content: content.slice(0, 6000),
      };
    });
    const ollamaClient = {
      chat: async ({ messages }) => {
        const prompt = messages[0].content;
        if (prompt.includes("evidence-sufficiency evaluator")) {
          return {
            message: {
              content: JSON.stringify({
                sufficient: true,
                reason: "The test passages support the answer.",
                missing: null,
              }),
            },
          };
        }
        if (prompt.includes("claim-to-evidence attribution assistant")) {
          return { message: { content: JSON.stringify({ claims: [] }) } };
        }
        return { message: { content: "Research facts [Source 1]." } };
      },
    };

    const results = [];
    for (const depth of ["FAST", "NORMAL", "MAX"]) {
      results.push(
        await research("research evidence source", {
          forceWebSearch: true,
          depth,
          ollamaClient,
          discoverFn: async () => pages,
          scrapeFn: async (page) => page,
          embeddingsFn: async () => ({ embeddings: null, available: false }),
        })
      );
    }

    for (const result of results) {
      const { depth, topK, evidenceTokenBudget, chunksSent, evidenceTokenCount } =
        result.researchMetadata;
      assert.equal(topK, { FAST: 5, NORMAL: 10, MAX: 20 }[depth]);
      assert.ok(chunksSent <= topK);
      assert.ok(evidenceTokenCount <= evidenceTokenBudget);
    }
    assert.ok(results[2].researchMetadata.chunksSent > 10);
  });
});
