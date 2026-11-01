import { test } from "node:test";
import assert from "node:assert/strict";
import { runVerifyChecks, formatVerifyResult } from "./verify.js";

test("verify: all pass returns allPassed true", () => {
  const result = runVerifyChecks([
    { name: "check1", fn: () => ({ passed: true }) },
    { name: "check2", fn: () => ({ passed: true, detail: "ok" }) },
  ]);
  assert.equal(result.allPassed, true);
  assert.equal(result.checks.length, 2);
});

test("verify: one fail returns allPassed false", () => {
  const result = runVerifyChecks([
    { name: "check1", fn: () => ({ passed: true }) },
    { name: "check2", fn: () => ({ passed: false, detail: "missing file" }) },
  ]);
  assert.equal(result.allPassed, false);
  assert.equal(result.checks[1].passed, false);
});

test("verify: exception in check returns fail", () => {
  const result = runVerifyChecks([
    { name: "check1", fn: () => { throw new Error("boom"); } },
  ]);
  assert.equal(result.allPassed, false);
  assert.equal(result.checks[0].passed, false);
  assert.ok(result.checks[0].detail?.includes("boom"));
});

test("verify: formatVerifyResult includes check names", () => {
  const result = runVerifyChecks([
    { name: "html-parses", fn: () => ({ passed: true }) },
  ]);
  const formatted = formatVerifyResult(result);
  assert.ok(formatted.includes("html-parses"));
  assert.ok(formatted.includes("PASS"));
});