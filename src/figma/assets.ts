import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { FigmaRestClient } from "./rest-client.js";
import type { FigmaAsset, FigmaNode } from "./types.js";

export interface AssetManifest {
  fileKey: string;
  nodeId?: string;
  assets: FigmaAsset[];
  downloadedAt: string;
  totalRequested: number;
  totalDownloaded: number;
  totalFailed: number;
}

/**
 * Download assets from Figma for a given file and node IDs.
 */
export async function downloadFigmaAssets(
  client: FigmaRestClient,
  fileKey: string,
  nodeIds: string[],
  outputDir: string,
  format: "svg" | "png" | "jpg" = "png"
): Promise<AssetManifest> {
  const assets: FigmaAsset[] = [];
  const manifest: AssetManifest = {
    fileKey,
    assets,
    downloadedAt: new Date().toISOString(),
    totalRequested: nodeIds.length,
    totalDownloaded: 0,
    totalFailed: 0,
  };

  // Ensure output directory exists
  mkdirSync(outputDir, { recursive: true });

  // Get image URLs from Figma
  let imageUrls: Record<string, string> = {};
  try {
    const response = await client.getImages(fileKey, nodeIds, format);
    imageUrls = response.images || {};
  } catch (error: any) {
    // If export fails, record all as failed
    for (const nodeId of nodeIds) {
      assets.push({
        nodeId: nodeId,
        name: `unnamed-${nodeId}`,
        type: "image_fill",
        role: "decorative",
        section: -1,
        bbox: { x: 0, y: 0, w: 0, h: 0 },
        format,
        scale: 2,
        localPath: undefined,
        sourceUrl: undefined,
        status: "failed",
        usedBy: [],
      });
      manifest.totalFailed++;
    }
    return manifest;
  }

  // Download each asset
  for (const nodeId of nodeIds) {
    const asset: FigmaAsset = {
      nodeId: nodeId,
      name: `unnamed-${nodeId}`,
      type: "image_fill",
      role: "decorative",
      section: -1,
      bbox: { x: 0, y: 0, w: 0, h: 0 },
      format,
      scale: 2,
      localPath: undefined,
      sourceUrl: undefined,
      status: "pending",
      usedBy: [],
    };

    const url = imageUrls[nodeId];
    if (!url) {
      asset.status = "failed";
      manifest.totalFailed++;
      assets.push(asset);
      continue;
    }

    asset.sourceUrl = url;
    const fileName = `${nodeId.replace(/:/g, "-")}.${format}`;
    const localPath = join(outputDir, fileName);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        asset.localPath = undefined;
        asset.status = "failed";
        manifest.totalFailed++;
        assets.push(asset);
        continue;
      }

      const buffer = await response.arrayBuffer();
      if (buffer.byteLength === 0) {
        asset.localPath = undefined;
        asset.status = "failed";
        manifest.totalFailed++;
        assets.push(asset);
        continue;
      }

      writeFileSync(localPath, Buffer.from(buffer));
      asset.localPath = localPath;
      asset.size = buffer.byteLength;
      asset.status = "downloaded";
      manifest.totalDownloaded++;
    } catch {
      asset.localPath = undefined;
      asset.status = "failed";
      manifest.totalFailed++;
    }

    assets.push(asset);
  }

  return manifest;
}

/**
 * Find image fill nodes in a Figma node tree.
 */
export function findImageFillNodes(node: FigmaNode): string[] {
  const result: string[] = [];
  if (node.fills) {
    for (const fill of node.fills) {
      if (fill.type === "IMAGE" && node.id) {
        result.push(node.id);
      }
    }
  }
  if (node.children) {
    for (const child of node.children) {
      result.push(...findImageFillNodes(child));
    }
  }
  return [...new Set(result)];
}

/**
 * Write asset manifest to file.
 */
export function writeAssetManifest(manifest: AssetManifest, outputPath: string): void {
  const content = JSON.stringify(manifest, null, 2);
  writeFileSync(outputPath, content, "utf8");
}

/**
 * Read asset manifest from file.
 */
export function readAssetManifest(path: string): AssetManifest | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as AssetManifest;
  } catch {
    return null;
  }
}