import { MockFigmaClient } from "./mock-client.js";
import { walkFigmaTree, discoverAssets, segmentSections, countNodesByType, getMaxDepth, isFlattenedImage, printTreeSummary } from "./ingestion.js";
import { generateSectionHtml, generateSectionCss, assembleIndexHtml } from "./codegen.js";
import { lintOutput } from "./output-lint.js";
import * as fs from "node:fs";
import * as path from "node:path";

const client = new MockFigmaClient();
const context = await client.getDesignContext("https://www.figma.com/design/88lqd4GEAsugHVhooKZCD9/Untitled?node-id=1-2");
const rootNode = context.nodes[0];
const tree = walkFigmaTree(rootNode);

console.log("=== TREE SUMMARY ===");
console.log("Nodes:", tree.length);
console.log("Types:", JSON.stringify(countNodesByType(tree)));
console.log("Max depth:", getMaxDepth(tree));
console.log("Top-level children:", rootNode.children.length);

const discovered = discoverAssets(tree, rootNode.absoluteBoundingBox);
console.log("\n=== DISCOVERY ===");
console.log("Assets:", discovered.assets.length);
console.log("Image fills:", discovered.imageFillNodes.length);
console.log("Vectors:", discovered.vectorNodes.length);

const tmpDir = "C:/tmp/figma-e2e";
const assetDir = tmpDir + "/.node-cli/figma/88lqd4GEAsugHVhooKZCD9/1-2";
fs.mkdirSync(assetDir, { recursive: true });
fs.mkdirSync(assetDir + "/assets", { recursive: true });
fs.mkdirSync(assetDir + "/sections", { recursive: true });
fs.mkdirSync(assetDir + "/raw", { recursive: true });

// Write tree.json
fs.writeFileSync(assetDir + "/tree.json", JSON.stringify(tree, null, 2));
// Write tokens.json
fs.writeFileSync(assetDir + "/tokens.json", JSON.stringify({}, null, 2));
// Write assets.json
fs.writeFileSync(assetDir + "/assets.json", JSON.stringify(discovered, null, 2));

// Segment sections
const sections = segmentSections(rootNode, assetDir);
console.log("\n=== SECTIONS ===");
console.log("Count:", sections.length);
for (const s of sections) {
  console.log("  " + path.basename(s.dir) + " (nodes: " + s.nodeCount + ")");
}

// Generate codegen
const sectionHtmls = [];
for (const section of sections) {
  const childNode = rootNode.children.find((c: any) => c.name === section.name);
  if (childNode) {
    const html = generateSectionHtml(section.index + 1, section.name, [childNode]);
    const css = generateSectionCss(section.index + 1, [childNode]);
    const sectionDir = section.dir;
    fs.writeFileSync(sectionDir + "/section.html", html);
    fs.writeFileSync(sectionDir + "/section.css", css);
    sectionHtmls.push({ index: section.index + 1, html });
  }
}

const indexHtml = assembleIndexHtml(sectionHtmls);
fs.writeFileSync(assetDir + "/index.html", indexHtml);

// Output lint
const assetPaths = discovered.assets.map((a: any) => "assets/" + a.nodeId.replace(/:/g, "-") + ".png");
const lintResult = lintOutput(indexHtml, assetPaths);
console.log("\n=== OUTPUT LINT ===");
console.log("Valid:", lintResult.valid);
if (lintResult.errors.length > 0) {
  console.log("Errors:", lintResult.errors.slice(0, 5));
}

// Counts by source and status
const bySource: Record<string, number> = {};
const byStatus: Record<string, number> = {};
for (const a of discovered.assets) {
  bySource[a.type] = (bySource[a.type] || 0) + 1;
  byStatus[a.status] = (byStatus[a.status] || 0) + 1;
}
console.log("\n=== COUNTS BY TYPE ===");
console.log(JSON.stringify(bySource));
console.log("\n=== COUNTS BY STATUS ===");
console.log(JSON.stringify(byStatus));

console.log("\n=== INDEX.HTML SIZE ===");
console.log("Bytes:", indexHtml.length);
console.log("\n=== DONE ===");