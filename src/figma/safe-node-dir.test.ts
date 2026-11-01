import { test } from "node:test";
import assert from "node:assert/strict";
import { safeNodeDir } from "./ingestion.js";

test("safeNodeDir converts colon to dash", () => {
  assert.equal(safeNodeDir("1:2"), "1-2");
});

test("safeNodeDir handles multiple colons", () => {
  assert.equal(safeNodeDir("1:2:3"), "1-2-3");
});

test("safeNodeDir leaves already-safe names unchanged", () => {
  assert.equal(safeNodeDir("1-2"), "1-2");
});
