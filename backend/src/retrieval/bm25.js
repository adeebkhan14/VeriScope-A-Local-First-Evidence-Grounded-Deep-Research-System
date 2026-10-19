import bm25 from "wink-bm25-text-search";

let defaultEngine = null;
let defaultChunks = [];

/**
 * Creates a dedicated BM25 search index for the provided chunks.
 * If chunks.length < 3, provides term-frequency lexical fallback scoring
 * because wink-bm25 requires at least 3 documents to consolidate.
 *
 * @param {Array<{id: number, text: string}>} chunks
 * @returns {{search: (query: string, topK?: number) => Array<{id: number, text: string, bm25Score: number}>}}
 */
export function createBM25Index(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return {
      search: () => [],
    };
  }

  // Fallback for collections smaller than 3 documents
  if (chunks.length < 3) {
    return {
      search: (query, topK = chunks.length) => {
        const queryTokens = query
          .toLowerCase()
          .replace(/[^\w\s]/g, " ")
          .split(/\s+/)
          .filter((t) => t.length > 0);

        const scored = chunks.map((chunk) => {
          const text = chunk.text.toLowerCase();
          let score = 0;
          for (const token of queryTokens) {
            let idx = 0;
            while ((idx = text.indexOf(token, idx)) !== -1) {
              score += 1;
              idx += token.length;
            }
          }
          return {
            ...chunk,
            bm25Score: score,
          };
        });

        return scored
          .sort((a, b) => b.bm25Score - a.bm25Score)
          .slice(0, topK);
      },
    };
  }

  const engine = bm25();
  engine.defineConfig({
    fldWeights: {
      text: 1,
    },
  });
  engine.definePrepTasks([
    (text) => text.toLowerCase().replace(/[^\w\s]/g, " "),
    (text) => text.split(/\s+/).filter(Boolean),
  ]);

  chunks.forEach((chunk, index) => {
    engine.addDoc(
      {
        text: chunk.text,
      },
      index
    );
  });

  try {
    engine.consolidate();
  } catch (error) {
    console.warn("BM25 consolidation warning:", error.message);
  }

  return {
    search: (query, topK = 5) => {
      try {
        const rawResults = engine.search(query);
        return rawResults.slice(0, topK).map((result) => {
          const chunkIndex = result[0];
          const score = result[1];
          return {
            ...chunks[chunkIndex],
            bm25Score: score,
          };
        });
      } catch {
        return [];
      }
    },
  };
}

/**
 * Backward-compatible buildIndex function.
 */
export function buildIndex(chunks) {
  defaultChunks = chunks;
  defaultEngine = createBM25Index(chunks);
  return defaultEngine;
}

/**
 * Backward-compatible searchBM25 function.
 */
export function searchBM25(query, chunks = defaultChunks, topK = 5) {
  if (!defaultEngine || defaultChunks !== chunks) {
    defaultEngine = createBM25Index(chunks);
    defaultChunks = chunks;
  }
  return defaultEngine.search(query, topK);
}