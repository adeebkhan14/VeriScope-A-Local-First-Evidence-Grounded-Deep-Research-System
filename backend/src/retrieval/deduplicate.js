/**
 * URL and Chunk deduplication utilities for VeriScope.
 */

/**
 * Normalizes a URL by removing tracking query parameters, hashes,
 * trailing slashes, and normalizing protocol/hostname.
 *
 * @param {string} rawUrl
 * @returns {string}
 */
export function normalizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return "";

  try {
    const parsed = new URL(rawUrl.trim());

    // Normalize protocol and host to lowercase
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();

    // Strip hash/fragment
    parsed.hash = "";

    // Remove tracking and analytics query parameters
    const trackingParamPrefixes = [
      "utm_",
      "ga_",
      "mc_",
      "yclid",
      "_hsenc",
      "_hsmi",
    ];
    const trackingParams = new Set([
      "ref",
      "ref_src",
      "fbclid",
      "gclid",
      "msclkid",
      "source",
      "mc_cid",
      "mc_eid",
    ]);

    const keysToDelete = [];
    for (const key of parsed.searchParams.keys()) {
      const lowerKey = key.toLowerCase();
      if (
        trackingParams.has(lowerKey) ||
        trackingParamPrefixes.some((prefix) => lowerKey.startsWith(prefix))
      ) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach((key) => parsed.searchParams.delete(key));

    // Remove trailing slash if path is longer than "/"
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }

    return parsed.toString();
  } catch {
    return rawUrl.trim();
  }
}

/**
 * Deduplicates search results based on normalized URLs.
 * Preserves the original order of the first occurrence.
 *
 * @param {Array<{title: string, url: string, content?: string}>} results
 * @returns {Array<{title: string, url: string, content?: string}>}
 */
export function deduplicateUrls(results) {
  if (!Array.isArray(results)) return [];

  const seenUrls = new Set();
  const unique = [];

  for (const item of results) {
    if (!item || !item.url) continue;

    const normalized = normalizeUrl(item.url);
    if (!normalized || seenUrls.has(normalized)) continue;

    seenUrls.add(normalized);
    unique.push({
      ...item,
      url: normalized,
    });
  }

  return unique;
}

/**
 * Extracts a Set of cleaned word tokens for similarity comparisons.
 *
 * @param {string} text
 * @returns {Set<string>}
 */
function getTokens(text) {
  if (!text || typeof text !== "string") return new Set();

  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3)
  );
}

/**
 * Computes Jaccard similarity between two token sets.
 *
 * @param {Set<string>} setA
 * @param {Set<string>} setB
 * @returns {number} Value in [0, 1]
 */
function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Computes containment ratio (how much of the smaller set is in the larger set).
 *
 * @param {Set<string>} setA
 * @param {Set<string>} setB
 * @returns {number} Value in [0, 1]
 */
function containment(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }

  return intersection / Math.min(setA.size, setB.size);
}

/**
 * Deduplicates text chunks by removing:
 * 1. Exact string duplicates (normalized whitespace & case).
 * 2. Near-duplicate chunks sharing high token overlap (Jaccard >= threshold or Containment >= 0.85).
 *
 * @param {Array<{id: number, title: string, url: string, text: string}>} chunks
 * @param {number} [jaccardThreshold=0.7]
 * @returns {Array<{id: number, title: string, url: string, text: string}>}
 */
export function deduplicateChunks(chunks, jaccardThreshold = 0.7) {
  if (!Array.isArray(chunks)) return [];

  const seenExact = new Set();
  const tokenizedList = [];
  const uniqueChunks = [];

  for (const chunk of chunks) {
    if (!chunk || !chunk.text) continue;

    // 1. Normalized exact check
    const normalizedText = chunk.text.trim().toLowerCase().replace(/\s+/g, " ");
    if (normalizedText.length < 30) continue; // Skip trivial/empty fragments
    if (seenExact.has(normalizedText)) continue;
    seenExact.add(normalizedText);

    // 2. Near-duplicate check against already accepted chunks
    const tokens = getTokens(chunk.text);
    if (tokens.size < 5) continue; // Skip chunks with too few meaningful words

    let isNearDuplicate = false;
    for (const { tokens: existingTokens } of tokenizedList) {
      const jaccard = jaccardSimilarity(tokens, existingTokens);
      const contain = containment(tokens, existingTokens);

      if (jaccard >= jaccardThreshold || contain >= 0.85) {
        isNearDuplicate = true;
        break;
      }
    }

    if (!isNearDuplicate) {
      tokenizedList.push({ chunk, tokens });
      uniqueChunks.push(chunk);
    }
  }

  return uniqueChunks;
}

/**
 * Limits the number of chunks selected from any single URL to maintain source diversity.
 *
 * @param {Array<{id: number, title: string, url: string, text: string, hybridScore?: number}>} rankedCandidates
 * @param {number} [maxPerSource=2]
 * @param {number} [targetCount=5]
 * @returns {Array<{id: number, title: string, url: string, text: string}>}
 */
export function diversifySources(rankedCandidates, maxPerSource = 2, targetCount = 5) {
  if (!Array.isArray(rankedCandidates)) return [];

  const urlCounts = new Map();
  const selected = [];
  const deferred = [];

  for (const candidate of rankedCandidates) {
    const count = urlCounts.get(candidate.url) || 0;
    if (count < maxPerSource) {
      selected.push(candidate);
      urlCounts.set(candidate.url, count + 1);
      if (selected.length === targetCount) break;
    } else {
      deferred.push(candidate);
    }
  }

  // If not enough unique sources to reach targetCount, fill with deferred high-scoring candidates
  while (selected.length < targetCount && deferred.length > 0) {
    selected.push(deferred.shift());
  }

  return selected;
}
