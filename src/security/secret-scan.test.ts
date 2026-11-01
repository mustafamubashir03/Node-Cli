import { test } from "node:test";
import assert from "node:assert/strict";
import { redactSecrets } from "./redact.js";

test("secret scan: redacts sk-or- keys", () => {
  const input = "key sk-or-v1-abcdefghijklmnop";
  const result = redactSecrets(input);
  assert.ok(!result.includes("sk-or-v1-abcdefghijklmnop"));
});

test("secret scan: redacts bearer tokens", () => {
  const input = "Authorization: Bearer abcdefghijklmnopqrstuvwxyz";
  const result = redactSecrets(input);
  assert.ok(!result.includes("abcdefghijklmnopqrstuvwxyz"));
});