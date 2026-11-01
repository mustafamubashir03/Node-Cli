import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getSkill } from "../config/catalog.js";

export type ResourceResolutionStatus =
    | "CATALOGED"
    | "AVAILABLE"
    | "FETCHED"
    | "DELIVERED"
    | "END_TO_END_VERIFIED"
    | "UNAVAILABLE"
    | "FAILED";

export type ResolvedResource = {
    id: string;
    status: ResourceResolutionStatus;
    /** Files that were successfully resolved. */
    files: string[];
    /** SHA-256 of the primary content (if any). */
    contentHash: string | null;
    /** Size in bytes of delivered content. */
    bytes: number;
    /** Primary content text (bounded by caller). */
    content: string | null;
    /** Error message if resolution failed. */
    error: string | null;
    /** Pinned revision used. */
    revision: string | null;
    /** Whether content was included in the model-facing input. */
    delivered: boolean;
};

export type ResourceResolverOptions = {
    cacheRoot?: string;
    /** Max retries for network failures. */
    maxRetries?: number;
    /** Per-request timeout ms. */
    timeoutMs?: number;
    /** Fetch implementation (for tests). */
    fetchImpl?: typeof fetch;
    /** Override candidate paths (for component-specific retrieval). */
    paths?: string[];
};

const DEFAULT_CACHE_ROOT = join(homedir(), ".node-cli", "resource-cache");
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 15000;

function parseRepo(sourceRepo: string | null): { owner: string; repo: string } | null {
    if (!sourceRepo) return null;
    const cleaned = sourceRepo.replace(/^https?:\/\//, "").replace(/^github\.com\//, "");
    const parts = cleaned.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1] };
}

function cacheDir(cacheRoot: string, id: string, revision: string): string {
    const safeId = id.replace(/[^A-Za-z0-9._-]/g, "_");
    const safeRev = revision.replace(/[^A-Za-z0-9._-]/g, "_");
    return join(cacheRoot, safeId, safeRev);
}

function candidatePaths(entry: ReturnType<typeof getSkill>): string[] {
    const paths: string[] = [];
    if (entry?.payloadPaths && entry.payloadPaths.length > 0) {
        for (const p of entry.payloadPaths) paths.push(p);
    }
    // Common skill/doc entry points.
    paths.push("SKILL.md", "README.md", "README.mdx", "docs/README.md");
    // Dedup while preserving order.
    const seen = new Set<string>();
    return paths.filter((p) => {
        if (seen.has(p)) return false;
        seen.add(p);
        return true;
    });
}

async function fetchWithRetry(
    url: string,
    fetchImpl: typeof fetch,
    timeoutMs: number,
    maxRetries: number,
): Promise<{ ok: boolean; status: number; text: string; error?: string }> {
    let lastError = "";
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            const res = await fetchImpl(url, { signal: controller.signal });
            clearTimeout(timer);
            if (res.status === 404) {
                return { ok: false, status: 404, text: "" };
            }
            if (!res.ok) {
                lastError = `HTTP ${res.status}`;
                // retry on 5xx / 429
                if (res.status >= 500 || res.status === 429) {
                    if (attempt < maxRetries) {
                        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
                        continue;
                    }
                }
                return { ok: false, status: res.status, text: "", error: lastError };
            }
            const text = await res.text();
            return { ok: true, status: res.status, text };
        } catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
            if (attempt < maxRetries) {
                await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
                continue;
            }
        }
    }
    return { ok: false, status: 0, text: "", error: lastError || "fetch failed" };
}

export async function resolveResource(
    id: string,
    options: ResourceResolverOptions = {},
): Promise<ResolvedResource> {
    const cacheRoot = options.cacheRoot ?? DEFAULT_CACHE_ROOT;
    const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const fetchImpl = options.fetchImpl ?? fetch;

    const entry = getSkill(id);
    if (!entry) {
        return {
            id,
            status: "UNAVAILABLE",
            files: [],
            contentHash: null,
            bytes: 0,
            content: null,
            error: `Skill '${id}' is not in the catalog.`,
            revision: null,
            delivered: false,
        };
    }

    const revision = entry.sourceCommit ?? null;
    const repo = parseRepo(entry.sourceRepo);
    if (!repo || !revision) {
        return {
            id,
            status: "CATALOGED",
            files: [],
            contentHash: null,
            bytes: 0,
            content: null,
            error: "No pinned source revision or repository; cannot fetch.",
            revision,
            delivered: false,
        };
    }

    const paths = options.paths && options.paths.length > 0 ? options.paths : candidatePaths(entry);
    const dir = cacheDir(cacheRoot, id, revision);
    mkdirSync(dir, { recursive: true });

    // Try cache first.
    const cacheFile = join(dir, "primary.txt");
    const cacheMeta = join(dir, "meta.json");
    if (existsSync(cacheFile) && existsSync(cacheMeta)) {
        try {
            const cached = readFileSync(cacheFile, "utf8");
            const meta = JSON.parse(readFileSync(cacheMeta, "utf8")) as { path: string; hash: string };
            if (cached.trim().length > 0) {
                return {
                    id,
                    status: "FETCHED",
                    files: [meta.path],
                    contentHash: meta.hash,
                    bytes: Buffer.byteLength(cached, "utf8"),
                    content: cached,
                    error: null,
                    revision,
                    delivered: false,
                };
            }
        } catch {
            // fall through to refetch
        }
    }

    // Fetch.
    let foundPath: string | null = null;
    let foundText = "";
    let fetchError: string | null = null;
    for (const p of paths) {
        const url = `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${revision}/${p}`;
        const result = await fetchWithRetry(url, fetchImpl, timeoutMs, maxRetries);
        if (result.ok && result.text.trim().length > 0) {
            foundPath = p;
            foundText = result.text;
            break;
        }
        if (result.status !== 404) {
            fetchError = result.error ?? `HTTP ${result.status}`;
        }
        // 404 -> try next path
    }

    if (!foundPath) {
        return {
            id,
            status: "FAILED",
            files: [],
            contentHash: null,
            bytes: 0,
            content: null,
            error: fetchError ?? "No fetchable content found at pinned revision.",
            revision,
            delivered: false,
        };
    }

    const hash = createHash("sha256").update(foundText, "utf8").digest("hex");
    try {
        writeFileSync(cacheFile, foundText, "utf8");
        writeFileSync(cacheMeta, JSON.stringify({ path: foundPath, hash }, null, 2), "utf8");
    } catch {
        // cache write failure is non-fatal
    }

    return {
        id,
        status: "FETCHED",
        files: [foundPath],
        contentHash: hash,
        bytes: Buffer.byteLength(foundText, "utf8"),
        content: foundText,
        error: null,
        revision,
        delivered: false,
    };
}

export async function resolveResources(
    ids: string[],
    options: ResourceResolverOptions = {},
): Promise<ResolvedResource[]> {
    const seen = new Set<string>();
    const unique = ids.filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
    });
    return Promise.all(unique.map((id) => resolveResource(id, options)));
}
