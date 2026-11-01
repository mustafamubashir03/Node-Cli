import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeBBox } from "./ingestion.js";

test("normalizeBBox: converts width/height to w/h", () => {
  const result = normalizeBBox({ x: 10, y: 20, width: 100, height: 200 });
  assert.deepEqual(result, { x: 10, y: 20, w: 100, h: 200 });
});

test("normalizeBBox: handles w/h format", () => {
  const result = normalizeBBox({ x: 10, y: 20, w: 100, h: 200 });
  assert.deepEqual(result, { x: 10, y: 20, w: 100, h: 200 });
});

test("normalizeBBox: returns null for missing bbox", () => {
  assert.equal(normalizeBBox(undefined), null);
});

test("normalizeBBox: returns null for zero dimensions", () => {
  assert.equal(normalizeBBox({ x: 0, y: 0, width: 0, height: 100 }), null);
});
