import { chunkText } from "./retrieval/chunker.js";
import {
  buildIndex,
  searchBM25,
} from "./retrieval/bm25.js";

const webpage = {
  title: "Kubernetes Services",
  url: "https://example.com/kubernetes",
  content: `
    Kubernetes Services provide stable networking endpoints
    for applications running inside a Kubernetes cluster.

    A Service allows clients to access a group of Pods.

    Kubernetes uses Services for service discovery and
    load balancing between Pods.

    Deployments manage the desired number of replicas
    of an application.

    Horizontal Pod Autoscaling can automatically change
    the number of Pods based on resource utilization.
  `,
};


// 1. Chunk the webpage
const textChunks = chunkText(webpage.content, {
  chunkSize: 150,
  overlap: 30,
});


// 2. Add metadata to every chunk
const chunks = textChunks.map((text, index) => ({
  id: index,
  title: webpage.title,
  url: webpage.url,
  text,
}));


// 3. Build BM25 index
buildIndex(chunks);


// 4. Search
const query = "Kubernetes service discovery";

const results = searchBM25(
  query,
  chunks,
  3
);


// 5. Display results
console.log("\nQUERY:");
console.log(query);

console.log("\nTOP RESULTS:");

results.forEach((result, index) => {
  console.log(`\n--- RESULT ${index + 1} ---`);

  console.log("Chunk ID:", result.id);
  console.log("Score:", result.bm25Score);
  console.log("Title:", result.title);
  console.log("URL:", result.url);
  console.log("Text:", result.text);
});