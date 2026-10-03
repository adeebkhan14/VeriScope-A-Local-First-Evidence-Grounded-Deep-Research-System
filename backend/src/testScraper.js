import { discoverUrls } from "./scraper/searchEngine.js";
import { scrapePage } from "./scraper/scraper.js";
import { chunkText } from "./retrieval/chunker.js";

const query = "artificial intelligence";

console.log("Searching...\n");

const results = await discoverUrls(query);

console.log(`Found ${results.length} results\n`);

if (results.length > 0) {
  const page = await scrapePage(results[0]);

  console.log("===== SCRAPED PAGE =====");
  console.log("TITLE:", page.title);
  console.log("URL:", page.url);
  console.log("METHOD:", page.method);
  console.log("CONTENT LENGTH:", page.content.length);

  const chunks = chunkText(page.content);

  console.log("\n===== CHUNKS =====");
  console.log("Number of chunks:", chunks.length);

  chunks.forEach((chunk, index) => {
    console.log(`\n--- CHUNK ${index + 1} ---`);
    console.log(chunk);
  });
}