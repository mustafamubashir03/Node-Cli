import { test } from "node:test";
import assert from "node:assert/strict";
import { skillStatusLine } from "./skills.js";

test("skillStatusLine: lists exact skill names", () => {
  const line = skillStatusLine();
  assert.ok(typeof line === "string");
  // Should not contain concatenated or corrupted names
  assert.ok(!line.includes("wefixing"));
  assert.ok(!line.includes("wefixing-metadata"));
});