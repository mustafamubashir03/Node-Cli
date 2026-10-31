import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDesignAnchor } from "./design-anchor.js";

test("design-anchor: includes package path", () => {
  const anchor = buildDesignAnchor({
    packagePath: ".node-cli/figma/abc/1-2",
    manifestHash: "abc123",
    sections: [{ index: 1, name: "Hero", status: "pending" }],
    assetCounts: { total: 10, pending: 5, downloaded: 5, failed: 0 },
  });
  assert.ok(anchor.includes(".node-cli/figma/abc/1-2"));
});

test("design-anchor: includes manifest hash", () => {
  const anchor = buildDesignAnchor({
    packagePath: ".node-cli/figma/abc/1-2",
    manifestHash: "abc123",
    sections: [],
    assetCounts: { total: 0, pending: 0, downloaded: 0, failed: 0 },
  });
  assert.ok(anchor.includes("abc123"));
});

test("design-anchor: includes section list", () => {
  const anchor = buildDesignAnchor({
    packagePath: ".node-cli/figma/abc/1-2",
    manifestHash: "abc123",
    sections: [
      { index: 1, name: "Hero", status: "verified", lastDiffPercent: 1.5 },
      { index: 2, name: "Features", status: "pending" },
    ],
    assetCounts: { total: 0, pending: 0, downloaded: 0, failed: 0 },
  });
  assert.ok(anchor.includes("Hero"));
  assert.ok(anchor.includes("verified"));
  assert.ok(anchor.includes("1.5%"));
});

test("design-anchor: includes source of truth message", () => {
  const anchor = buildDesignAnchor({
    packagePath: ".node-cli/figma/abc/1-2",
    manifestHash: "abc123",
    sections: [],
    assetCounts: { total: 0, pending: 0, downloaded: 0, failed: 0 },
  });
  assert.ok(anchor.includes("only source of truth"));
  assert.ok(anchor.includes("Do not guess values"));
});

test("design-anchor: includes current section spec", () => {
  const anchor = buildDesignAnchor({
    packagePath: ".node-cli/figma/abc/1-2",
    manifestHash: "abc123",
    sections: [],
    assetCounts: { total: 0, pending: 0, downloaded: 0, failed: 0 },
    currentSectionSpec: "# Hero Section\nWidth: 1440px",
  });
  assert.ok(anchor.includes("Hero Section"));
  assert.ok(anchor.includes("Width: 1440px"));
});