import { research } from "./research.js";

const query =
  "How does Kubernetes perform service discovery?";

try {

  const result = await research(query);

  console.log("\n========================================");
  console.log("FINAL RESULT");
  console.log("========================================\n");

  console.log("QUESTION:");
  console.log(result.query);

  console.log("\nANSWER:");
  console.log(result.answer);

  console.log("\nCITATIONS:");

  result.citations.forEach((citation) => {

    console.log(
      `[${citation.id}] ${citation.title}`
    );

    console.log(citation.url);
    console.log();

  });

} catch (error) {

  console.error("\nRESEARCH FAILED:");
  console.error(error);

}