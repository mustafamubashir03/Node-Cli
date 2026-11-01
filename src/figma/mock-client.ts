/**
 * Mock Figma client for testing the full pipeline without network.
 * Uses the HOPP fixture data.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FigmaDesignContext } from "./types.js";

const FIXTURE_PATH = "tests/fixtures/figma/hopp-real-tree.json";

export class MockFigmaClient {
  private fixture: any;

  constructor(fixturePath?: string) {
    const path = fixturePath || FIXTURE_PATH;
    this.fixture = JSON.parse(readFileSync(path, "utf8"));
  }

  isAvailable(): boolean {
    return true;
  }

  async getDesignContext(url: string): Promise<FigmaDesignContext> {
    const root = this.fixture["0"].node;
    return {
      fileKey: "88lqd4GEAsugHVhooKZCD9",
      nodeId: "1:2",
      name: root.name,
      lastModified: "2026-01-01T00:00:00Z",
      nodes: [root],
    };
  }

  getRestClient(): any {
    return {
      getImages: async (fileKey: string, nodeIds: string[], format: string) => {
        const result: Record<string, string> = {};
        for (const id of nodeIds) {
          result[id] = `https://example.com/${id.replace(/:/g, "-")}.png`;
        }
        return { images: result };
      },
    };
  }
}