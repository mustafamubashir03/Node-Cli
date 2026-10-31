import type { FigmaDesignContext, FigmaNode, FigmaDesignSpec, FigmaAsset } from "./types.js";

/**
 * Generate a structured design specification from Figma design context.
 */
export function generateDesignSpec(context: FigmaDesignContext, assets: FigmaAsset[] = []): FigmaDesignSpec {
  const rootNode = context.nodes[0];
  const bbox = rootNode?.absoluteBoundingBox;

  return {
    source: {
      fileKey: context.fileKey,
      nodeId: context.nodeId,
      url: `https://www.figma.com/design/${context.fileKey}${context.nodeId ? `?node-id=${context.nodeId.replace(":", "-")}` : ""}`,
    },
    frame: {
      name: context.name,
      width: bbox?.width || 0,
      height: bbox?.height || 0,
    },
    layout: extractLayout(rootNode),
    tokens: extractTokens(context),
    components: extractComponents(context.nodes),
    assets,
    interactions: extractInteractions(context.nodes),
    unresolved: identifyUnresolved(context),
  };
}

function extractLayout(node: FigmaNode | undefined): FigmaDesignSpec["layout"] {
  if (!node) return { type: "unknown" };

  const layout: FigmaDesignSpec["layout"] = {
    type: node.layoutMode || "none",
  };

  if (node.layoutMode === "HORIZONTAL" || node.layoutMode === "VERTICAL") {
    layout.direction = node.layoutMode === "HORIZONTAL" ? "row" : "column";
  }

  if (node.paddingTop !== undefined || node.paddingLeft !== undefined) {
    layout.padding = {
      top: node.paddingTop || 0,
      right: node.paddingRight || 0,
      bottom: node.paddingBottom || 0,
      left: node.paddingLeft || 0,
    };
  }

  if (node.itemSpacing !== undefined) {
    layout.gap = node.itemSpacing;
  }

  return layout;
}

function extractTokens(context: FigmaDesignContext): FigmaDesignSpec["tokens"] {
  const colors: Record<string, string> = {};
  const spacing: Record<string, number> = {};
  const typography: Record<string, any> = {};

  // Extract colors from fills
  function walkNodes(node: FigmaNode, prefix: string) {
    if (node.fills) {
      for (const fill of node.fills) {
        if (fill.type === "SOLID" && fill.color) {
          const hex = rgbToHex(fill.color);
          const key = `${prefix}-${node.name}`.replace(/\s+/g, "-").toLowerCase();
          colors[key] = hex;
        }
      }
    }

    if (node.absoluteBoundingBox) {
      const key = `${prefix}-${node.name}-size`.replace(/\s+/g, "-").toLowerCase();
      spacing[key] = Math.round(node.absoluteBoundingBox.width);
    }

    if (node.style) {
      const key = `${prefix}-${node.name}`.replace(/\s+/g, "-").toLowerCase();
      typography[key] = {
        fontFamily: node.style.fontFamily,
        fontSize: node.style.fontSize,
        fontWeight: node.style.fontWeight,
        lineHeight: node.style.lineHeightPx,
        letterSpacing: node.style.letterSpacing,
        textAlign: node.style.textAlignHorizontal,
      };
    }

    if (node.children) {
      for (const child of node.children) {
        walkNodes(child, prefix);
      }
    }
  }

  for (const node of context.nodes) {
    walkNodes(node, "token");
  }

  // Extract variables
  if (context.variables) {
    for (const v of context.variables) {
      if (v.resolvedType === "COLOR") {
        const mode = Object.keys(v.valuesByMode)[0];
        const val = v.valuesByMode[mode];
        if (val && val.r !== undefined) {
          colors[v.name] = rgbToHex(val);
        }
      }
    }
  }

  return { colors, spacing, typography };
}

function extractComponents(nodes: FigmaNode[]): FigmaDesignSpec["components"] {
  const components: FigmaDesignSpec["components"] = [];
  const seen = new Set<string>();

  function walk(node: FigmaNode) {
    if (node.type === "COMPONENT" || node.type === "INSTANCE") {
      if (!seen.has(node.id)) {
        seen.add(node.id);
        components.push({
          id: node.id,
          name: node.name,
          type: node.type,
          reusable: node.type === "COMPONENT",
        });
      }
    }
    if (node.children) {
      for (const child of node.children) walk(child);
    }
  }

  for (const node of nodes) walk(node);
  return components;
}

function extractInteractions(nodes: FigmaNode[]): string[] {
  const interactions: string[] = [];
  // Basic interaction detection from node names
  function walk(node: FigmaNode) {
    const name = node.name.toLowerCase();
    if (name.includes("button") || name.includes("cta")) {
      interactions.push(`Button: ${node.name}`);
    }
    if (name.includes("link") || name.includes("nav")) {
      interactions.push(`Navigation: ${node.name}`);
    }
    if (name.includes("form") || name.includes("input")) {
      interactions.push(`Form: ${node.name}`);
    }
    if (node.children) {
      for (const child of node.children) walk(child);
    }
  }
  for (const node of nodes) walk(node);
  return [...new Set(interactions)];
}

function identifyUnresolved(context: FigmaDesignContext): string[] {
  const unresolved: string[] = [];
  // Check for missing dimensions
  for (const node of context.nodes) {
    if (!node.absoluteBoundingBox) {
      unresolved.push(`Node "${node.name}" has no bounding box`);
    }
  }
  // Check for missing fonts
  // (would need to check against system fonts, simplified here)
  return unresolved;
}

function rgbToHex(color: { r: number; g: number; b: number; a?: number }): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}