import axios from "axios";
import { deduplicateUrls } from "../retrieval/deduplicate.js";

const SEARXNG_URL = process.env.SEARXNG_URL || "http://localhost:8080";
const MAX_SEARCH_RESULTS = 5;
const RAW_FETCH_LIMIT = 12;

/**
 * Searches the web via local SearXNG and returns deduplicated search results.
 *
 * @param {string} query
 * @returns {Promise<Array<{title: string, url: string, content?: string}>>}
 */
export async function discoverUrls(query) {
  if (typeof query !== "string" || !query.trim()) {
    const error = new Error("A non-empty search query is required.");
    error.code = "INVALID_REQUEST";
    throw error;
  }

  try {
    const response = await axios.get(`${SEARXNG_URL}/search`, {
      timeout: 10000,
      params: {
        q: query,
        format: "json",
      },
    });

    const rawResults = response.data?.results;
    if (!Array.isArray(rawResults)) {
      const error = new Error("SearXNG returned an invalid search response.");
      error.code = "UPSTREAM_INVALID_RESPONSE";
      error.service = "SearXNG";
      throw error;
    }

    if (rawResults.length === 0) {
      return [];
    }

    // Map and normalize
    const candidates = rawResults
      .slice(0, RAW_FETCH_LIMIT)
      .filter((result) => result && typeof result === "object")
      .map((result) => ({
        title: typeof result.title === "string" ? result.title : "Untitled",
        url: result.url,
        content: typeof result.content === "string" ? result.content : "",
      }));

    // Deduplicate URLs
    const uniqueResults = deduplicateUrls(candidates);

    return uniqueResults.slice(0, MAX_SEARCH_RESULTS);
  } catch (error) {
    if (
      error?.code === "INVALID_REQUEST" ||
      error?.code === "UPSTREAM_INVALID_RESPONSE"
    ) {
      throw error;
    }

    const errMsg = error instanceof Error ? error.message : "";
    const lower = errMsg.toLowerCase();
    if (
      error?.code === "ECONNREFUSED" ||
      error?.code === "ENOTFOUND" ||
      error?.code === "EHOSTUNREACH" ||
      error?.code === "EPERM" ||
      lower.includes("econnrefused") ||
      lower.includes("connect")
    ) {
      const serviceError = new Error(
        `Web discovery service (SearXNG) is not reachable at ${SEARXNG_URL}. Please verify the SearXNG service is running.`
      );
      serviceError.code = "SERVICE_UNAVAILABLE";
      serviceError.service = "SearXNG";
      throw serviceError;
    }

    if (error?.code === "ETIMEDOUT" || lower.includes("timeout")) {
      const timeoutError = new Error(
        `SearXNG request timed out after 10 seconds. Check network connectivity or SearXNG response time.`
      );
      timeoutError.code = "TIMEOUT";
      timeoutError.service = "SearXNG";
      throw timeoutError;
    }

    if (error?.response) {
      const upstreamError = new Error(
        `SearXNG returned HTTP ${error.response.status}.`
      );
      upstreamError.code = "UPSTREAM_ERROR";
      upstreamError.service = "SearXNG";
      throw upstreamError;
    }

    const upstreamError = new Error(
      `Web discovery failed${errMsg ? `: ${errMsg}` : "."}`
    );
    upstreamError.code = "UPSTREAM_ERROR";
    upstreamError.service = "SearXNG";
    throw upstreamError;
  }
}