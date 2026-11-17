import { Ollama } from "ollama";
import { existsSync } from "node:fs";

export const isRunningInContainer =
  existsSync("/.dockerenv") || existsSync("/run/.containerenv");

export const OLLAMA_URL =
  process.env.OLLAMA_BASE_URL?.trim() ||
  process.env.OLLAMA_URL?.trim() ||
  (isRunningInContainer
    ? "http://host.docker.internal:11434"
    : "http://localhost:11434");

export const OLLAMA_BASE_URL = OLLAMA_URL;

export const OLLAMA_MODEL =
  process.env.OLLAMA_MODEL?.trim() || "qwen3.5:9b";

function positiveIntegerEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

export const OLLAMA_KEEP_ALIVE =
  process.env.OLLAMA_KEEP_ALIVE?.trim() || "30m";
export const OLLAMA_CONTEXT_LENGTH = positiveIntegerEnv(
  "OLLAMA_CONTEXT_LENGTH",
  4096
);
export const OLLAMA_NUM_PREDICT = positiveIntegerEnv(
  "OLLAMA_NUM_PREDICT",
  2048
);
export const OLLAMA_REQUEST_TIMEOUT_MS = positiveIntegerEnv(
  "OLLAMA_REQUEST_TIMEOUT_MS",
  300000
);
export const OLLAMA_HISTORY_TOKEN_BUDGET = positiveIntegerEnv(
  "OLLAMA_HISTORY_TOKEN_BUDGET",
  1600
);
export const OLLAMA_RECENT_EXCHANGES = positiveIntegerEnv(
  "OLLAMA_RECENT_EXCHANGES",
  5
);
export const OLLAMA_SUMMARY_THRESHOLD_MESSAGES = positiveIntegerEnv(
  "OLLAMA_SUMMARY_THRESHOLD_MESSAGES",
  16
);
export const OLLAMA_SUMMARY_MIN_NEW_MESSAGES = positiveIntegerEnv(
  "OLLAMA_SUMMARY_MIN_NEW_MESSAGES",
  6
);
export const OLLAMA_SUMMARY_TOKEN_BUDGET = positiveIntegerEnv(
  "OLLAMA_SUMMARY_TOKEN_BUDGET",
  500
);
export const OLLAMA_SUMMARY_RETRY_INTERVAL_MS = positiveIntegerEnv(
  "OLLAMA_SUMMARY_RETRY_INTERVAL_MS",
  300000
);
export const OLLAMA_HISTORICAL_EVIDENCE_TOKEN_BUDGET = positiveIntegerEnv(
  "OLLAMA_HISTORICAL_EVIDENCE_TOKEN_BUDGET",
  300
);
export const OLLAMA_MIN_OUTPUT_TOKENS = positiveIntegerEnv(
  "OLLAMA_MIN_OUTPUT_TOKENS",
  696
);
export const OLLAMA_CONTEXT_SAFETY_MARGIN = positiveIntegerEnv(
  "OLLAMA_CONTEXT_SAFETY_MARGIN",
  256
);
export const OLLAMA_DEBUG_CONTEXT =
  process.env.VERISCOPE_DEBUG_CONTEXT === "true";

const temperature = Number(process.env.OLLAMA_TEMPERATURE ?? 0.3);
if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
  throw new Error("OLLAMA_TEMPERATURE must be a number between 0 and 2.");
}
export const OLLAMA_TEMPERATURE = temperature;

export async function chatWithTimeout(
  client,
  request,
  { signal, timeoutMs = OLLAMA_REQUEST_TIMEOUT_MS } = {}
) {
  if (signal?.aborted) {
    const error = new Error("The Ollama request was cancelled.");
    error.name = "AbortError";
    error.code = "ABORT_ERR";
    throw error;
  }

  let timedOut = false;
  let timer;
  let onAbort;
  const timeoutError = new Error(`Ollama request timed out after ${timeoutMs}ms.`);
  timeoutError.name = "TimeoutError";
  timeoutError.code = "TIMEOUT";

  const cancellation = new Promise((_, reject) => {
    if (signal) {
      onAbort = () => {
        client.abort?.();
        const error = new Error("The Ollama request was cancelled.");
        error.name = "AbortError";
        error.code = "ABORT_ERR";
        reject(error);
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }

    timer = setTimeout(() => {
      timedOut = true;
      client.abort?.();
      reject(timeoutError);
    }, timeoutMs);
    timer.unref?.();
  });

  const pendingRequest = Promise.resolve().then(() => client.chat(request));
  pendingRequest.then((response) => {
    if (timedOut || signal?.aborted) response?.abort?.();
  }).catch(() => {});

  try {
    return await Promise.race([pendingRequest, cancellation]);
  } catch (error) {
    if (timedOut) throw timeoutError;
    if (signal?.aborted) {
      const abortError = new Error("The Ollama request was cancelled.");
      abortError.name = "AbortError";
      abortError.code = "ABORT_ERR";
      throw abortError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

export function classifyOllamaError(
  error,
  { model = OLLAMA_MODEL, url = OLLAMA_URL, operation = "generation" } = {}
) {
  const message =
    typeof error?.message === "string" ? error.message : String(error || "Unknown Ollama error");
  const lower = message.toLowerCase();
  const code = error?.code || error?.cause?.code;
  const responseCode = error?.response?.data?.code;
  const isInvalidModel =
    lower.includes("invalid model") ||
    lower.includes("invalid model name") ||
    lower.includes("invalid model format");
  const isMissingModel =
    lower.includes("model not found") ||
    lower.includes("model") && (lower.includes("not found") || lower.includes("does not exist")) ||
    (operation !== "health" &&
      (error?.status === 404 || error?.response?.status === 404));

  if (isInvalidModel) {
    return {
      status: "error",
      code: "INVALID_MODEL_NAME",
      message: `Ollama rejected the configured model name "${model}". Check OLLAMA_MODEL.`,
    };
  }

  if (isMissingModel) {
    return {
      status: "model_missing",
      code: "MODEL_NOT_INSTALLED",
      message: `Ollama is reachable, but model "${model}" is not installed. Run 'ollama pull ${model}'.`,
    };
  }

  if (
    code === "ETIMEDOUT" ||
    code === "ECONNABORTED" ||
    error?.name === "TimeoutError" ||
    lower.includes("timed out") ||
    lower.includes("timeout")
  ) {
    return {
      status: "error",
      code: "OLLAMA_TIMEOUT",
      message: `The Ollama request to ${url} timed out. Check that the host is reachable and the model has enough time to load.`,
    };
  }

  if (
    responseCode === "OLLAMA_UPSTREAM_UNAVAILABLE" ||
    ["ECONNREFUSED", "ECONNRESET", "EHOSTDOWN", "EHOSTUNREACH", "ENETDOWN", "ENETUNREACH", "ENOTFOUND", "EAI_AGAIN"].includes(code) ||
    lower.includes("econnrefused") ||
    lower.includes("fetch failed") ||
    lower.includes("socket hang up") ||
    lower.includes("network is unreachable")
  ) {
    const containerLoopback =
      isRunningInContainer && /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(url);
    return {
      status: "offline",
      code: "OLLAMA_UNREACHABLE",
      message: containerLoopback
        ? `The backend is in a container but OLLAMA_BASE_URL points to its own loopback address (${url}). Use http://host.docker.internal:11434.`
        : `The backend could not reach Ollama at ${url}. In Docker, ensure the host Ollama listener is reachable from the Docker bridge without exposing it publicly.`,
    };
  }

  return {
    status: "error",
    code: "OLLAMA_REQUEST_FAILED",
    message: `Ollama request failed: ${message}`,
  };
}

const ollama = new Ollama({ host: OLLAMA_BASE_URL });

export default ollama;
