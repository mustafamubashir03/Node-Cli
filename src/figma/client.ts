import { FigmaRestClient } from "./rest-client.js";
import { FigmaCache } from "./cache.js";
import type { FigmaDesignContext } from "./types.js";
import { parseFigmaUrl } from "./url-parser.js";
import { getFigmaToken } from "./credentials.js";

export interface FigmaClientConfig {
  accessToken?: string;
  mcpEndpoint?: string;
  cache?: FigmaCache;
  useCache?: boolean;
}

export class FigmaClient {
  private restClient: FigmaRestClient | null = null;
  private mcpAvailable = false;

  constructor(config: FigmaClientConfig = {}) {
    const token = config.accessToken || getFigmaToken();
    if (token) {
      this.restClient = new FigmaRestClient({
        accessToken: token,
        cache: config.cache || new FigmaCache(),
        useCache: config.useCache,
      });
    }
  }

  /**
   * Check if Figma integration is available.
   */
  isAvailable(): boolean {
    return this.restClient !== null;
  }

  /**
   * Get the REST client (for asset downloading).
   */
  getRestClient(): FigmaRestClient | null {
    return this.restClient;
  }

  /**
   * Get design context from a Figma URL.
   */
  async getDesignContext(url: string): Promise<FigmaDesignContext> {
    if (!this.restClient) {
      throw new Error("Figma access token not configured. Set FIGMA_ACCESS_TOKEN environment variable or run 'node-cli figma setup'.");
    }

    const parsed = parseFigmaUrl(url);
    if (!parsed) {
      throw new Error("Invalid Figma URL");
    }

    return this.restClient.getDesignContext(parsed.fileKey, parsed.nodeId);
  }

  /**
   * Get file structure (pages and frames) for frame discovery.
   */
  async getFileStructure(url: string): Promise<{ pages: { id: string; name: string; frames: { id: string; name: string; width: number; height: number }[] }[] }> {
    if (!this.restClient) {
      throw new Error("Figma access token not configured.");
    }

    const parsed = parseFigmaUrl(url);
    if (!parsed) {
      throw new Error("Invalid Figma URL");
    }

    return this.restClient.getFileStructure(parsed.fileKey);
  }

  /**
   * Get the access token from environment or stored credentials.
   */
  static getAccessToken(): string | undefined {
    return getFigmaToken() || undefined;
  }

  /**
   * Create a client from environment variables or stored credentials.
   */
  static fromEnvironment(): FigmaClient {
    const token = getFigmaToken();
    return new FigmaClient({ accessToken: token || undefined });
  }
}