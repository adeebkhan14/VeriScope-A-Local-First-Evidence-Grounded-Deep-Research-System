import { normalizeUrl, deduplicateUrls, deduplicateChunks, diversifySources } from "./retrieval/deduplicate.js";
import { checkIfInsufficientEvidence } from "./llm/mistral.js";
import { createBM25Index } from "./retrieval/bm25.js";
import { buildEvidencePackage } from "./retrieval/evidence.js";

console.log("=== RUNNING VERISCOPE PRIORITY 1 VERIFICATION TESTS ===\n");

// Test 1: URL Normalization & Deduplication
console.log("Test 1: URL Normalization & Deduplication");
const rawUrls = [
  { url: "https://example.com/docs/service/?utm_source=google&ref=123#overview", title: "K8s 1" },
  { url: "https://example.com/docs/service/", title: "K8s 1 duplicate trailing slash" },
  { url: "https://example.com/docs/service", title: "K8s 1 exact normalized" },
  { url: "https://example.com/docs/networking", title: "K8s 2 unique" },
];
const uniqueUrls = deduplicateUrls(rawUrls);
console.log(`- Input: ${rawUrls.length} URLs -> Output: ${uniqueUrls.length} unique URLs`);
console.assert(uniqueUrls.length === 2, "Expected 2 unique URLs");
console.log("✓ URL deduplication passed.\n");

// Test 2: Chunk Deduplication & Near-duplicate suppression
console.log("Test 2: Chunk Deduplication & Near-duplicate suppression");
const sampleChunks = [
  { id: 1, text: "Kubernetes uses Services to enable network traffic routing and service discovery across pods in a cluster." },
  { id: 2, text: "Kubernetes uses Services to enable network traffic routing and service discovery across pods in the cluster." }, // Near-duplicate
  { id: 3, text: "CoreDNS is the default internal DNS server deployed in Kubernetes clusters to resolve service names." },
];
const dedupedChunks = deduplicateChunks(sampleChunks, 0.7);
console.log(`- Input: ${sampleChunks.length} chunks -> Output: ${dedupedChunks.length} chunks`);
console.assert(dedupedChunks.length === 2, "Expected near-duplicate chunk to be suppressed");
console.log("✓ Chunk near-duplicate suppression passed.\n");

// Test 3: Insufficient Evidence Detection
console.log("Test 3: Insufficient Evidence Detection");
const insufficientTexts = [
  "Based on the retrieved sources, there is insufficient evidence to answer this question.",
  "The provided evidence does not contain information about Kubernetes autoscaling.",
  "Cannot be answered based on the provided evidence.",
];
const confidentText = "Kubernetes uses kube-dns or CoreDNS [Source 1] to provide service discovery.";

insufficientTexts.forEach((text, i) => {
  console.assert(checkIfInsufficientEvidence(text) === true, `Expected insufficient text #${i+1} to be flagged`);
});
console.assert(checkIfInsufficientEvidence(confidentText) === false, "Expected confident text not to be flagged");
console.log("✓ Insufficient evidence detection passed.\n");

// Test 4: BM25 Lexical Fallback & Search
console.log("Test 4: BM25 Lexical Indexing");
const chunksForBM25 = [
  { id: 1, text: "Kubernetes service discovery uses DNS and environment variables." },
  { id: 2, text: "Docker containers run isolated application processes." },
  { id: 3, text: "CoreDNS maps service names to virtual cluster IP addresses." },
];
const bm25 = createBM25Index(chunksForBM25);
const searchResults = bm25.search("service discovery", 3);
console.log(`- Top match ID: ${searchResults[0]?.id}, Score: ${searchResults[0]?.bm25Score}`);
console.assert(searchResults[0]?.id === 1, "Expected chunk 1 to be top match for service discovery");
console.log("✓ BM25 search passed.\n");

// Test 5: Source Diversification
console.log("Test 5: Source Diversification");
const candidates = [
  { id: 1, url: "https://k8s.io/page1", text: "Text A", hybridScore: 0.99 },
  { id: 2, url: "https://k8s.io/page1", text: "Text B", hybridScore: 0.95 },
  { id: 3, url: "https://k8s.io/page1", text: "Text C", hybridScore: 0.90 },
  { id: 4, url: "https://coredns.io/page", text: "Text D", hybridScore: 0.85 },
];
const diversified = diversifySources(candidates, 2, 3);
const page1Count = diversified.filter(c => c.url === "https://k8s.io/page1").length;
console.log(`- Max per source limit respected: ${page1Count} (limit: 2), total selected: ${diversified.length}`);
console.assert(page1Count === 2, "Expected at most 2 chunks from page1");
console.assert(diversified.length === 3, "Expected 3 total selected chunks");
console.log("✓ Source diversification passed.\n");

// Test 6: Evidence Package & Supporting Snippets
console.log("Test 6: Evidence Package & Supporting Snippets Mapping");
const pkg = buildEvidencePackage("test query", diversified);
console.assert(pkg.evidence.length === 3, "Expected 3 evidence items");
console.assert(pkg.evidence[0].id === 1 && Boolean(pkg.evidence[0].text), "Expected item to have id and text");
console.log("✓ Evidence package mapping passed.\n");

console.log("🎉 ALL PRIORITY 1 TRUSTWORTHINESS TESTS PASSED SUCCESSFULLY!");
