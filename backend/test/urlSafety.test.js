import test from "node:test";
import assert from "node:assert/strict";
import {
  assertSafeHttpUrl,
  isPrivateIpAddress,
} from "../src/scraper/urlSafety.js";

test("rejects private IPv4 ranges", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "0.0.0.0",
  ]) {
    assert.equal(isPrivateIpAddress(address), true, address);
  }
});

test("rejects private and loopback IPv6 ranges", () => {
  assert.equal(isPrivateIpAddress("::1"), true);
  assert.equal(isPrivateIpAddress("fc00::1"), true);
  assert.equal(isPrivateIpAddress("fd12::1"), true);
});

test("allows public IP literals", () => {
  assert.equal(isPrivateIpAddress("8.8.8.8"), false);
  assert.equal(isPrivateIpAddress("2606:4700:4700::1111"), false);
});

test("rejects unsupported URL schemes", async () => {
  await assert.rejects(
    () => assertSafeHttpUrl("file:///etc/passwd"),
    (error) => error.code === "INVALID_URL"
  );
});

test("rejects malformed URLs", async () => {
  await assert.rejects(
    () => assertSafeHttpUrl("not a url"),
    (error) => error.code === "INVALID_URL"
  );
});

test("rejects credentials in URLs", async () => {
  await assert.rejects(
    () => assertSafeHttpUrl("http://user:password@example.com"),
    (error) => error.code === "INVALID_URL"
  );
});

test("rejects private network URL literals", async () => {
  await assert.rejects(
    () => assertSafeHttpUrl("http://127.0.0.1:8080"),
    (error) => error.code === "SSRF_BLOCKED"
  );
  await assert.rejects(
    () => assertSafeHttpUrl("http://[::1]/"),
    (error) => error.code === "SSRF_BLOCKED"
  );
});
