import axios from "axios";

const EMBEDDING_URL = process.env.EMBEDDING_URL || "http://127.0.0.1:8000/embed";
const EMBEDDING_TIMEOUT_MS = 30000;

/**
 * Requests embeddings from the local MiniLM embedding microservice.
 * Throws a descriptive error if the service is unreachable or fails.
 *
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
export async function getEmbeddings(texts) {
  if (!Array.isArray(texts) || texts.length === 0) {
    return [];
  }

  try {
    const response = await axios.post(
      EMBEDDING_URL,
      { texts },
      { timeout: EMBEDDING_TIMEOUT_MS }
    );

    return response.data?.embeddings || [];
  } catch (error) {
    if (error.code === "ECONNREFUSED" || error.message?.includes("ECONNREFUSED")) {
      const err = new Error(
        `Local embedding microservice is unreachable at ${EMBEDDING_URL}. Please ensure the FastAPI service is running.`
      );
      err.code = "SERVICE_UNAVAILABLE";
      err.service = "MiniLM";
      throw err;
    }

    if (error.code === "ETIMEDOUT" || error.message?.includes("timeout")) {
      const err = new Error(
        `Local embedding microservice timed out after ${EMBEDDING_TIMEOUT_MS / 1000} seconds.`
      );
      err.code = "TIMEOUT";
      err.service = "MiniLM";
      throw err;
    }

    throw error;
  }
}

/**
 * Safely requests embeddings with fallback detection.
 * If the embedding service is offline or unreachable, returns available: false
 * so the pipeline can gracefully fall back to BM25 lexical retrieval.
 *
 * @param {string[]} texts
 * @returns {Promise<{embeddings: number[][] | null, available: boolean, error?: string}>}
 */
export async function getEmbeddingsSafe(texts) {
  if (!Array.isArray(texts) || texts.length === 0) {
    return { embeddings: [], available: true };
  }

  try {
    const embeddings = await getEmbeddings(texts);
    return { embeddings, available: true };
  } catch (error) {
    console.warn(`[Embeddings] Service unavailable (${error.message}). Gracefully falling back to BM25 lexical retrieval.`);
    return {
      embeddings: null,
      available: false,
      error: error.message,
    };
  }
}