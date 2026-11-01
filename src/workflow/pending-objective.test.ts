import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storePendingObjective, getPendingObjective, clearPendingObjective, resolvesPendingObjective } from "./pending-objective.js";

test("pending-objective: store and retrieve", () => {
  const dir = mkdtempSync(join(tmpdir(), "po-"));
  const origCwd = process.cwd();
  process.chdir(dir);
  try {
    storePendingObjective("Build the page", "/path/to/package");
    const po = getPendingObjective();
    assert.ok(po);
    assert.equal(po.objective, "Build the page");
    assert.equal(po.packagePath, "/path/to/package");
  } finally {
    process.chdir(origCwd);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pending-objective: clear removes it", () => {
  const dir = mkdtempSync(join(tmpdir(), "po-"));
  const origCwd = process.cwd();
  process.chdir(dir);
  try {
    storePendingObjective("Build the page", "/path/to/package");
    clearPendingObjective();
    assert.equal(getPendingObjective(), null);
  } finally {
    process.chdir(origCwd);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pending-objective: resolvesPendingObjective matches patterns", () => {
  assert.equal(resolvesPendingObjective("yes"), true);
  assert.equal(resolvesPendingObjective("go"), true);
  assert.equal(resolvesPendingObjective("do it"), true);
  assert.equal(resolvesPendingObjective("all"), true);
  assert.equal(resolvesPendingObjective("do everything"), true);
  assert.equal(resolvesPendingObjective("do 1"), true);
  assert.equal(resolvesPendingObjective("these steps"), true);
});

test("pending-objective: resolvesPendingObjective rejects unknown", () => {
  assert.equal(resolvesPendingObjective("which steps?"), false);
  assert.equal(resolvesPendingObjective("hello"), false);
});