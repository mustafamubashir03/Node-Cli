/**
 * Deterministic code generator for Figma-to-code.
 * Generates section.html and section.css from the Figma package.
 * No CDN, no Tailwind. Every element has data-figma-node="<id>".
 * Section roots have data-section="NN".
 */
export interface CodegenOptions {
  packageDir: string;
  outputDir: string;
}

export interface CodegenResult {
  sections: string[];
  indexHtml: string;
  tokensCss: string;
  gaps: string[];
}

export function generateTokensCss(tokens: Record<string, any>): string {
  const lines: string[] = [":root {"];
  // Spacing
  if (tokens.spacing) {
    for (const [key, val] of Object.entries(tokens.spacing)) {
      lines.push(`  --spacing-${key}: ${val}px;`);
    }
  }
  // Colors
  if (tokens.colors) {
    for (const [key, val] of Object.entries(tokens.colors)) {
      lines.push(`  --color-${key}: ${val};`);
    }
  }
  // Typography
  if (tokens.fontSizes) {
    for (const [key, val] of Object.entries(tokens.fontSizes)) {
      lines.push(`  --font-size-${key}: ${val}px;`);
    }
  }
  // Radii
  if (tokens.radii) {
    for (const [key, val] of Object.entries(tokens.radii)) {
      lines.push(`  --radius-${key}: ${val}px;`);
    }
  }
  lines.push("}");
  return lines.join("\n");
}

export function generateSectionHtml(sectionIndex: number, sectionName: string, nodes: any[]): string {
  const lines: string[] = [];
  lines.push(`<section data-section="${String(sectionIndex).padStart(2, "0")}">`);
  for (const node of nodes) {
    const nodeId = node.id || "unknown";
    const nodeName = (node.name || "").replace(/"/g, "&quot;");
    lines.push(`  <div data-figma-node="${nodeId}" class="node-${nodeId.replace(/:/g, "-")}">`);
    if (node.type === "TEXT" && node.characters) {
      lines.push(`    <span>${node.characters}</span>`);
    }
    if (node.children && node.children.length > 0) {
      lines.push(generateSectionHtml(sectionIndex, sectionName, node.children));
    }
    lines.push("  </div>");
  }
  lines.push("</section>");
  return lines.join("\n");
}

export function generateSectionCss(sectionIndex: number, nodes: any[]): string {
  const lines: string[] = [];
  for (const node of nodes) {
    const nodeId = (node.id || "unknown").replace(/:/g, "-");
    const bbox = node.absoluteBoundingBox;
    if (bbox) {
      lines.push(`.node-${nodeId} {`);
      lines.push(`  width: ${bbox.width}px;`);
      lines.push(`  height: ${bbox.height}px;`);
      if (node.layoutMode === "HORIZONTAL") {
        lines.push("  display: flex;");
        lines.push("  flex-direction: row;");
      } else if (node.layoutMode === "VERTICAL") {
        lines.push("  display: flex;");
        lines.push("  flex-direction: column;");
      }
      if (node.itemSpacing) {
        lines.push(`  gap: ${node.itemSpacing}px;`);
      }
      if (node.paddingTop !== undefined) {
        lines.push(`  padding: ${node.paddingTop || 0}px ${node.paddingRight || 0}px ${node.paddingBottom || 0}px ${node.paddingLeft || 0}px;`);
      }
      if (node.cornerRadius) {
        lines.push(`  border-radius: ${node.cornerRadius}px;`);
      }
      lines.push("}");
    }
    if (node.children && node.children.length > 0) {
      lines.push(generateSectionCss(sectionIndex, node.children));
    }
  }
  return lines.join("\n");
}

export function assembleIndexHtml(sections: { index: number; html: string }[]): string {
  const lines: string[] = [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="UTF-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    "  <title>Figma to Code</title>",
    '  <link rel="stylesheet" href="styles/tokens.css">',
    "</head>",
    "<body>",
  ];
  for (const section of sections) {
    lines.push(section.html);
  }
  lines.push("</body>");
  lines.push("</html>");
  return lines.join("\n");
}