import type { FigmaDesignContext, FigmaNode, FigmaVariable, FigmaComponent } from "./types.js";
import { FigmaCache } from "./cache.js";

const FIGMA_API_BASE = "https://api.figma.com/v1";

export interface FigmaClientOptions {
  accessToken: string;
  cache?: FigmaCache;
  useCache?: boolean;
}

export class FigmaRestClient {
  private accessToken: string;
  private cache: FigmaCache | null;
  private useCache: boolean;

  constructor(options: FigmaClientOptions) {
    this.accessToken = options.accessToken;
    this.cache = options.cache || null;
    this.useCache = options.useCache !== false;
  }

  /**
   * Get the cache instance (for testing/inspection).
   */
  getCache(): FigmaCache | null {
    return this.cache;
  }

  private async fetch(endpoint: string, retries = 3): Promise<any> {
    // Check cache first
    if (this.useCache && this.cache) {
      const cacheKey = FigmaCache.cacheKeyFromEndpoint(endpoint);
      const cached = this.cache.get<any>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
      const response = await fetch(`${FIGMA_API_BASE}${endpoint}`, {
        headers: {
          "X-Figma-Token": this.accessToken,
        },
      });

      if (response.ok) {
        const data = await response.json();
        // Cache successful response
        if (this.useCache && this.cache) {
          const cacheKey = FigmaCache.cacheKeyFromEndpoint(endpoint);
          this.cache.set(cacheKey, data);
        }
        return data;
      }

      if (response.status === 429) {
        if (attempt < retries) {
          const retryAfter = response.headers.get("Retry-After");
          const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : Math.min(1000 * Math.pow(2, attempt), 30000);
          const jitter = Math.random() * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay + jitter));
          continue;
        }
        throw new Error("Rate limited by Figma API. Please wait and retry.");
      }

      if (response.status === 403) {
        throw new Error("Access denied. Check your Figma token and file permissions.");
      }
      if (response.status === 404) {
        throw new Error("File or node not found. Check the URL and your access.");
      }
      if (response.status >= 500 && attempt < retries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      throw new Error(`Figma API error: ${response.status} ${response.statusText}`);
    }

    throw new Error("Max retries exceeded");
  }

  async getFile(fileKey: string): Promise<any> {
    return this.fetch(`/files/${fileKey}`);
  }

  /**
   * Get file structure (pages and top-level frames) without full node details.
   */
  async getFileStructure(fileKey: string): Promise<{ pages: { id: string; name: string; frames: { id: string; name: string; width: number; height: number }[] }[] }> {
    const file = await this.getFile(fileKey);
    const pages: { id: string; name: string; frames: { id: string; name: string; width: number; height: number }[] }[] = [];

    for (const page of file.document?.children || []) {
      const frames: { id: string; name: string; width: number; height: number }[] = [];
      for (const child of page.children || []) {
        if (child.type === "FRAME" || child.type === "COMPONENT" || child.type === "COMPONENT_SET") {
          frames.push({
            id: child.id,
            name: child.name,
            width: child.absoluteBoundingBox?.width || 0,
            height: child.absoluteBoundingBox?.height || 0,
          });
        }
      }
      pages.push({ id: page.id, name: page.name, frames });
    }

    return { pages };
  }

  async getFileNodes(fileKey: string, nodeIds: string[]): Promise<any> {
    const ids = nodeIds.join(",");
    return this.fetch(`/files/${fileKey}/nodes?ids=${ids}`);
  }

  async getImages(fileKey: string, nodeIds: string[], format: "svg" | "png" | "jpg" = "png"): Promise<any> {
    const ids = nodeIds.join(",");
    return this.fetch(`/images/${fileKey}?ids=${ids}&format=${format}`);
  }

  async getVariables(fileKey: string): Promise<any> {
    return this.fetch(`/files/${fileKey}/variables/local`);
  }

  async getComponents(fileKey: string): Promise<any> {
    return this.fetch(`/files/${fileKey}/components`);
  }

  async getStyles(fileKey: string): Promise<any> {
    return this.fetch(`/files/${fileKey}/styles`);
  }

  /**
   * Extract design context from a Figma file or specific node.
   */
  async getDesignContext(fileKey: string, nodeId?: string): Promise<FigmaDesignContext> {
    if (nodeId) {
      const nodesResponse = await this.getFileNodes(fileKey, [nodeId]);
      const nodeData = nodesResponse.nodes?.[nodeId];
      if (!nodeData) {
        throw new Error(`Node ${nodeId} not found in file ${fileKey}`);
      }
      return {
        fileKey,
        nodeId,
        name: nodeData.document?.name || "Unknown",
        lastModified: nodesResponse.lastModified || "",
        thumbnailUrl: nodesResponse.thumbnailUrl,
        nodes: [normalizeNode(nodeData.document)],
      };
    }

    const fileResponse = await this.getFile(fileKey);
    return {
      fileKey,
      name: fileResponse.name || "Unknown",
      lastModified: fileResponse.lastModified || "",
      thumbnailUrl: fileResponse.thumbnailUrl,
      nodes: fileResponse.document?.children?.map(normalizeNode) || [],
    };
  }
}

function normalizeNode(node: any): FigmaNode {
  if (!node) return { id: "unknown", name: "Unknown", type: "UNKNOWN" };

  return {
    id: node.id,
    name: node.name,
    type: node.type,
    visible: node.visible !== false,
    children: node.children?.map(normalizeNode),
    layoutMode: node.layoutMode,
    primaryAxisSizingMode: node.primaryAxisSizingMode,
    counterAxisSizingMode: node.counterAxisSizingMode,
    paddingLeft: node.paddingLeft,
    paddingRight: node.paddingRight,
    paddingTop: node.paddingTop,
    paddingBottom: node.paddingBottom,
    itemSpacing: node.itemSpacing,
    absoluteBoundingBox: node.absoluteBoundingBox,
    fills: node.fills,
    strokes: node.strokes,
    effects: node.effects,
    cornerRadius: node.cornerRadius,
    opacity: node.opacity,
    style: node.style,
    characters: node.characters,
    componentId: node.componentId,
    componentProperties: node.componentProperties,
  };
}