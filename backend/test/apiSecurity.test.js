import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/server.js";

async function withServer(t, app) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

test("adds privacy and security headers", async (t) => {
  const app = createApp({
    researchFn: async () => ({ answer: "ok" }),
    healthCheckFn: async () => ({}),
  });
  const baseUrl = await withServer(t, app);
  const response = await fetch(`${baseUrl}/`);

  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.ok(response.headers.get("x-request-id"));
  assert.equal(response.headers.get("x-powered-by"), null);
});

test("rejects missing research query", async (t) => {
  const app = createApp({
    researchFn: async () => ({ answer: "ok" }),
  });
  const baseUrl = await withServer(t, app);
  const response = await fetch(`${baseUrl}/api/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "" }),
  });

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error, "Invalid request");
});
