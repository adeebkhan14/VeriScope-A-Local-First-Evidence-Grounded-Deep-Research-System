import { generateAnswer } from "./llm/mistral.js";
import { buildEvidencePackage } from "./retrieval/evidence.js";
import { discoverUrls } from "./scraper/searchEngine.js";
import { scrapePage } from "./scraper/scraper.js";
import { chunkText } from "./retrieval/chunker.js";
import { buildIndex, searchBM25 } from "./retrieval/bm25.js";
import { getEmbeddings } from "./retrieval/embeddings.js";
import { cosineSimilarity } from "./retrieval/semanticsearch.js";
import { minMaxNormalize } from "./retrieval/normalize.js";


// ==========================================
// CONFIGURATION
// ==========================================

const query = "how does Kubernetes perform service discovery";

const TOP_K = 5;


// ==========================================
// 1. SEARCH WITH SEARXNG
// ==========================================

console.log("\n========================================");
console.log("1. SEARCHING WITH SEARXNG");
console.log("========================================\n");

console.log("Query:", query);

const searchResults = await discoverUrls(query);

console.log(`Found ${searchResults.length} search results`);


// ==========================================
// 2. SCRAPE WEBPAGES
// ==========================================

console.log("\n========================================");
console.log("2. SCRAPING WEBPAGES");
console.log("========================================\n");

const pages = [];

for (const result of searchResults) {

  console.log(`Scraping: ${result.title}`);

  const page = await scrapePage(result);

  if (page.content && page.content.length > 0) {

    pages.push(page);

    console.log(
      `✓ Success (${page.method}) - ${page.content.length} characters`
    );

  } else {

    console.log("✗ No useful content");

  }
}

console.log(`\nSuccessfully scraped ${pages.length} pages`);


// ==========================================
// 3. CHUNK WEBPAGES
// ==========================================

console.log("\n========================================");
console.log("3. CHUNKING WEBPAGES");
console.log("========================================\n");

const chunks = [];

let chunkId = 0;

for (const page of pages) {

  const pageChunks = chunkText(page.content, {
    chunkSize: 1000,
    overlap: 200,
  });

  pageChunks.forEach((text) => {

    chunks.push({
      id: chunkId++,
      title: page.title,
      url: page.url,
      text: text,
    });

  });

  console.log(
    `${page.title} → ${pageChunks.length} chunks`
  );
}

console.log(`\nTotal chunks: ${chunks.length}`);


// Stop if no chunks were created

if (chunks.length === 0) {

  console.log("No chunks available.");

  process.exit(0);
}


// ==========================================
// 4. BUILD BM25 INDEX
// ==========================================

console.log("\n========================================");
console.log("4. BUILDING BM25 INDEX");
console.log("========================================\n");

buildIndex(chunks);

console.log("✓ BM25 index built");


// ==========================================
// 5. GET BM25 RESULTS
// ==========================================

console.log("\n========================================");
console.log("5. RUNNING BM25");
console.log("========================================\n");

const bm25Results = searchBM25(
  query,
  chunks,
  chunks.length
);


// Add BM25 scores to original chunks

bm25Results.forEach((result) => {

  const chunk = chunks.find(
    (chunk) => chunk.id === result.id
  );

  if (chunk) {
    chunk.bm25Score = result.bm25Score;
  }

});

console.log("✓ BM25 scores calculated");


// ==========================================
// 6. GENERATE CHUNK EMBEDDINGS
// ==========================================

console.log("\n========================================");
console.log("6. GENERATING CHUNK EMBEDDINGS");
console.log("========================================\n");

const chunkTexts = chunks.map(
  (chunk) => chunk.text
);

console.log(
  `Sending ${chunkTexts.length} chunks to local MiniLM...`
);

const chunkEmbeddings = await getEmbeddings(
  chunkTexts
);


// Attach embeddings to chunks

chunks.forEach((chunk, index) => {

  chunk.embedding = chunkEmbeddings[index];

});

console.log("✓ Chunk embeddings generated");


// ==========================================
// 7. GENERATE QUERY EMBEDDING
// ==========================================

console.log("\n========================================");
console.log("7. GENERATING QUERY EMBEDDING");
console.log("========================================\n");

const queryEmbedding = (
  await getEmbeddings([query])
)[0];

console.log("✓ Query embedding generated");


// ==========================================
// 8. CALCULATE SEMANTIC SCORES
// ==========================================

console.log("\n========================================");
console.log("8. CALCULATING SEMANTIC SCORES");
console.log("========================================\n");

chunks.forEach((chunk) => {

  chunk.semanticScore = cosineSimilarity(
    queryEmbedding,
    chunk.embedding
  );

});

console.log("✓ Semantic scores calculated");


// ==========================================
// 9. NORMALIZE SCORES
// ==========================================

console.log("\n========================================");
console.log("9. NORMALIZING SCORES");
console.log("========================================\n");


// BM25 scores

const bm25Scores = chunks.map(
  (chunk) => chunk.bm25Score || 0
);


// Semantic scores

const semanticScores = chunks.map(
  (chunk) => chunk.semanticScore || 0
);


// Normalize both

const normalizedBM25 =
  minMaxNormalize(bm25Scores);

const normalizedSemantic =
  minMaxNormalize(semanticScores);


// Attach normalized scores

chunks.forEach((chunk, index) => {

  chunk.normalizedBM25 =
    normalizedBM25[index];

  chunk.normalizedSemantic =
    normalizedSemantic[index];

});

console.log("✓ Scores normalized");


// ==========================================
// 10. HYBRID SCORE
// ==========================================

console.log("\n========================================");
console.log("10. CALCULATING HYBRID SCORES");
console.log("========================================\n");


chunks.forEach((chunk) => {

  chunk.hybridScore =
    0.5 * chunk.normalizedBM25 +
    0.5 * chunk.normalizedSemantic;

});


// ==========================================
// 11. SORT BY HYBRID SCORE
// ==========================================

const hybridResults = [...chunks]
  .sort(
    (a, b) =>
      b.hybridScore - a.hybridScore
  )
  .slice(0, TOP_K);


  // ==========================================
// BUILD EVIDENCE PACKAGE
// ==========================================

console.log("\n========================================");
console.log("12. BUILDING EVIDENCE PACKAGE");
console.log("========================================\n");

const evidencePackage = buildEvidencePackage(
  query,
  hybridResults
);

// ==========================================
// 13. GENERATE GROUNDED ANSWER
// ==========================================

console.log("\n========================================");
console.log("13. GENERATING GROUNDED ANSWER");
console.log("========================================\n");

const answer = await generateAnswer(
  evidencePackage.query,
  evidencePackage.evidence
);

console.log("\nANSWER:\n");
console.log(answer);

console.log(
  JSON.stringify(evidencePackage, null, 2)
);


// ==========================================
// 12. DISPLAY FINAL EVIDENCE
// ==========================================

console.log("\n========================================");
console.log("11. TOP HYBRID EVIDENCE");
console.log("========================================\n");


hybridResults.forEach((result, index) => {

  console.log(
    `\n========== RESULT ${index + 1} ==========`
  );

  console.log(
    "Hybrid Score:",
    result.hybridScore.toFixed(4)
  );

  console.log(
    "BM25 Score:",
    result.normalizedBM25.toFixed(4)
  );

  console.log(
    "Semantic Score:",
    result.normalizedSemantic.toFixed(4)
  );

  console.log(
    "\nTitle:",
    result.title
  );

  console.log(
    "URL:",
    result.url
  );

  console.log(
    "\nEvidence:"
  );

  console.log(result.text);

});