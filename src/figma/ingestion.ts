/**
 * Bounding-box normalizer for Figma absoluteBoundingBox {x,y,width,height}.
 * Used by summary, sections, discovery and guards.
 */
export interface NormalizedBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function normalizeBBox(bbox: { x: number; y: number; width?: number; height?: number; w?: number; h?: number } | undefined): NormalizedBBox | null {
  if (!bbox) return null;
  const w = bbox.width ?? bbox.w ?? 0;
  const h = bbox.height ?? bbox.h ?? 0;
  if (w <= 0 || h <= 0) return null;
  return { x: bbox.x ?? 0, y: bbox.y ?? 0, w, h };
}


/**
 * Root guard: fails closed.
 * Rejects nodeId == root, bbox == root, or missing/zero bbox.
 * The root render only goes to reference/full.png inside the package.
 */
export function isRootNode(nodeId: string, rootNodeId: string): boolean {
  return nodeId === rootNodeId;
}

export function hasValidBbox(bbox: { x: number; y: number; width?: number; height?: number; w?: number; h?: number } | undefined): boolean {
  if (!bbox) return false;
  const w = bbox.width ?? bbox.w ?? 0;
  const h = bbox.height ?? bbox.h ?? 0;
  return w > 0 && h > 0;
}

export function isRootBbox(bbox: { x: number; y: number; width?: number; height?: number; w?: number; h?: number } | undefined, rootBbox: { x: number; y: number; width?: number; height?: number; w?: number; h?: number } | undefined): boolean {
  if (!bbox || !rootBbox) return false;
  const bw = bbox.width ?? bbox.w ?? 0;
  const bh = bbox.height ?? bbox.h ?? 0;
  const rw = rootBbox.width ?? rootBbox.w ?? 0;
  const rh = rootBbox.height ?? rootBbox.h ?? 0;
  return bw === rw && bh === rh && bbox.x === rootBbox.x && bbox.y === rootBbox.y;
}


/**
 * Normalizes a Figma node ID into a safe directory name.
 * Replaces ':' with '-' so "1:2" becomes "1-2".
 * Used for EVERY path built from a node id (package, raw, assets, sections, brief pointers).
 * Manifests and API calls keep the original "1:2" format.
 */
export function safeNodeDir(nodeId: string): string {
  return nodeId.replace(/:/g, "-");
}


import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FigmaNode, FigmaAsset } from "./types.js";
import { printNotice, printWarning } from "../ui/messages.js";

export interface TreeNodeInfo {
    node: FigmaNode;
    depth: number;
    sectionIndex: number;
}

export function walkFigmaTree(
    rootNode: FigmaNode,
    maxDepth: number = 10
): TreeNodeInfo[] {
    const result: TreeNodeInfo[] = [];

    function walk(node: FigmaNode, depth: number): void {
        if (depth > maxDepth) return;
        result.push({ node, depth, sectionIndex: -1 });
        for (const child of (node.children || [])) {
            walk(child, depth + 1);
        }
    }

    walk(rootNode, 0);
    return result;
}

export function countNodesByType(nodes: TreeNodeInfo[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const n of nodes) {
        const type = n.node.type || "UNKNOWN";
        counts[type] = (counts[type] || 0) + 1;
    }
    return counts;
}

export function getMaxDepth(nodes: TreeNodeInfo[]): number {
    let max = 0;
    for (const n of nodes) {
        if (n.depth > max) max = n.depth;
    }
    return max;
}

export function isFlattenedImage(rootNode: FigmaNode): boolean {
    const children = rootNode.children || [];
    const childCount = children.length;
    if (childCount === 0) return true;
    if (childCount === 1) {
        const child = children[0];
        const childBBox = child.absoluteBoundingBox;
        const rootBBox = rootNode.absoluteBoundingBox;
        if (childBBox && rootBBox) {
            const coversFrame =
                childBBox.x <= rootBBox.x + 1 &&
                childBBox.y <= rootBBox.y + 1 &&
                childBBox.x + childBBox.width >= rootBBox.x + rootBBox.width - 1 &&
                childBBox.y + childBBox.height >= rootBBox.y + rootBBox.height - 1;
            if (coversFrame && (child.type === "RECTANGLE" || child.fills?.some((f: any) => f.type === "IMAGE"))) {
                return true;
            }
        }
    }
    if (childCount <= 2 && rootNode.fills?.some((f: any) => f.type === "IMAGE")) {
        const rootBBox = rootNode.absoluteBoundingBox;
        if (rootBBox && childCount <= 1) return true;
    }
    return false;
}

export interface DiscoveredAssets {
    assets: FigmaAsset[];
    imageFillNodes: string[];
    vectorNodes: string[];
    exportableNodes: string[];
}

export function discoverAssets(
    treeNodes: TreeNodeInfo[],
    rootBBox: { x: number; y: number; width?: number; height?: number; w?: number; h?: number } | undefined
): DiscoveredAssets {
    const assets: FigmaAsset[] = [];
    const imageFillNodes: string[] = [];
    const vectorNodes: string[] = [];
    const exportableNodes: string[] = [];

    const seen = new Set<string>();

    for (const { node, depth, sectionIndex } of treeNodes) {
        if (!node.id || seen.has(node.id)) continue;
        seen.add(node.id);

        if (node.fills) {
            for (const fill of node.fills) {
                if (fill.type === "IMAGE" && fill.imageRef) {
                    imageFillNodes.push(node.id);
                    assets.push({
                        nodeId: node.id,
                        name: node.name || `unnamed-${node.id}`,
                        type: "image_fill",
                        role: inferAssetRole(node.name),
                        section: sectionIndex,
                        bbox: (node.absoluteBoundingBox ? { x: (node.absoluteBoundingBox as any).x, y: (node.absoluteBoundingBox as any).y, w: (node.absoluteBoundingBox as any).width ?? (node.absoluteBoundingBox as any).w, h: (node.absoluteBoundingBox as any).height ?? (node.absoluteBoundingBox as any).h } : { x: 0, y: 0, w: 0, h: 0 }) as any,
                        format: "png",
                        scale: 2,
                        localPath: undefined,
                        sourceUrl: undefined,
                        status: "pending",
                        usedBy: [],
                    });
                    break;
                }
            }
        }

        if (
            node.type === "VECTOR" ||
            node.type === "BOOLEAN_OPERATION" ||
            node.type === "STAR" ||
            node.type === "LINE" ||
            node.type === "ELLIPSE"
        ) {
            vectorNodes.push(node.id);
            assets.push({
                nodeId: node.id,
                name: node.name || `unnamed-${node.id}`,
                type: "vector",
                role: inferAssetRole(node.name),
                section: sectionIndex,
                bbox: (node.absoluteBoundingBox ? { x: (node.absoluteBoundingBox as any).x, y: (node.absoluteBoundingBox as any).y, w: (node.absoluteBoundingBox as any).width ?? (node.absoluteBoundingBox as any).w, h: (node.absoluteBoundingBox as any).height ?? (node.absoluteBoundingBox as any).h } : { x: 0, y: 0, w: 0, h: 0 }) as any,
                format: "svg",
                scale: 1,
                localPath: undefined,
                sourceUrl: undefined,
                status: "pending",
                usedBy: [],
            });
        }

        if ((node as any).exportSettings) {
            exportableNodes.push(node.id);
        }
    }

    if (rootBBox) {
        for (const asset of assets) {
            const bbox: any = asset.bbox;
            const rootW = (rootBBox as any).width ?? (rootBBox as any).w;
            const rootH = (rootBBox as any).height ?? (rootBBox as any).h;
            if (
                bbox.x === (rootBBox as any).x &&
                bbox.y === (rootBBox as any).y &&
                (bbox.w === rootW || bbox.width === rootW) &&
                (bbox.h === rootH || bbox.height === rootH)
            ) {
                asset.status = "rejected";
                asset.role = "reference";
            }
        }
    }

    return { assets, imageFillNodes, vectorNodes, exportableNodes };
}

function inferAssetRole(name: string): "hero" | "icon" | "logo" | "avatar" | "product" | "background" | "decorative" {
    const n = name.toLowerCase();
    if (n.includes("hero") || n.includes("banner")) return "hero";
    if (n.includes("logo")) return "logo";
    if (n.includes("icon")) return "icon";
    if (n.includes("avatar")) return "avatar";
    if (n.includes("product") || n.includes("shoe") || n.includes("item")) return "product";
    if (n.includes("bg") || n.includes("background")) return "background";
    return "decorative";
}

export interface SectionSpec {
    index: number;
    name: string;
    dir: string;
    spec: string;
    specPath: string;
    specJsonPath: string;
    referencePath: string;
    assetsPath: string;
    bbox: { x: number; y: number; w: number; h: number };
    nodeCount: number;
}

export function segmentSections(
    rootNode: FigmaNode,
    packageDir: string
): SectionSpec[] {
    const sections: SectionSpec[] = [];
    const children = rootNode.children || [];

    if (children.length === 0) return sections;

    const rootBBox = rootNode.absoluteBoundingBox;
    const rootWidth = rootBBox?.width ?? 0;

    let sectionIndex = 0;
    for (const child of children) {
        if (child.type !== "FRAME" && child.type !== "GROUP") continue;
        const bbox = child.absoluteBoundingBox;
        if (!bbox) continue;

        const isFullWidth = rootWidth > 0 && bbox.width >= rootWidth * 0.9;
        if (!isFullWidth) continue;

        const firstText = (child.children || []).find((c) => c.type === "TEXT");
         const slugBase = firstText ? child.name + " " + (firstText.characters || firstText.name) : child.name;
         const slug = slugBase.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
        const dir = join(packageDir, "sections", `${String(sectionIndex + 1).padStart(2, "0")}-${slug}`);
        mkdirSync(dir, { recursive: true });
        const specJsonPath = join(dir, "spec.json");
        sections.push({
            index: sectionIndex,
            name: child.name,
            dir,
            spec: specJsonPath,
            specPath: join(dir, "spec.md"),
            specJsonPath: specJsonPath,
            referencePath: join(dir, "reference.png"),
            assetsPath: join(dir, "assets.json"),
            bbox: { x: bbox.x, y: bbox.y, w: bbox.width, h: bbox.height },
            nodeCount: child.children?.length ?? 0,
        });
        sectionIndex++;
    }

    if (sections.length === 0 && children.length > 0) {
        const bands = detectBands(children, rootWidth);
        for (const band of bands) {
            const dir = join(packageDir, "sections", `${String(sectionIndex + 1).padStart(2, "0")}-section`);
            mkdirSync(dir, { recursive: true });
            const sbjp = join(dir, "spec.json");
            sections.push({
                index: sectionIndex,
                name: `Section ${sectionIndex + 1}`,
                dir,
                spec: sbjp,
                specPath: join(dir, "spec.md"),
                specJsonPath: sbjp,
                referencePath: join(dir, "reference.png"),
                assetsPath: join(dir, "assets.json"),
                bbox: band.bbox,
                nodeCount: band.nodeCount,
            });
            sectionIndex++;
        }
    }

    return sections;
}

function detectBands(
    children: FigmaNode[],
    rootWidth: number
): { bbox: { x: number; y: number; w: number; h: number }; nodeCount: number }[] {
    const bands: { bbox: { x: number; y: number; w: number; h: number }; nodeCount: number }[] = [];
    const sorted = [...children].filter((c) => c.absoluteBoundingBox).sort(
        (a, b) => (a.absoluteBoundingBox!.y ?? 0) - (b.absoluteBoundingBox!.y ?? 0)
    );

    let currentBand: { bbox: { x: number; y: number; w: number; h: number }; nodeCount: number } | null = null;

    for (const child of sorted) {
        const bbox = child.absoluteBoundingBox!;
        if (!currentBand) {
            currentBand = {
                bbox: { x: bbox.x, y: bbox.y, w: bbox.width, h: bbox.height },
                nodeCount: 1,
            };
        } else if (bbox.y <= currentBand.bbox.y + currentBand.bbox.h + 10) {
            currentBand.bbox.h = Math.max(currentBand.bbox.y + currentBand.bbox.h, bbox.y + bbox.height) - currentBand.bbox.y;
            currentBand.bbox.w = Math.max(currentBand.bbox.w, bbox.width);
            currentBand.nodeCount++;
        } else {
            bands.push(currentBand);
            currentBand = {
                bbox: { x: bbox.x, y: bbox.y, w: bbox.width, h: bbox.height },
                nodeCount: 1,
            };
        }
    }
    if (currentBand) bands.push(currentBand);

    return bands;
}

export function createPlaceholderAsset(
    nodeId: string,
    name: string,
    bbox: { x: number; y: number; w: number; h: number },
    format: "svg" | "png" = "svg"
): string {
    const svg = `<svg width="${bbox.w}" height="${bbox.h}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${bbox.w}" height="${bbox.h}" fill="#e0e0e0" stroke="#999999" stroke-width="1"/>
  <text x="${bbox.w / 2}" y="${bbox.h / 2}" font-family="Arial" font-size="12" fill="#666666" text-anchor="middle" dominant-baseline="middle">
    ${name} (${nodeId})
  </text>
</svg>`;
    return svg;
}

export function printTreeSummary(info: {
    nodeCount: number;
    typeCounts: Record<string, number>;
    maxDepth: number;
    topLevelChildren: { name: string; type: string; bbox?: { x: number; y: number; w: number; h: number } }[];
    isFlattened: boolean;
}): void {
    printNotice(`Figma tree: ${info.nodeCount} nodes, max depth ${info.maxDepth}`);
    printNotice(`Types: ${Object.entries(info.typeCounts).map(([t, c]) => `${t}=${c}`).join(", ")}`);
    if (info.isFlattened) {
        printWarning(
            "WARNING: This frame looks like a flattened image. " +
            "Structured extraction is not possible. Vision-based reconstruction required."
        );
    }
    for (const child of info.topLevelChildren) {
        printNotice(
            `  ${child.type} "${child.name}" ${child.bbox ? `${child.bbox.w}x${child.bbox.h}` : "no bbox"}`
        );
    }
}