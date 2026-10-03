import ollama from "ollama";

export async function generateAnswer(query, evidence) {
  const evidenceText = evidence
    .map(
      (item) => `
[Source ${item.id}]
Title: ${item.title}
URL: ${item.url}

Evidence:
${item.text}
`
    )
    .join("\n--------------------\n");

  const prompt = `
You are a research assistant.

Answer the user's question using ONLY the evidence provided below.

Rules:
1. Do not use outside knowledge.
2. Do not invent facts.
3. If the evidence is insufficient, say that the evidence is insufficient.
4. Give a clear and concise answer.
5. Refer to evidence using [Source N].

User question:
${query}

Evidence:
${evidenceText}
`;

  const response = await ollama.chat({
    model: "mistral",
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    options: {
      num_predict: 256,
    },
  });

  return response.message.content;
}