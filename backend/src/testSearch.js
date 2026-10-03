import { discoverUrls } from "./scraper/searchEngine.js";

const query = "artificial intelligence";

console.log("Searching for:", query);

const results = await discoverUrls(query);

console.log("\nRESULTS:\n");

results.forEach((result, index) => {
  console.log(`--- RESULT ${index + 1} ---`);
  console.log("Title:", result.title);
  console.log("URL:", result.url);
  console.log("Content:", result.content);
  console.log();
})  