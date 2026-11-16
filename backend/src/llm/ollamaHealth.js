import axios from "axios";
import { OLLAMA_MODEL, OLLAMA_URL, classifyOllamaError } from "./ollamaClient.js";

const HEALTH_TIMEOUT_MS = 4000;

export function isValidOllamaModelName(model) {
  return (
    typeof model === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9._/-]*(?::[a-zA-Z0-9._-]+)?$/.test(model)
  );
}

export async function checkOllamaHealth({
  url = OLLAMA_URL,
  model = OLLAMA_MODEL,
  get = axios.get,
  timeoutMs = HEALTH_TIMEOUT_MS,
} = {}) {
  const baseUrl = url.replace(/\/+$/, "");

  let response;
  try {
    response = await get(`${baseUrl}/api/tags`, { timeout: timeoutMs });
  } catch (error) {
    const failure = classifyOllamaError(error, {
      model,
      url: baseUrl,
      operation: "health",
    });
    return {
      status: failure.status,
      available: false,
      reachable: false,
      url: baseUrl,
      model: { name: model, installed: false, status: failure.status },
      error: failure.message,
      errorCode: failure.code,
    };
  }

  if (!isValidOllamaModelName(model)) {
    return {
      status: "error",
      available: true,
      reachable: true,
      url: baseUrl,
      model: { name: model, installed: false, status: "error" },
      error: `OLLAMA_MODEL "${model}" is not a valid Ollama model name.`,
      errorCode: "INVALID_MODEL_NAME",
    };
  }

  const installedModels = response.data?.models;
  if (!Array.isArray(installedModels)) {
    return {
      status: "error",
      available: true,
      reachable: true,
      url: baseUrl,
      model: { name: model, installed: false, status: "error" },
      error: "Ollama /api/tags returned an invalid model list.",
      errorCode: "INVALID_OLLAMA_RESPONSE",
    };
  }

  const installed = installedModels.some(
    (entry) => entry?.name === model || entry?.model === model
  );
  const status = installed ? "online" : "model_missing";

  return {
    status,
    available: true,
    reachable: true,
    url: baseUrl,
    model: { name: model, installed, status },
    error: installed
      ? undefined
      : `Ollama is online, but model "${model}" is not installed. Run 'ollama pull ${model}'.`,
    errorCode: installed ? undefined : "MODEL_NOT_INSTALLED",
  };
}

async function checkHttpService(url, { get = axios.get, timeoutMs = HEALTH_TIMEOUT_MS } = {}) {
  try {
    await get(url, { timeout: timeoutMs });
    return { status: "online", available: true, url };
  } catch (error) {
    const timeout =
      error?.code === "ETIMEDOUT" ||
      error?.code === "ECONNABORTED" ||
      error?.message?.toLowerCase().includes("timeout");
    return {
      status: timeout ? "error" : "offline",
      available: false,
      url,
      error: error?.message || "Unknown service health check error",
      errorCode: timeout ? "TIMEOUT" : error?.code || "SERVICE_UNAVAILABLE",
    };
  }
}

export async function checkServiceHealth() {
  const searxngUrl = (process.env.SEARXNG_URL || "http://localhost:8080").replace(/\/+$/, "");
  const embeddingUrl = process.env.EMBEDDING_URL
    ? process.env.EMBEDDING_URL.replace(/\/embed\/?$/, "")
    : "http://127.0.0.1:8000";

  const [ollama, searxng, embedding] = await Promise.all([
    checkOllamaHealth(),
    checkHttpService(`${searxngUrl}/search?q=test&format=json`),
    checkHttpService(`${embeddingUrl}/`),
  ]);

  return { ollama, searxng, embedding };
}
