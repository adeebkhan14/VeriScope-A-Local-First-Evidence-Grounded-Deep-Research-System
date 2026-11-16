import assert from "node:assert/strict";
import http from "node:http";
import { after, describe, it } from "node:test";

import {
  createOllamaBridgeServer,
  isDockerBridgeAddress,
  resolveDockerBridgeAddress,
} from "../src/ollamaBridge.js";

const activeServers = [];

after(async () => {
  await Promise.all(
    activeServers.map(
      (server) =>
        new Promise((resolve) => {
          if (!server.listening) return resolve();
          server.close(() => resolve());
        })
    )
  );
});

describe("Linux Ollama bridge", () => {
  it("only accepts addresses assigned to Docker bridge interfaces", async () => {
    const interfaces = {
      docker0: [{ address: "172.17.0.1", family: "IPv4" }],
      "br-veriscope": [{ address: "172.18.0.1", family: "IPv4" }],
      eth0: [{ address: "192.168.1.10", family: "IPv4" }],
    };

    assert.equal(isDockerBridgeAddress("172.17.0.1", interfaces), true);
    assert.equal(isDockerBridgeAddress("172.18.0.1", interfaces), true);
    assert.equal(isDockerBridgeAddress("192.168.1.10", interfaces), false);
    assert.equal(
      isDockerBridgeAddress("172.17.0.1", {}, {
        routeTable:
          "Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT\n" +
          "docker0 000011AC 00000000 0001 0 0 0 0000FFFF 0 0 0\n",
        fibTrie: "|-- 172.17.0.1\n /32 host LOCAL\n",
      }),
      true
    );
    assert.equal(
      isDockerBridgeAddress("172.17.0.2", {}, {
        routeTable:
          "Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT\n" +
          "docker0 000011AC 00000000 0001 0 0 0 0000FFFF 0 0 0\n",
        fibTrie: "|-- 172.17.0.1\n /32 host LOCAL\n",
      }),
      false
    );
    assert.equal(
      await resolveDockerBridgeAddress("host.docker.internal", {
        lookupHost: async () => ({ address: "172.17.0.1", family: 4 }),
        interfaces,
      }),
      "172.17.0.1"
    );
    await assert.rejects(
      resolveDockerBridgeAddress("public-host", {
        lookupHost: async () => ({ address: "192.168.1.10", family: 4 }),
        interfaces,
      }),
      /not an IPv4 address assigned to a Docker bridge/
    );
  });

  it("forwards Ollama API traffic, exposes a local health route, and rejects other paths", async () => {
    let forwarded = 0;
    const upstream = http.createServer((request, response) => {
      forwarded += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ path: request.url }));
    });
    activeServers.push(upstream);
    await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));

    const bridge = createOllamaBridgeServer({
      upstreamPort: upstream.address().port,
    });
    activeServers.push(bridge);
    await new Promise((resolve) => bridge.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${bridge.address().port}`;

    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "online" });

    const tags = await fetch(`${baseUrl}/api/tags`);
    assert.equal(tags.status, 200);
    assert.deepEqual(await tags.json(), { path: "/api/tags" });

    const rejected = await fetch(`${baseUrl}/unrelated`);
    assert.equal(rejected.status, 404);
    assert.equal(forwarded, 1);
  });
});
