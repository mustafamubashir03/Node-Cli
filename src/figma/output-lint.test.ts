import { test } from "node:test";
import assert from "node:assert/strict";
import { lintOutput } from "./output-lint.js";

const ASSET_PATHS = ["assets/hero.png", "assets/icon.svg"];

test("lintOutput: passes for valid HTML with manifest paths", () => {
  const html = '<img src="assets/hero.png" alt="hero">';
  const result = lintOutput(html, ASSET_PATHS);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("lintOutput: fails on reference/full.png", () => {
  const html = '<img src="reference/full.png" alt="ref">';
  const result = lintOutput(html, ASSET_PATHS);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes("reference/full.png")));
});

test("lintOutput: fails on 1-2.png", () => {
  const html = '<img src="1-2.png" alt="root">';
  const result = lintOutput(html, ASSET_PATHS);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes("1-2.png")));
});

test("lintOutput: fails on path not in assets.json", () => {
  const html = '<img src="assets/unknown.png" alt="x">';
  const result = lintOutput(html, ASSET_PATHS);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes("not in manifest")));
});

test("lintOutput: fails on http(s) URL", () => {
  const html = '<img src="https://example.com/img.png" alt="x">';
  const result = lintOutput(html, ASSET_PATHS);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes("http(s) URL")));
});