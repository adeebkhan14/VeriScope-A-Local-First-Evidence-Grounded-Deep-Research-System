import axios from "axios";

const EMBEDDING_URL = "http://127.0.0.1:8000/embed";

export async function getEmbeddings(texts) {
  try {
    const response = await axios.post(EMBEDDING_URL, { texts }, { timeout: 30000 });

    return response.data.embeddings;
  } catch (error) {
    console.error("Embedding service failed:");
    console.error(error.message);

    throw error;
  }
}