import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, basename, extname, resolve } from "node:path";
import type { ImageResult } from "./types.js";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const DOWNLOAD_TIMEOUT = 30_000; // 30 seconds
const ALLOWED_HOSTS = new Set([
    "pixabay.com",
    "cdn.pixabay.com",
    "images.unsplash.com",
    "images.pexels.com",
]);

export type DownloadResult = {
    ok: boolean;
    localPath: string | null;
    error: string | null;
    metadata: {
        sourceUrl: string;
        photographer: string;
        attribution: string;
        license: string;
    } | null;
};

export function isAllowedHost(url: string): boolean {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:") return false;
        return ALLOWED_HOSTS.has(parsed.hostname);
    } catch {
        return false;
    }
}

export function safeFilename(url: string, fallback: string = "image"): string {
    try {
        const parsed = new URL(url);
        const raw = basename(parsed.pathname) || fallback;
        // Remove any path traversal attempts
        const cleaned = raw.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.+/g, ".");
        if (!cleaned || cleaned === "." || cleaned === "..") return `${fallback}.jpg`;
        // Ensure extension
        if (!extname(cleaned)) return `${cleaned}.jpg`;
        return cleaned;
    } catch {
        return `${fallback}.jpg`;
    }
}

export async function downloadImage(
    result: ImageResult,
    targetDir: string,
    options: { maxSize?: number; timeoutMs?: number } = {},
): Promise<DownloadResult> {
    const maxSize = options.maxSize ?? MAX_FILE_SIZE;
    const timeoutMs = options.timeoutMs ?? DOWNLOAD_TIMEOUT;

    // Validate download URL
    if (!result.downloadUrl || !result.downloadUrl.startsWith("https://")) {
        return { ok: false, localPath: null, error: "Invalid or missing download URL (must be HTTPS).", metadata: null };
    }

    if (!isAllowedHost(result.downloadUrl)) {
        return { ok: false, localPath: null, error: `Download host not allowed: ${new URL(result.downloadUrl).hostname}`, metadata: null };
    }

    // Ensure target directory exists and is resolved
    const resolvedDir = resolve(targetDir);
    mkdirSync(resolvedDir, { recursive: true });

    // Generate safe filename
    const filename = safeFilename(result.downloadUrl, `image-${result.id}`);
    const targetPath = join(resolvedDir, filename);

    // Prevent path traversal
    const resolvedPath = resolve(targetPath);
    if (!resolvedPath.startsWith(resolvedDir)) {
        return { ok: false, localPath: null, error: "Path traversal detected in filename.", metadata: null };
    }

    // Avoid overwriting existing files
    if (existsSync(resolvedPath)) {
        return { ok: false, localPath: null, error: `File already exists: ${filename}. Choose a different name.`, metadata: null };
    }

    // Download with timeout
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
        res = await fetch(result.downloadUrl, {
            signal: controller.signal,
            redirect: "follow",
        });
    } catch (err) {
        clearTimeout(timer);
        return { ok: false, localPath: null, error: `Download failed: ${err instanceof Error ? err.message : String(err)}`, metadata: null };
    }
    clearTimeout(timer);

    if (!res.ok) {
        return { ok: false, localPath: null, error: `HTTP ${res.status}: ${res.statusText}`, metadata: null };
    }

    // Validate content type
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
        return { ok: false, localPath: null, error: `Invalid content type: ${contentType} (expected image/*)`, metadata: null };
    }

    // Check content length
    const contentLength = res.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > maxSize) {
        return { ok: false, localPath: null, error: `File too large: ${contentLength} bytes (max ${maxSize})`, metadata: null };
    }

    // Read body with size limit
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > maxSize) {
        return { ok: false, localPath: null, error: `File too large: ${buffer.byteLength} bytes (max ${maxSize})`, metadata: null };
    }

    // Write to disk
    try {
        writeFileSync(resolvedPath, Buffer.from(buffer));
    } catch (err) {
        return { ok: false, localPath: null, error: `Failed to write file: ${err instanceof Error ? err.message : String(err)}`, metadata: null };
    }

    return {
        ok: true,
        localPath: resolvedPath,
        error: null,
        metadata: {
            sourceUrl: result.sourceUrl,
            photographer: result.photographer,
            attribution: result.attribution,
            license: result.license,
        },
    };
}