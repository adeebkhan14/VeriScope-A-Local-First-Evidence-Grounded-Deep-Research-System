import bm25 from "wink-bm25-text-search";

const engine = bm25();

export function buildIndex(chunks) {
  engine.reset();
  engine.defineConfig({
    fldWeights: {
      text: 1,
    },
  });
  engine.definePrepTasks([
    (text) => text.toLowerCase(),
    (text) => text.split(/\s+/),
  ]);

  chunks.forEach((chunk, index) => {
    engine.addDoc(
      {
        text: chunk.text,
      },
      index
    );
  });

  engine.consolidate();

  return engine;
}

export function searchBM25(query, chunks, topK = 5) {
  const results = engine.search(query);

  return results
    .slice(0, topK)
    .map((result) => {
      const chunkIndex = result[0];
      const score = result[1];

      return {
        ...chunks[chunkIndex],
        bm25Score: score,
      };
    });
}