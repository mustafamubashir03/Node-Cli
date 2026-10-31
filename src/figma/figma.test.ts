import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFigmaUrl, validateFigmaUrl, nodeIdToApiFormat, nodeIdToUrlFormat } from "./url-parser.js";
import { FigmaClient } from "./client.js";
import { generateDesignSpec } from "./design-spec.js";
import { FigmaCache } from "./cache.js";
import { maskToken, getCredentialStatus } from "./credentials.js";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("parseFigmaUrl extracts file key and node id", () => {
  const result = parseFigmaUrl("https://www.figma.com/design/ABC123/MyDesign?node-id=1-2");
  assert.ok(result);
  assert.equal(result!.fileKey, "ABC123");
  assert.equal(result!.nodeId, "1:2");
});

test("parseFigmaUrl handles file without node id", () => {
  const result = parseFigmaUrl("https://www.figma.com/design/ABC123/MyDesign");
  assert.ok(result);
  assert.equal(result!.fileKey, "ABC123");
  assert.equal(result!.nodeId, undefined);
});

test("parseFigmaUrl handles file/ URL format", () => {
  const result = parseFigmaUrl("https://www.figma.com/file/XYZ789/Name?node-id=4-5");
  assert.ok(result);
  assert.equal(result!.fileKey, "XYZ789");
  assert.equal(result!.nodeId, "4:5");
});

test("parseFigmaUrl returns null for invalid URL", () => {
  assert.equal(parseFigmaUrl("https://example.com"), null);
  assert.equal(parseFigmaUrl(""), null);
  assert.equal(parseFigmaUrl("not a url"), null);
});

test("validateFigmaUrl returns error for invalid URL", () => {
  const result = validateFigmaUrl("https://example.com");
  assert.equal(result.valid, false);
  assert.ok(result.error);
});

test("validateFigmaUrl returns parsed for valid URL", () => {
  const result = validateFigmaUrl("https://www.figma.com/design/AbCdEfGhIjKlMnOpQrStUv/Name?node-id=1-2");
  assert.equal(result.valid, true);
  assert.ok(result.parsed);
});

test("nodeIdToApiFormat converts URL format to API format", () => {
  assert.equal(nodeIdToApiFormat("1-2"), "1:2");
  assert.equal(nodeIdToApiFormat("123-456"), "123:456");
});

test("nodeIdToUrlFormat converts API format to URL format", () => {
  assert.equal(nodeIdToUrlFormat("1:2"), "1-2");
  assert.equal(nodeIdToUrlFormat("123:456"), "123-456");
});

test("FigmaClient.isAvailable returns false without token", () => {
  const client = new FigmaClient({});
  assert.equal(client.isAvailable(), false);
});

test("FigmaClient.isAvailable returns true with token", () => {
  const client = new FigmaClient({ accessToken: "test-token" });
  assert.equal(client.isAvailable(), true);
});

test("FigmaClient.getDesignContext throws without token", async () => {
  const client = new FigmaClient({});
  await assert.rejects(
    () => client.getDesignContext("ABC123"),
    /access token not configured/i
  );
});

test("generateDesignSpec creates spec from context", () => {
  const context = {
    fileKey: "ABC123",
    name: "Test Frame",
    lastModified: "2026-01-01",
    nodes: [{
      id: "1:2",
      name: "Frame",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 375, height: 812 },
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
    }],
  };
  const spec = generateDesignSpec(context);
  assert.equal(spec.source.fileKey, "ABC123");
  assert.equal(spec.frame.name, "Test Frame");
  assert.equal(spec.frame.width, 375);
  assert.equal(spec.frame.height, 812);
  assert.ok(Object.keys(spec.tokens.colors).length > 0);
});

// --- Cache Tests ---

test("FigmaCache stores and retrieves data", () => {
  const cache = new FigmaCache(join(tmpdir(), "cache-test-" + Date.now()));
  const key = "test-key";
  cache.set(key, { value: 42 }, 60000);
  const result = cache.get<{ value: number }>(key);
  assert.ok(result);
  assert.equal(result!.value, 42);
});

test("FigmaCache returns null for missing key", () => {
  const cache = new FigmaCache(join(tmpdir(), "cache-test-" + Date.now()));
  const result = cache.get("nonexistent");
  assert.equal(result, null);
});

test("FigmaCache invalidates entries", () => {
  const cache = new FigmaCache(join(tmpdir(), "cache-test-" + Date.now()));
  const key = "test-key";
  cache.set(key, { value: 42 }, 60000);
  cache.invalidate(key);
  const result = cache.get(key);
  assert.equal(result, null);
});

test("FigmaCache cacheKeyFromEndpoint produces unique keys", () => {
  const key1 = FigmaCache.cacheKeyFromEndpoint("/files/ABC");
  const key2 = FigmaCache.cacheKeyFromEndpoint("/files/XYZ");
  assert.notEqual(key1, key2);
});

test("FigmaCache cacheKey produces unique keys per file", () => {
  const key1 = FigmaCache.cacheKey("file1", "node1");
  const key2 = FigmaCache.cacheKey("file2", "node1");
  assert.notEqual(key1, key2);
});

// --- Credential Tests ---

test("maskToken hides middle characters", () => {
  const masked = maskToken("abcdefghijklmnop");
  assert.equal(masked, "abcd...mnop");
});

test("maskToken handles short tokens", () => {
  const masked = maskToken("short");
  assert.equal(masked, "****");
});

test("getCredentialStatus returns valid status", () => {
  const status = getCredentialStatus();
  assert.ok(status.source === "environment" || status.source === "stored" || status.source === "none");
  assert.equal(typeof status.available, "boolean");
});