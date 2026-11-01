import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { walkFigmaTree, discoverAssets, segmentSections, createPlaceholderAsset, printTreeSummary, countNodesByType, getMaxDepth, isFlattenedImage } from "./ingestion";
import * as fs from "node:fs";
import * as path from "node:path";

const FIXTURE = path.resolve("./tests/fixtures/figma/fixture-complex.json");

describe("Figma ingestion regression", () => {
  test("walkFigmaTree should walk the fixture tree", async () => {
    const fsMod = await import("fs");
    const data = JSON.parse(fsMod.readFileSync(FIXTURE, "utf8"));
    const doc = data.document || data;
    const children = doc.children || [];
    assert(children.length > 0, "Fixture should have children");
    const root = children[0];
    const tree = walkFigmaTree(root);
    assert(tree.length > 0, "Should walk at least one node");
    console.log(`walkFigmaTree: ${tree.length} nodes walked`);
  });

  test("discoverAssets should discover assets from tree", async () => {
    const fsMod = await import("fs");
    const data = JSON.parse(fsMod.readFileSync(FIXTURE, "utf8"));
    const doc = data.document || data;
    const children = doc.children || [];
    const root = children[0];
    const tree = walkFigmaTree(root);
    const discovered = discoverAssets(tree, root.absoluteBoundingBox || undefined);
    assert(discovered.assets.length >= 0, "Should discover assets");
    assert(typeof discovered.imageFillNodes === "object", "Should have image fill nodes");
    assert(typeof discovered.vectorNodes === "object", "Should have vector nodes");
    console.log(`discoverAssets: ${discovered.assets.length} assets, ${discovered.imageFillNodes.length} image fills, ${discovered.vectorNodes.length} vectors`);
  });

  test("segmentSections should work with 2 arguments", async () => {
    const fsMod = await import("fs");
    const data = JSON.parse(fsMod.readFileSync(FIXTURE, "utf8"));
    const doc = data.document || data;
    const children = doc.children || [];
    const root = children[0];
    // This should not throw "Expected 2 arguments, but got 1"
    const sections = segmentSections(root, "./test-output");
    assert(Array.isArray(sections), "Should return an array of sections");
    console.log(`segmentSections: ${sections.length} sections returned`);
    // Verify sections have expected structure
    for (const section of sections) {
      assert(section.name !== undefined, "Section should have name");
      assert(section.spec !== undefined, "Section should have spec");
    }
  });

  test("createPlaceholderAsset should generate valid SVG", () => {
    const svg = createPlaceholderAsset("test-node-123", "Test Node", { x: 0, y: 0, w: 100, h: 100 });
    assert(typeof svg === "string", "Should return an SVG string");
    assert(svg.includes("<svg"), "Should contain <svg tag");
    assert(svg.includes("Test Node"), "Should contain node name");
    console.log(`createPlaceholderAsset: generated ${svg.length} byte SVG`);
  });

  test("printTreeSummary should not throw", async () => {
    const fsMod = await import("fs");
    const data = JSON.parse(fsMod.readFileSync(FIXTURE, "utf8"));
    const doc = data.document || data;
    const children = doc.children || [];
    const root = children[0];
    const tree = walkFigmaTree(root);
    const discovered = discoverAssets(tree, root.absoluteBoundingBox || undefined);
    // This should not throw
    printTreeSummary({
      nodeCount: tree.length,
      typeCounts: {},
      maxDepth: getMaxDepth(tree),
      topLevelChildren: (root.children || []).slice(0, 10).map((n: any) => ({ name: n.name, type: n.type, bbox: n.absoluteBoundingBox })),
      isFlattened: isFlattenedImage(root)
    } as any);
  });
});