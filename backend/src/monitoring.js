import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { freemem, totalmem } from "node:os";
import axios from "axios";

import {
  OLLAMA_BASE_URL,
  OLLAMA_MODEL,
  classifyOllamaError,
} from "./llm/ollamaClient.js";
import { checkOllamaHealth } from "./llm/ollamaHealth.js";

const execFileAsync = promisify(execFile);
const MONITOR_TIMEOUT_MS = 4000;
let lastResearchMetrics = null;

export function recordResearchMetrics(result) {
  if (!result?.researchMetadata) return;
  lastResearchMetrics = {
    ...result.researchMetadata,
    sessionId: typeof result.sessionId === "string" ? result.sessionId : null,
    recordedAt: new Date().toISOString(),
  };
}

async function getGpuMetrics() {
  const { stdout } = await execFileAsync(
    "nvidia-smi",
    [
      "--query-gpu=name,utilization.gpu,memory.used,memory.total",
      "--format=csv,noheader,nounits",
    ],
    { timeout: MONITOR_TIMEOUT_MS }
  );
  const firstDevice = stdout.trim().split(/\r?\n/)[0];
  if (!firstDevice) throw new Error("nvidia-smi returned no GPU metrics.");
  const [name, utilization, memoryUsed, memoryTotal] = firstDevice
    .split(",")
    .map((value) => value.trim());
  const numericValues = [utilization, memoryUsed, memoryTotal].map(Number);
  if (numericValues.some((value) => !Number.isFinite(value))) {
    throw new Error("nvidia-smi returned invalid GPU metrics.");
  }
  return {
    name,
    utilizationPercent: numericValues[0],
    memoryUsedMiB: numericValues[1],
    memoryTotalMiB: numericValues[2],
  };
}

function getModelAllocation(model) {
  if (
    !model ||
    !Number.isFinite(model.size) ||
    !Number.isFinite(model.size_vram)
  ) {
    return {
      gpuBytes: null,
      cpuBytes: null,
      processor: "unavailable",
      estimated: true,
    };
  }
  const gpuBytes = Math.min(model.size, model.size_vram);
  const cpuBytes = Math.max(0, model.size - gpuBytes);
  const processor =
    gpuBytes === 0
      ? "CPU"
      : cpuBytes === 0
        ? "GPU"
        : "CPU/GPU";
  return { gpuBytes, cpuBytes, processor, estimated: true };
}

export async function getMonitoringSnapshot({
  get = axios.get,
  getHealth = checkOllamaHealth,
  getGpu = getGpuMetrics,
  baseUrl = OLLAMA_BASE_URL,
  modelName = OLLAMA_MODEL,
} = {}) {
  const normalizedUrl = baseUrl.replace(/\/+$/, "");
  const [healthResult, modelsResult, gpuResult] = await Promise.allSettled([
    getHealth({ url: normalizedUrl, model: modelName, get }),
    get(`${normalizedUrl}/api/ps`, { timeout: MONITOR_TIMEOUT_MS }),
    getGpu(),
  ]);

  const health =
    healthResult.status === "fulfilled"
      ? healthResult.value
      : {
          status: "offline",
          available: false,
          error: classifyOllamaError(healthResult.reason, {
            model: modelName,
            url: normalizedUrl,
            operation: "health",
          }).message,
        };
  const runningModels =
    modelsResult.status === "fulfilled" &&
    Array.isArray(modelsResult.value?.data?.models)
      ? modelsResult.value.data.models
      : [];
  const loadedModel =
    runningModels.find(
      (entry) => entry?.name === modelName || entry?.model === modelName
    ) || null;
  const allocation = getModelAllocation(loadedModel);
  const cpuMemoryTotalBytes = totalmem();
  const cpuMemoryAvailableBytes = freemem();

  return {
    capturedAt: new Date().toISOString(),
    model: {
      name: modelName,
      available: Boolean(health.available),
      status: health.status || "unavailable",
      installed: health.model?.installed ?? null,
      loaded: Boolean(loadedModel),
      loadedName: loadedModel?.name || null,
      modelBytes: Number.isFinite(loadedModel?.size)
        ? loadedModel.size
        : null,
      contextLength: Number.isInteger(loadedModel?.context_length)
        ? loadedModel.context_length
        : null,
      expiresAt: loadedModel?.expires_at || null,
      allocation,
    },
    ollamaError: health.error || null,
    modelListError:
      modelsResult.status === "rejected"
        ? classifyOllamaError(modelsResult.reason, {
            model: modelName,
            url: normalizedUrl,
            operation: "health",
          }).message
        : null,
    gpu:
      gpuResult.status === "fulfilled"
        ? { available: true, ...gpuResult.value }
        : {
            available: false,
            name: null,
            utilizationPercent: null,
            memoryUsedMiB: null,
            memoryTotalMiB: null,
            error:
              gpuResult.reason instanceof Error
                ? gpuResult.reason.message
                : "GPU metrics are unavailable.",
          },
    cpuMemory: {
      totalBytes: cpuMemoryTotalBytes,
      usedBytes: Math.max(0, cpuMemoryTotalBytes - cpuMemoryAvailableBytes),
      availableBytes: cpuMemoryAvailableBytes,
    },
    retrieval: lastResearchMetrics,
  };
}
