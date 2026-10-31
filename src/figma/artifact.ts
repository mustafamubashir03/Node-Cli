import type { FigmaDesignSpec } from "./types.js";
import { writeArtifact } from "../workflow/plan-artifacts.js";

/**
 * Write the Figma design spec as a planning artifact.
 */
export function writeFigmaDesignSpec(spec: FigmaDesignSpec, projectRoot?: string): void {
  const content = formatDesignSpecMarkdown(spec);
  writeArtifact("brief", content, projectRoot);
}

function formatDesignSpecMarkdown(spec: FigmaDesignSpec): string {
  const lines = [
    "# Figma Design Specification",
    "",
    "## Source",
    `- File Key: ${spec.source.fileKey}`,
    `- Node ID: ${spec.source.nodeId || "root"}`,
    `- URL: ${spec.source.url}`,
    "",
    "## Frame",
    `- Name: ${spec.frame.name}`,
    `- Dimensions: ${spec.frame.width}x${spec.frame.height}px`,
    "",
    "## Layout",
    `- Type: ${spec.layout.type}`,
    `- Direction: ${spec.layout.direction || "N/A"}`,
    `- Padding: ${spec.layout.padding ? `${spec.layout.padding.top}/${spec.layout.padding.right}/${spec.layout.padding.bottom}/${spec.layout.padding.left}` : "N/A"}`,
    `- Gap: ${spec.layout.gap ?? "N/A"}`,
    "",
    "## Design Tokens",
    "",
    "### Colors",
    ...Object.entries(spec.tokens.colors).map(([k, v]) => `- ${k}: ${v}`),
    "",
    "### Typography",
    ...Object.entries(spec.tokens.typography).map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`),
    "",
    "## Components",
    ...spec.components.map((c) => `- ${c.name} (${c.type})${c.reusable ? " [reusable]" : ""}`),
    "",
    "## Assets",
    ...spec.assets.map((a) => `- ${a.nodeId}: ${a.format} (${a.localPath || "not downloaded"})`),
    "",
    "## Interactions",
    ...spec.interactions.map((i) => `- ${i}`),
    "",
    "## Unresolved",
    ...(spec.unresolved.length > 0 ? spec.unresolved.map((u) => `- ${u}`) : ["- None"]),
  ];
  return lines.join("\n");
}