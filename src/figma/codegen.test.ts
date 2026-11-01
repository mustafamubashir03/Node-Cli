import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { generateSectionHtml, generateSectionCss, assembleIndexHtml, generateTokensCss } from "./codegen.js";

const HOPP_FIXTURE = path.resolve("./tests/fixtures/figma/hopp-real-tree.json");

function loadRoot(): any {
  const data = JSON.parse(fs.readFileSync(HOPP_FIXTURE, "utf8"));
  return data["0"].node;
}

test("codegen: generateSectionHtml includes data-figma-node", () => {
  const root = loadRoot();
  const html = generateSectionHtml(1, "Hero", [root.children[0]]);
  assert.ok(html.includes("data-figma-node"));
  assert.ok(html.includes('data-section="01"'));
});

test("codegen: generateSectionCss includes width and height", () => {
  const root = loadRoot();
  const css = generateSectionCss(1, [root.children[0]]);
  assert.ok(css.includes("width:"));
  assert.ok(css.includes("height:"));
});

test("codegen: assembleIndexHtml produces valid HTML", () => {
  const html = assembleIndexHtml([{ index: 1, html: "<section>test</section>" }]);
  assert.ok(html.includes("<!DOCTYPE html>"));
  assert.ok(html.includes("</html>"));
});

test("codegen: generateTokensCss produces :root", () => {
  const css = generateTokensCss({ spacing: { sm: 8 }, colors: { primary: "#ff0000" } });
  assert.ok(css.includes(":root"));
  assert.ok(css.includes("--spacing-sm: 8px"));
  assert.ok(css.includes("--color-primary: #ff0000"));
});

test("codegen: no http(s) in generated HTML", () => {
  const root = loadRoot();
  const html = generateSectionHtml(1, "Hero", [root.children[0]]);
  assert.ok(!html.includes("http://"));
  assert.ok(!html.includes("https://"));
});

test("codegen: no Tailwind or CDN references", () => {
  const root = loadRoot();
  const html = generateSectionHtml(1, "Hero", [root.children[0]]);
  assert.ok(!html.includes("tailwind"));
  assert.ok(!html.includes("cdn"));
});