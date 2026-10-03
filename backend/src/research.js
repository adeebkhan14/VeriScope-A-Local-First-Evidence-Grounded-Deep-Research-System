import { discoverUrls } from "./scraper/searchEngine.js";
import { scrapePage } from "./scraper/scraper.js";

import { chunkText } from "./retrieval/chunker.js";
import {
  buildIndex,
  searchBM25,
} from "./retrieval/bm25.js";

import { getEmbeddings } from "./retrieval/embeddings.js";
import { cosineSimilarity } from "./retrieval/semanticsearch.js";
import { minMaxNormalize } from "./retrieval/normalize.js";
import { buildEvidencePackage } from "./retrieval/evidence.js";

import { generateAnswer } from "./llm/mistral.js";

const MAX_PAGES_TO_SCRAPE = 5;
const MAX_PAGE_CHARACTERS = 6000;
const MAX_EMBEDDING_CANDIDATES = 20;
const MAX_EVIDENCE_CHUNKS = 5;


// ==========================================
// MAIN RESEARCH PIPELINE
// ==========================================

export async function research(query) {

  console.log("\n========================================");
  console.log("STARTING RESEARCH");
  console.log("========================================");

  console.log("Query:", query);


  // ========================================
  // 1. SEARCH WITH SEARXNG
  // ========================================

  console.log("\n[1] Searching with SearXNG...");

  const searchResults = await discoverUrls(query);

  console.log(
    `Found ${searchResults.length} search results`
  );

  if (searchResults.length === 0) {
    throw new Error("No search results found");
  }


  // ========================================
  // 2. SCRAPE WEBPAGES
  // ========================================

  console.log("\n[2] Scraping webpages...");

  const selectedResults = searchResults.slice(0, MAX_PAGES_TO_SCRAPE);
  console.log(`Scraping the top ${selectedResults.length} results in parallel`);
  const scrapedPages = await Promise.all(
    selectedResults.map(async (result) => {
      console.log(`Scraping: ${result.title}`);
      const page = await scrapePage(result, { allowBrowserFallback: false });
      const content = page.content.trim() || result.content?.trim() || "";

      if (!content) {
        console.log(`No usable content: ${result.url}`);
        return null;
      }

      return {
        ...page,
        content: content.slice(0, MAX_PAGE_CHARACTERS),
      };
    })
  );
  const pages = scrapedPages.filter(Boolean);

  console.log(
    `Successfully scraped ${pages.length} pages`
  );

  if (pages.length === 0) {
    throw new Error("Could not scrape any useful webpages");
  }


  // ========================================
  // 3. CHUNK WEBPAGES
  // ========================================

  console.log("\n[3] Chunking webpages...");

  const chunks = [];

  let chunkId = 0;

  for (const page of pages) {

    const pageChunks = chunkText(
      page.content,
      {
        chunkSize: 1000,
        overlap: 200,
      }
    );

    pageChunks.forEach((text) => {

      chunks.push({
        id: chunkId++,
        title: page.title,
        url: page.url,
        text,
      });

    });
  }

  console.log(`Created ${chunks.length} chunks`);

  if (chunks.length === 0) {
    throw new Error("No chunks were created");
  }


  // ========================================
  // 4. BUILD BM25 INDEX
  // ========================================

  console.log("\n[4] Building BM25 index...");

  let bm25Results = [];
  if (chunks.length >= 3) {
    buildIndex(chunks);
    bm25Results = searchBM25(query, chunks, chunks.length);
  }
  const bm25Scores = new Map(
    bm25Results.map((result) => [result.id, result.bm25Score])
  );
  chunks.forEach((chunk) => {
    chunk.bm25Score = bm25Scores.get(chunk.id) ?? 0;
  });

  console.log("✓ BM25 complete");


  // ========================================
  // 5. SELECT BM25 CANDIDATES AND GENERATE EMBEDDINGS
  // ========================================

  console.log("\n[5] Generating embeddings for the strongest BM25 candidates...");
  const candidates = [...chunks]
    .sort((a, b) => b.bm25Score - a.bm25Score)
    .slice(0, MAX_EMBEDDING_CANDIDATES);
  const embeddings = await getEmbeddings([
    query,
    ...candidates.map((chunk) => chunk.text),
  ]);
  const [queryEmbedding, ...chunkEmbeddings] = embeddings;

  candidates.forEach((chunk, index) => {
    chunk.semanticScore = cosineSimilarity(queryEmbedding, chunkEmbeddings[index]);
  });
  console.log(`✓ Ranked ${candidates.length} candidates semantically`);


  // ========================================
  // 6. NORMALIZE AND COMBINE SCORES
  // ========================================

  console.log("\n[6] Normalizing and combining scores...");
  const normalizedBM25 = minMaxNormalize(candidates.map((chunk) => chunk.bm25Score));
  const normalizedSemantic = minMaxNormalize(candidates.map((chunk) => chunk.semanticScore));
  candidates.forEach((chunk, index) => {
    chunk.hybridScore =
      0.5 * normalizedBM25[index] + 0.5 * normalizedSemantic[index];
  });


  // ========================================
  // 7. SELECT TOP EVIDENCE
  // ========================================

  console.log("\n[7] Selecting top evidence...");
  const hybridResults = [...candidates]
    .sort((a, b) => b.hybridScore - a.hybridScore)
    .slice(0, MAX_EVIDENCE_CHUNKS);

  console.log(
    `Selected top ${hybridResults.length} chunks`
  );


  // ========================================
  // 8. BUILD EVIDENCE PACKAGE
  // ========================================

  console.log("\n[8] Building evidence package...");

  const evidencePackage =
    buildEvidencePackage(
      query,
      hybridResults
    );


  // ========================================
  // 9. ASK MISTRAL
  // ========================================

  console.log("\n[9] Asking local Mistral...");

  const answer = await generateAnswer(
    evidencePackage.query,
    evidencePackage.evidence
  );

  console.log("✓ Mistral generated answer");


  // ========================================
  // 10. RETURN FINAL RESULT
  // ========================================

  return {

    query,

    answer,

    citations:
      evidencePackage.evidence.map(
        (source) => ({
          id: source.id,
          title: source.title,
          url: source.url,
        })
      ),

    evidence:
      evidencePackage.evidence.map(
        (source) => ({
          id: source.id,
          title: source.title,
          url: source.url,
          text: source.text,
          score: source.score,
        })
      ),
  };
}