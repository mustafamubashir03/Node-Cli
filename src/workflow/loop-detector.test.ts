import { test } from "node:test";
import assert from "node:assert/strict";
import { createLoopState, checkLoop, detectCycle, detectNoProgress } from "./loop-detector.js";

test("loop: first failure returns continue", () => {
  const state = createLoopState();
  const result = checkLoop(state, "mkdir outside", true);
  assert.equal(result.action, "continue");
});

test("loop: second failure returns warn", () => {
  const state = createLoopState();
  checkLoop(state, "mkdir outside", true);
  const result = checkLoop(state, "mkdir outside", true);
  assert.equal(result.action, "warn");
});

test("loop: third failure returns stop", () => {
  const state = createLoopState();
  checkLoop(state, "mkdir outside", true);
  checkLoop(state, "mkdir outside", true);
  const result = checkLoop(state, "mkdir outside", true);
  assert.equal(result.action, "stop");
});

test("loop: success resets nothing but returns continue", () => {
  const state = createLoopState();
  checkLoop(state, "mkdir outside", true);
  const result = checkLoop(state, "mkdir outside", false);
  assert.equal(result.action, "continue");
});

test("loop: detectCycle finds A-B-C-A", () => {
  assert.equal(detectCycle(["A", "B", "C", "A"]), true);
});

test("loop: detectCycle finds A-B-A", () => {
  assert.equal(detectCycle(["A", "B", "A"]), true);
});

test("loop: detectCycle returns false for no cycle", () => {
  assert.equal(detectCycle(["A", "B", "C"]), false);
});

test("loop: detectNoProgress finds repeated action", () => {
  assert.equal(detectNoProgress(["x", "x", "x", "x", "x"]), true);
});

test("loop: detectNoProgress returns false for varied actions", () => {
  assert.equal(detectNoProgress(["a", "b", "c", "d", "e"]), false);
});