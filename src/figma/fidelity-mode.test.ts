import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isFidelityMode } from "./fidelity-mode.js";

test("isFidelityMode: false when no .node-cli/figma", () => {
  const dir = mkdtempSync(join(tmpdir(), "fid-"));
  assert.equal(isFidelityMode(dir), false);
  rmSync(dir, { recursive: true, force: true });
});

test("isFidelityMode: true when .node-cli/figma has a package", () => {
  const dir = mkdtempSync(join(tmpdir(), "fid-"));
  mkdirSync(join(dir, ".node-cli", "figma", "abc"), { recursive: true });
  assert.equal(isFidelityMode(dir), true);
  rmSync(dir, { recursive: true, force: true });
});

test("isFidelityMode: false when .node-cli/figma is empty", () => {
  const dir = mkdtempSync(join(tmpdir(), "fid-"));
  mkdirSync(join(dir, ".node-cli", "figma"), { recursive: true });
  assert.equal(isFidelityMode(dir), false);
  rmSync(dir, { recursive: true, force: true });
});