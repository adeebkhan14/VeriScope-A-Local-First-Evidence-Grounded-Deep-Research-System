import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function isPrivateIpv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(address) {
  const normalized = address.toLowerCase().split("%")[0];
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff")
  );
}

export function isPrivateIpAddress(address) {
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return false;
}

export async function assertSafeHttpUrl(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    const error = new Error("A valid HTTP or HTTPS URL is required.");
    error.code = "INVALID_URL";
    throw error;
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    const error = new Error("The URL is malformed.");
    error.code = "INVALID_URL";
    throw error;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    const error = new Error("Only HTTP and HTTPS URLs are allowed.");
    error.code = "INVALID_URL";
    throw error;
  }
  if (url.username || url.password) {
    const error = new Error("URLs containing credentials are not allowed.");
    error.code = "INVALID_URL";
    throw error;
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) {
    if (isPrivateIpAddress(hostname)) {
      const error = new Error("Private and local network addresses are not allowed.");
      error.code = "SSRF_BLOCKED";
      throw error;
    }
    return url;
  }

  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length) {
    const error = new Error("The URL hostname could not be resolved.");
    error.code = "INVALID_URL";
    throw error;
  }
  if (addresses.some(({ address }) => isPrivateIpAddress(address))) {
    const error = new Error("Private and local network addresses are not allowed.");
    error.code = "SSRF_BLOCKED";
    throw error;
  }
  return url;
}
