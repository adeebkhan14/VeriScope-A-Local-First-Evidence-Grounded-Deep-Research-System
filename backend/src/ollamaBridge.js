import http from "node:http";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function isBridgeInterface(name) {
  return name === "docker0" || name.startsWith("br-");
}

function ipv4ToNumber(address) {
  return address
    .split(".")
    .reduce((value, octet) => (value << 8) | Number(octet), 0) >>> 0;
}

function routeHexToNumber(value) {
  const bytes = Buffer.from(value, "hex");
  return (
    ((bytes[3] << 24) | (bytes[2] << 16) | (bytes[1] << 8) | bytes[0]) >>> 0
  );
}

function isAddressOnDockerBridgeRoute(address, routeTable, fibTrie) {
  const target = ipv4ToNumber(address);
  const isLocalAddress = [...fibTrie.matchAll(/\|\-\-\s+(\d+\.\d+\.\d+\.\d+)\s*\n\s*\/32 host LOCAL/g)]
    .some(([, localAddress]) => localAddress === address);
  if (!isLocalAddress) return false;

  return routeTable
    .split("\n")
    .slice(1)
    .some((line) => {
      const [name, destination, , , , , , mask] = line.trim().split(/\s+/);
      if (!name || !destination || !mask || !isBridgeInterface(name)) {
        return false;
      }
      const network = routeHexToNumber(destination);
      const netmask = routeHexToNumber(mask);
      return (target & netmask) === (network & netmask);
    });
}

export function isDockerBridgeAddress(
  address,
  interfaces = networkInterfaces(),
  { routeTable, fibTrie } = {}
) {
  const foundByInterface = Object.entries(interfaces).some(([name, entries]) => {
    if (!isBridgeInterface(name)) return false;
    return entries?.some(
      (entry) => entry.family === "IPv4" && entry.address === address
    );
  });
  if (foundByInterface) return true;

  return isAddressOnDockerBridgeRoute(
    address,
    routeTable ?? readFileSync("/proc/net/route", "utf8"),
    fibTrie ?? readFileSync("/proc/net/fib_trie", "utf8")
  );
}

export async function resolveDockerBridgeAddress(
  host = "host.docker.internal",
  { lookupHost = lookup, interfaces = networkInterfaces() } = {}
) {
  const { address, family } = await lookupHost(host, { family: 4 });
  if (
    family !== 4 ||
    isIP(address) !== 4 ||
    !isDockerBridgeAddress(address, interfaces)
  ) {
    throw new Error(
      `Refusing to bind Ollama bridge to ${address}; it is not an IPv4 address assigned to a Docker bridge interface.`
    );
  }
  return address;
}

export function createOllamaBridgeServer({
  upstreamHost = "127.0.0.1",
  upstreamPort = 11434,
} = {}) {
  return http.createServer((incoming, outgoing) => {
    if (incoming.url === "/health") {
      outgoing.writeHead(200, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ status: "online" }));
      return;
    }

    if (!incoming.url?.startsWith("/api/")) {
      outgoing.writeHead(404, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ error: "Only Ollama API routes are forwarded." }));
      return;
    }

    const upstream = http.request(
      {
        host: upstreamHost,
        port: upstreamPort,
        method: incoming.method,
        path: incoming.url,
        headers: {
          ...incoming.headers,
          host: `${upstreamHost}:${upstreamPort}`,
        },
      },
      (upstreamResponse) => {
        outgoing.writeHead(
          upstreamResponse.statusCode || 502,
          upstreamResponse.headers
        );
        upstreamResponse.pipe(outgoing);
      }
    );

    upstream.on("error", (error) => {
      console.error(`[OllamaBridge] Local Ollama request failed: ${error.message}`);
      if (!outgoing.headersSent) {
        outgoing.writeHead(502, { "content-type": "application/json" });
        outgoing.end(
          JSON.stringify({
            error: "Ollama loopback listener is unavailable.",
            code: "OLLAMA_UPSTREAM_UNAVAILABLE",
          })
        );
      } else {
        outgoing.destroy(error);
      }
    });

    incoming.on("aborted", () => upstream.destroy());
    outgoing.on("close", () => {
      if (!outgoing.writableEnded) upstream.destroy();
    });
    incoming.pipe(upstream);
  });
}

async function startBridge() {
  const bindHost =
    process.env.OLLAMA_BRIDGE_BIND_HOST || "host.docker.internal";
  const bindAddress = await resolveDockerBridgeAddress(bindHost);
  const port = Number(process.env.OLLAMA_BRIDGE_PORT || 11434);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid OLLAMA_BRIDGE_PORT: ${process.env.OLLAMA_BRIDGE_PORT}`);
  }

  const server = createOllamaBridgeServer({
    upstreamHost: process.env.OLLAMA_BRIDGE_UPSTREAM_HOST || "127.0.0.1",
    upstreamPort: Number(process.env.OLLAMA_BRIDGE_UPSTREAM_PORT || 11434),
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, bindAddress, resolveListen);
  });
  console.log(`[OllamaBridge] Listening on Docker bridge ${bindAddress}:${port}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startBridge().catch((error) => {
    console.error("[OllamaBridge] Could not start:", error.message);
    process.exitCode = 1;
  });
}
