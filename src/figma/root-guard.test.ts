import { test } from "node:test";
import assert from "node:assert/strict";
import { isRootNode, hasValidBbox, isRootBbox } from "./ingestion.js";

test("isRootNode: returns true for root id", () => {
  assert.equal(isRootNode("1:2", "1:2"), true);
});

test("isRootNode: returns false for child id", () => {
  assert.equal(isRootNode("3:4", "1:2"), false);
});

test("hasValidBbox: returns true for valid bbox", () => {
  assert.equal(hasValidBbox({ x: 0, y: 0, width: 100, height: 200 }), true);
});

test("hasValidBbox: returns false for missing bbox", () => {
  assert.equal(hasValidBbox(undefined), false);
});

test("hasValidBbox: returns false for zero dimensions", () => {
  assert.equal(hasValidBbox({ x: 0, y: 0, width: 0, height: 100 }), false);
  assert.equal(hasValidBbox({ x: 0, y: 0, width: 100, height: 0 }), false);
});

test("isRootBbox: returns true when bbox matches root", () => {
  const root = { x: 0, y: 0, width: 1440, height: 5050 };
  assert.equal(isRootBbox(root, root), true);
});

test("isRootBbox: returns false when bbox differs", () => {
  const root = { x: 0, y: 0, width: 1440, height: 5050 };
  const child = { x: 100, y: 200, width: 500, height: 300 };
  assert.equal(isRootBbox(child, root), false);
});
