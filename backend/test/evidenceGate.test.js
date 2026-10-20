import { test, describe, it } from "node:test";
import assert from "node:assert";

import {
  evaluateEvidenceSufficiency,
  parseAndValidateJudgeResponse,
  buildEvidenceJudgePrompt,
} from "../src/llm/evidenceJudge.js";
import {
  validateAndSanitizeCitations,
  generateAnswer,
} from "../src/llm/mistral.js";
import { research } from "../src/research.js";

describe("Evidence Sufficiency Gate & Grounding Verification", () => {
  // =========================================================================
  // Helper to create mocked Ollama client
  // =========================================================================
  function createMockOllama(handler) {
    return {
      chat: async (params) => {
        return handler(params);
      },
    };
  }

  const mockEmbeddings = async () => ({
    embeddings: null,
    available: false,
  });

  // -------------------------------------------------------------------------
  // 1. Strong evidence that supports the full query
  // -------------------------------------------------------------------------
  it("Test 1: Strong evidence that supports the full query should pass gate and generate grounded answer", async () => {
    let judgeCalled = false;
    let generatorCalled = false;

    const mockOllama = createMockOllama(async (params) => {
      const prompt = params.messages[0].content;

      // Judge prompt
      if (prompt.includes("evidence-sufficiency evaluator")) {
        judgeCalled = true;
        return {
          message: {
            content: JSON.stringify({
              sufficient: true,
              reason: "Evidence explicitly states that VeriScope runs on port 5001 and uses the Express framework.",
              missing: null,
            }),
          },
        };
      }

      // Answer generator prompt
      if (prompt.includes("rigorous, factual research assistant")) {
        generatorCalled = true;
        return {
          message: {
            content: "VeriScope backend runs on port 5001 and uses the Express framework [Source 1].",
          },
        };
      }

      throw new Error(`Unexpected prompt: ${prompt}`);
    });

    const mockEvidence = [
      {
        id: 1,
        title: "VeriScope Architecture",
        url: "https://veriscope.local/docs",
        text: "The VeriScope backend service runs on port 5001 and uses Express framework for routing.",
      },
    ];

    // Direct judge test
    const judgeResult = await evaluateEvidenceSufficiency(
      "What port does the VeriScope backend run on and what framework does it use?",
      mockEvidence,
      { ollamaClient: mockOllama }
    );

    assert.strictEqual(judgeResult.sufficient, true);
    assert.strictEqual(judgeResult.status, "sufficient");
    assert.strictEqual(judgeResult.missing, null);

    // Full research pipeline test
    const pipelineResult = await research(
      "What port does the VeriScope backend run on and what framework does it use?",
      {
        forceWebSearch: true,
        ollamaClient: mockOllama,
        embeddingsFn: mockEmbeddings,
        discoverFn: async () => [
          { title: "VeriScope Architecture", url: "https://veriscope.local/docs" },
        ],
        scrapeFn: async () => ({
          title: "VeriScope Architecture",
          url: "https://veriscope.local/docs",
          content: "The VeriScope backend service runs on port 5001 and uses Express framework for routing.",
        }),
      }
    );

    assert.strictEqual(judgeCalled, true, "Judge should have been called");
    assert.strictEqual(generatorCalled, true, "Generator should have been called when evidence is sufficient");
    assert.strictEqual(pipelineResult.insufficientEvidence, false);
    assert.strictEqual(pipelineResult.evidenceStatus, "sufficient");
    assert.strictEqual(pipelineResult.searchedWeb, true);
    assert.strictEqual(pipelineResult.answeredByLLM, false);
    assert.ok(pipelineResult.answer.includes("port 5001"));
    assert.ok(pipelineResult.answer.includes("[Source 1]"));
  });

  // -------------------------------------------------------------------------
  // 2. Relevant but insufficient evidence
  // -------------------------------------------------------------------------
  it("Test 2: Relevant but insufficiently informative evidence should be rejected by gate", async () => {
    let generatorCalled = false;

    const mockOllama = createMockOllama(async (params) => {
      const prompt = params.messages[0].content;

      if (prompt.includes("evidence-sufficiency evaluator")) {
        return {
          message: {
            content: JSON.stringify({
              sufficient: false,
              reason: "The evidence discusses VeriScope and Docker containers, but does not provide any production memory limit numbers.",
              missing: "Production container memory limit specification.",
            }),
          },
        };
      }

      if (prompt.includes("rigorous, factual research assistant")) {
        generatorCalled = true;
        return { message: { content: "Should not be called" } };
      }

      throw new Error(`Unexpected prompt: ${prompt}`);
    });

    const pipelineResult = await research(
      "What is the memory limit of the VeriScope production container?",
      {
        forceWebSearch: true,
        ollamaClient: mockOllama,
        embeddingsFn: mockEmbeddings,
        discoverFn: async () => [
          { title: "VeriScope Deployment", url: "https://veriscope.local/deploy" },
        ],
        scrapeFn: async () => ({
          title: "VeriScope Deployment",
          url: "https://veriscope.local/deploy",
          content: "VeriScope runs inside a Docker container orchestrated via docker-compose on local developer machines.",
        }),
      }
    );

    assert.strictEqual(generatorCalled, false, "Generator MUST NOT be called when evidence is insufficient");
    assert.strictEqual(pipelineResult.insufficientEvidence, true);
    assert.strictEqual(pipelineResult.evidenceStatus, "insufficient");
    assert.ok(pipelineResult.answer.startsWith("Not enough evidence"));
    assert.ok(pipelineResult.answer.includes("Production container memory limit specification."));
    assert.ok(pipelineResult.citations.length > 0, "Citations should still be available for inspection");
  });

  // -------------------------------------------------------------------------
  // 3. Partial evidence for a multi-part query
  // -------------------------------------------------------------------------
  it("Test 3: Multi-part query where only one part is answered must be rejected as insufficient", async () => {
    let generatorCalled = false;

    const mockOllama = createMockOllama(async (params) => {
      const prompt = params.messages[0].content;

      if (prompt.includes("evidence-sufficiency evaluator")) {
        return {
          message: {
            content: JSON.stringify({
              sufficient: false,
              reason: "The passage identifies the designers of Kubernetes, but does not state the release date of version 1.0.",
              missing: "The release date of Kubernetes version 1.0.",
            }),
          },
        };
      }

      if (prompt.includes("rigorous, factual research assistant")) {
        generatorCalled = true;
        return { message: { content: "Hallucinated answer from pretrained knowledge" } };
      }

      throw new Error(`Unexpected prompt: ${prompt}`);
    });

    const pipelineResult = await research(
      "Who designed Kubernetes and what exact date was version 1.0 released?",
      {
        forceWebSearch: true,
        ollamaClient: mockOllama,
        embeddingsFn: mockEmbeddings,
        discoverFn: async () => [
          { title: "Kubernetes History", url: "https://kubernetes.io/history" },
        ],
        scrapeFn: async () => ({
          title: "Kubernetes History",
          url: "https://kubernetes.io/history",
          content: "Kubernetes was designed by Google engineers Joe Beda, Brendan Burns, and Craig McLuckie.",
        }),
      }
    );

    assert.strictEqual(generatorCalled, false, "Generator must not be called to fill missing parts with pretrained knowledge");
    assert.strictEqual(pipelineResult.insufficientEvidence, true);
    assert.strictEqual(pipelineResult.evidenceStatus, "insufficient");
    assert.ok(pipelineResult.answer.startsWith("Not enough evidence"));
    assert.ok(pipelineResult.missingEvidence.includes("release date"));
  });

  // -------------------------------------------------------------------------
  // 4. Empty search results
  // -------------------------------------------------------------------------
  it("Test 4: Empty search results immediately returns 'Not enough evidence' without calling LLM", async () => {
    let llmCalled = false;
    const mockOllama = createMockOllama(async () => {
      llmCalled = true;
      return { message: { content: "{}" } };
    });

    const pipelineResult = await research("query with zero search results", {
      forceWebSearch: true,
      ollamaClient: mockOllama,
      discoverFn: async () => [],
    });

    assert.strictEqual(llmCalled, false, "Neither judge nor generator should be called when 0 search results found");
    assert.strictEqual(pipelineResult.insufficientEvidence, true);
    assert.strictEqual(pipelineResult.evidenceStatus, "insufficient");
    assert.ok(pipelineResult.answer.startsWith("Not enough evidence"));
    assert.strictEqual(pipelineResult.citations.length, 0);
  });

  // -------------------------------------------------------------------------
  // 5. Empty or unusable scraped content
  // -------------------------------------------------------------------------
  it("Test 5: Inaccessible scraped pages returns 'Not enough evidence' without calling LLM", async () => {
    let llmCalled = false;
    const mockOllama = createMockOllama(async () => {
      llmCalled = true;
      return { message: { content: "{}" } };
    });

    const pipelineResult = await research("query with broken pages", {
      forceWebSearch: true,
      ollamaClient: mockOllama,
      discoverFn: async () => [
        { title: "Dead Link 1", url: "https://dead1.com", content: "" },
        { title: "Dead Link 2", url: "https://dead2.com", content: "" },
      ],
      scrapeFn: async () => ({
        title: "Dead Link",
        url: "https://dead.com",
        content: "",
        isSnippetFallback: false,
      }),
    });

    assert.strictEqual(llmCalled, false, "LLM should not be called when no page text could be extracted");
    assert.strictEqual(pipelineResult.insufficientEvidence, true);
    assert.strictEqual(pipelineResult.evidenceStatus, "insufficient");
    assert.ok(pipelineResult.answer.startsWith("Not enough evidence"));
  });

  // -------------------------------------------------------------------------
  // 6. Malformed evaluator JSON
  // -------------------------------------------------------------------------
  it("Test 6: Malformed evaluator JSON fails closed with status 'verification_failed'", async () => {
    let generatorCalled = false;

    const mockOllama = createMockOllama(async (params) => {
      const prompt = params.messages[0].content;

      if (prompt.includes("evidence-sufficiency evaluator")) {
        // Return non-JSON text
        return {
          message: {
            content: "I think the evidence is okay maybe, but I cannot format JSON: {not-json",
          },
        };
      }

      if (prompt.includes("rigorous, factual research assistant")) {
        generatorCalled = true;
        return { message: { content: "Generated answer" } };
      }

      throw new Error("Unexpected prompt");
    });

    const pipelineResult = await research("How does BM25 work?", {
      forceWebSearch: true,
      ollamaClient: mockOllama,
      embeddingsFn: mockEmbeddings,
      discoverFn: async () => [
        { title: "BM25 Guide", url: "https://bm25.org" },
      ],
      scrapeFn: async () => ({
        title: "BM25 Guide",
        url: "https://bm25.org",
        content: "BM25 is a bag-of-words ranking function used in information retrieval.",
      }),
    });

    // Must fail closed: do NOT run answer generation
    assert.strictEqual(generatorCalled, false, "Must not generate answer when evaluator JSON is malformed");
    assert.strictEqual(pipelineResult.insufficientEvidence, true);
    assert.strictEqual(pipelineResult.evidenceStatus, "verification_failed");
    assert.ok(pipelineResult.answer.startsWith("Not enough evidence"));
  });

  // -------------------------------------------------------------------------
  // 7. Evaluator timeout or failure
  // -------------------------------------------------------------------------
  it("Test 7: Evaluator connection failure or timeout fails closed", async () => {
    let generatorCalled = false;

    const mockOllama = createMockOllama(async (params) => {
      const prompt = params.messages[0].content;

      if (prompt.includes("evidence-sufficiency evaluator")) {
        const connError = new Error("connect ECONNREFUSED 127.0.0.1:11434");
        connError.code = "ECONNREFUSED";
        throw connError;
      }

      if (prompt.includes("rigorous, factual research assistant")) {
        generatorCalled = true;
        return { message: { content: "Generated answer" } };
      }

      throw new Error("Unexpected prompt");
    });

    const pipelineResult = await research("What is quantum computing?", {
      forceWebSearch: true,
      ollamaClient: mockOllama,
      embeddingsFn: mockEmbeddings,
      discoverFn: async () => [
        { title: "Quantum Computing", url: "https://quantum.org" },
      ],
      scrapeFn: async () => ({
        title: "Quantum Computing",
        url: "https://quantum.org",
        content: "Quantum computing utilizes the principles of quantum superposition and entanglement.",
      }),
    });

    assert.strictEqual(generatorCalled, false, "Generator must not be called when evaluator fails");
    assert.strictEqual(pipelineResult.insufficientEvidence, true);
    assert.strictEqual(pipelineResult.evidenceStatus, "verification_failed");
    assert.ok(pipelineResult.answer.startsWith("Not enough evidence"));
  });

  // -------------------------------------------------------------------------
  // 8. Valid citations that map to actual sources
  // -------------------------------------------------------------------------
  it("Test 8: Citations in generated answer are validated against actual supplied evidence", async () => {
    // Unit test for citation validation & sanitization
    const validEvidenceIds = new Set([1, 2]);
    const answerWithFakeCitations =
      "Kubernetes uses CoreDNS [Source 1] and service discovery [Source 2], but also claims [Source 99] and [Source 7] exist.";

    const { sanitizedAnswer, validCitations, invalidCitations } =
      validateAndSanitizeCitations(answerWithFakeCitations, validEvidenceIds);

    assert.deepStrictEqual(validCitations.sort(), [1, 2]);
    assert.deepStrictEqual(invalidCitations.sort(), [7, 99]);
    assert.ok(sanitizedAnswer.includes("[Source 1]"));
    assert.ok(sanitizedAnswer.includes("[Source 2]"));
    assert.ok(!sanitizedAnswer.includes("[Source 99]"), "Invented citation [Source 99] must be removed");
    assert.ok(!sanitizedAnswer.includes("[Source 7]"), "Invented citation [Source 7] must be removed");

    // In generateAnswer directly
    const mockOllama = createMockOllama(async () => ({
      message: {
        content: "Kubernetes uses kube-dns [Source 1] and external load balancers [Source 88].",
      },
    }));

    const genResult = await generateAnswer(
      "How does K8s DNS work?",
      [
        { id: 1, title: "K8s DNS", url: "https://k8s.io/dns", text: "kube-dns resolves services." },
      ],
      { ollamaClient: mockOllama }
    );

    assert.ok(genResult.answer.includes("[Source 1]"));
    assert.ok(!genResult.answer.includes("[Source 88]"), "Hallucinated source 88 must be filtered");
    assert.deepStrictEqual(genResult.citedSourceIds, [1]);
    assert.deepStrictEqual(genResult.invalidCitationsFound, [88]);
  });

  // -------------------------------------------------------------------------
  // 9. Unsupported claims that must not be answered using pretrained knowledge
  // -------------------------------------------------------------------------
  it("Test 9: Pretrained knowledge must not be used to answer claims unsupported by evidence", async () => {
    let generatorCalled = false;

    // Suppose the query asks for confidential secret proportions of a beverage,
    // and the evidence only gives corporate marketing history.
    const mockOllama = createMockOllama(async (params) => {
      const prompt = params.messages[0].content;

      if (prompt.includes("evidence-sufficiency evaluator")) {
        // Strict evaluator adheres to rule 2: IGNORE PRETRAINED KNOWLEDGE
        return {
          message: {
            content: JSON.stringify({
              sufficient: false,
              reason: "The evidence discusses corporate branding and beverage distribution, but does not contain any formulation or recipe details.",
              missing: "The secret formulation and ingredient proportions.",
            }),
          },
        };
      }

      if (prompt.includes("rigorous, factual research assistant")) {
        generatorCalled = true;
        // Pretrained Mistral would have hallucinated standard folklore ingredients here
        return {
          message: {
            content: "The secret recipe is rumored to contain vanilla, cinnamon, and coca leaf extract.",
          },
        };
      }

      throw new Error("Unexpected prompt");
    });

    const pipelineResult = await research(
      "What is the exact secret formula and recipe of Coca-Cola?",
      {
        forceWebSearch: true,
        ollamaClient: mockOllama,
        embeddingsFn: mockEmbeddings,
        discoverFn: async () => [
          { title: "Beverage History", url: "https://beverages.com/history" },
        ],
        scrapeFn: async () => ({
          title: "Beverage History",
          url: "https://beverages.com/history",
          content: "The Coca-Cola Company is an American multinational corporation founded in 1892 that produces and distributes soft drinks globally.",
        }),
      }
    );

    assert.strictEqual(generatorCalled, false, "Generator must not run to fabricate answers from pretrained weights");
    assert.strictEqual(pipelineResult.insufficientEvidence, true);
    assert.ok(pipelineResult.answer.startsWith("Not enough evidence"));
    assert.ok(pipelineResult.missingEvidence.includes("secret formulation"));
  });

  // -------------------------------------------------------------------------
  // Evaluator Parser & Validation Edge Cases
  // -------------------------------------------------------------------------
  it("Evaluator parser handles markdown fenced JSON and extracts clean structured object", () => {
    const rawMarkdownFenced = `\`\`\`json
{
  "sufficient": false,
  "reason": "Missing primary release date",
  "missing": "Release date"
}
\`\`\``;

    const parsed = parseAndValidateJudgeResponse(rawMarkdownFenced);
    assert.strictEqual(parsed.sufficient, false);
    assert.strictEqual(parsed.reason, "Missing primary release date");
    assert.strictEqual(parsed.missing, "Release date");
  });

  it("Evaluator parser throws on non-boolean sufficient or missing reason", () => {
    assert.throws(
      () => parseAndValidateJudgeResponse(JSON.stringify({ reason: "some reason" })),
      { code: "MALFORMED_OUTPUT" }
    );

    assert.throws(
      () => parseAndValidateJudgeResponse(JSON.stringify({ sufficient: true, reason: "" })),
      { code: "MALFORMED_OUTPUT" }
    );
  });

  it("Evaluator timeout is strictly enforced and cleans up timer", async () => {
    const hangingOllama = createMockOllama(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return { message: { content: "{}" } };
    });

    const result = await evaluateEvidenceSufficiency(
      "Test query for timeout",
      [{ id: 1, title: "Test Title", url: "https://test.com", text: "Some text" }],
      { ollamaClient: hangingOllama, timeoutMs: 50 }
    );

    assert.strictEqual(result.sufficient, false);
    assert.strictEqual(result.status, "verification_failed");
    assert.ok(result.reason.includes("timed out after 50ms"));
    assert.strictEqual(result.errorCode, "TIMEOUT");
  });
});
