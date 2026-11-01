import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

const CACHE_DIR = join(homedir(), ".node-cli", "cache", "figma");

export interface CacheEntry<T> {
  key: string;
  data: T;
  timestamp: number;
  ttl: number;
  version?: string;
}

export class FigmaCache {
  static cacheKeyFromEndpoint(endpoint: string): string {
    return endpoint;
  }
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
        unlinkSync(path);
        return null;
      }
      return entry.data;
    } catch {
      return null;
    }
  }

  getWithVersion<T>(key: string, version: string): T | null {
    const path = this.getCachePath(key);
    if (!existsSync(path)) return null;

    try {
      const entry = JSON.parse(readFileSync(path, "utf8")) as CacheEntry<T>;
      if (entry.version !== version) return null;
      if (Date.now() - entry.timestamp > entry.ttl) {
        unlinkSync(path);
        return null;
      }
      return entry.data;
    } catch {
      return null;
    }
  }

  set<T>(key: string, data: T, ttlMs: number = 3600000, version?: string): void {
    const path = this.getCachePath(key);
    const entry: CacheEntry<T> = { key, data, timestamp: Date.now(), ttl: ttlMs, version };
    writeFileSync(path, JSON.stringify(entry));
  }

  invalidate(key: string): void {
    const path = this.getCachePath(key);
    if (existsSync(path)) {
      try { unlinkSync(path); } catch { /* ignore */ }
    }
  }

  static cacheKey(fileKey: string, nodeId: string): string {
    return `${fileKey}:${nodeId}`;
  }

  clear(): void {
    if (!existsSync(this.cacheDir)) return;
    for (const f of readdirSync(this.cacheDir)) {
      if (f.endsWith(".json")) {
        try { unlinkSync(join(this.cacheDir, f)); } catch { /* ignore */ }
      }
    }
  }
}
