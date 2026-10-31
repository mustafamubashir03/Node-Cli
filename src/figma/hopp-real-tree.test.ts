import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  walkFigmaTree,
  countNodesByType,
  getMaxDepth,
  discoverAssets,
  segmentSections,
  createPlaceholderAsset,
  printTreeSummary,
  isFlattenedImage,
} from "./ingestion.js";

const HOPP_FIXTURE = path.resolve("./tests/fixtures/figma/hopp-real-tree.json");

function loadRoot(): any {
  const data = JSON.parse(fs.readFileSync(HOPP_FIXTURE, "utf8"));
  return data["0"].node;
}

test("hopp fixture: walkFigmaTree produces 679 nodes", () => {
  const root = loadRoot();
  const tree = walkFigmaTree(root);
  assert.equal(tree.length, 679);
});

test("hopp fixture: type counts match", () => {
  const root = loadRoot();
  const tree = walkFigmaTree(root);
  const counts = countNodesByType(tree);
  assert.equal(counts.FRAME, 418);
  assert.equal(counts.TEXT, 168);
  assert.equal(counts.VECTOR, 80);
  assert.equal(counts.RECTANGLE, 13);
});

test("hopp fixture: max depth is 8", () => {
  const root = loadRoot();
  const tree = walkFigmaTree(root);
  assert.equal(getMaxDepth(tree), 8);
});

test("hopp fixture: 11 top-level children", () => {
  const root = loadRoot();
  assert.equal(root.children.length, 11);
});

test("hopp fixture: regression - walk, discover, segment, placeholder, summary in order", () => {
  const root = loadRoot();
  const tree = walkFigmaTree(root);
  assert.ok(tree.length > 0, "walkFigmaTree should produce nodes");

  const discovered = discoverAssets(tree, root.absoluteBoundingBox);
  assert.ok(discovered, "discoverAssets should return result");
  assert.ok(Array.isArray(discovered.assets), "assets should be an array");

  const sections = segmentSections(root, "./test-output");
  assert.ok(Array.isArray(sections), "segmentSections should return array");

  const svg = createPlaceholderAsset("test-node", "Test", { x: 0, y: 0, w: 100, h: 100 });
  assert.ok(svg.includes("<svg"), "placeholder should be SVG");

  printTreeSummary({
    nodeCount: tree.length,
    typeCounts: countNodesByType(tree),
    maxDepth: getMaxDepth(tree),
    topLevelChildren: root.children.map((n: any) => ({
      name: n.name,
      type: n.type,
      bbox: n.absoluteBoundingBox
        ? { x: n.absoluteBoundingBox.x, y: n.absoluteBoundingBox.y, w: n.absoluteBoundingBox.width, h: n.absoluteBoundingBox.height }
        : undefined,
    })),
    isFlattened: isFlattenedImage(root),
  });
});
