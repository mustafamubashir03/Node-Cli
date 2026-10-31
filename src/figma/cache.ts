import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

const CACHE_DIR = join(homedir(), ".node-cli", "cache", "figma");

export interface CacheEntry<T> {
  key: string;
  data: T;
  timestamp: number;
  ttl: number; // milliseconds
}

export class FigmaCache {
  private cacheDir: string;

  constructor(cacheDir?: string) {
    this.cacheDir = cacheDir || CACHE_DIR;
    mkdirSync(this.cacheDir, { recursive: true });
  }

  private getCachePath(key: string): string {
    const hash = createHash("sha256").update(key).digest("hex");
    return join(this.cacheDir, `${hash}.json`);
  }

  get<T>(key: string): T | null {
    const path = this.getCachePath(key);
    if (!existsSync(path)) return null;

    try {
      const entry = JSON.parse(readFileSync(path, "utf8")) as CacheEntry<T>;
      if (Date.now() - entry.timestamp > entry.ttl) {
        // Expired
        unlinkSync(path);
        return null;
      }
      return entry.data;
    } catch {
      return null;
    }
  }

  set<T>(key: string, data: T, ttlMs: number = 3600000): void {
    const path = this.getCachePath(key);
    const entry: CacheEntry<T> = {
      key,
      data,
      timestamp: Date.now(),
      ttl: ttlMs,
    };
    try {
      writeFileSync(path, JSON.stringify(entry), "utf8");
    } catch {
      // Ignore cache write failures
    }
  }

  invalidate(key: string): void {
    const path = this.getCachePath(key);
    if (existsSync(path)) {
      try {
        unlinkSync(path);
      } catch {
        // Ignore
      }
    }
  }

  clear(): void {
    try {
      for (const file of readdirSync(this.cacheDir)) {
        if (file.endsWith(".json")) {
          unlinkSync(join(this.cacheDir, file));
        }
      }
    } catch {
      // Ignore
    }
  }

  static cacheKey(fileKey: string, nodeId?: string, version?: string): string {
    return `figma:${fileKey}:${nodeId || "root"}:${version || "latest"}`;
  }

  static cacheKeyFromEndpoint(endpoint: string): string {
    // Normalize endpoint: remove leading slash, sort query params
    const normalized = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;
    // Include the full normalized endpoint as the key to ensure uniqueness
    return `figma:endpoint:${normalized}`;
  }
}