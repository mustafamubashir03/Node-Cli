import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    downloadImage,
    isAllowedHost,
    safeFilename,
} from "./download.js";
import type { ImageResult } from "./types.js";

function makeImageResult(overrides: Partial<ImageResult> = {}): ImageResult {
    return {
        id: "123",
        provider: "pixabay",
        title: "coffee",
        description: "a coffee cup",
        url: "https://pixabay.com/get/preview.jpg",
        downloadUrl: "https://pixabay.com/get/large.jpg",
        width: 1920,
        height: 1080,
        photographer: "Jane",
        photographerUrl: "https://pixabay.com/users/jane-1/",
        sourceUrl: "https://pixabay.com/photos/123/",
        license: "Pixabay License",
        attribution: "Image by Jane from Pixabay",
        tags: ["coffee"],
        ...overrides,
    };
}

test("isAllowedHost allows pixabay.com", () => {
    assert.equal(isAllowedHost("https://pixabay.com/get/image.jpg"), true);
    assert.equal(isAllowedHost("https://cdn.pixabay.com/get/image.jpg"), true);
});

test("isAllowedHost rejects non-HTTPS", () => {
    assert.equal(isAllowedHost("http://pixabay.com/get/image.jpg"), false);
});

test("isAllowedHost rejects unknown hosts", () => {
    assert.equal(isAllowedHost("https://evil.com/image.jpg"), false);
    assert.equal(isAllowedHost("https://example.com/image.jpg"), false);
});

test("isAllowedHost rejects invalid URLs", () => {
    assert.equal(isAllowedHost("not-a-url"), false);
    assert.equal(isAllowedHost(""), false);
});

test("safeFilename generates safe name from URL", () => {
    const name = safeFilename("https://pixabay.com/get/image.jpg");
    assert.match(name, /image\.jpg/);
});

test("safeFilename handles missing extension", () => {
    const name = safeFilename("https://pixabay.com/get/image");
    assert.match(name, /\.jpg$/);
});

test("safeFilename rejects path traversal", () => {
    const name = safeFilename("https://pixabay.com/get/../../etc/passwd");
    assert.doesNotMatch(name, /\.\./);
});

test("safeFilename handles invalid URL", () => {
    const name = safeFilename("not-a-url");
    assert.match(name, /\.jpg$/);
});

test("downloadImage succeeds with valid response", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dl-test-"));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Map([["content-type", "image/jpeg"], ["content-length", "100"]]),
        arrayBuffer: async () => new ArrayBuffer(100),
    })) as any;
    try {
        const result = await downloadImage(makeImageResult(), dir);
        assert.equal(result.ok, true);
        assert.ok(result.localPath);
        assert.ok(result.localPath!.startsWith(dir));
        assert.ok(existsSync(result.localPath!));
        assert.equal(result.metadata?.photographer, "Jane");
        assert.equal(result.metadata?.attribution, "Image by Jane from Pixabay");
    } finally {
        globalThis.fetch = originalFetch;
        rmSync(dir, { recursive: true, force: true });
    }
});

test("downloadImage rejects invalid URL", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dl-test-"));
    try {
        const result = await downloadImage(makeImageResult({ downloadUrl: "http://evil.com/image.jpg" }), dir);
        assert.equal(result.ok, false);
        assert.ok(result.error);
        assert.match(result.error!, /Invalid or missing download URL|Download host not allowed/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("downloadImage rejects disallowed host", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dl-test-"));
    try {
        const result = await downloadImage(makeImageResult({ downloadUrl: "https://evil.com/image.jpg" }), dir);
        assert.equal(result.ok, false);
        assert.ok(result.error);
        assert.match(result.error!, /not allowed/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("downloadImage handles HTTP error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dl-test-"));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
        ok: false,
        status: 404,
        statusText: "Not Found",
        headers: new Map(),
    })) as any;
    try {
        const result = await downloadImage(makeImageResult(), dir);
        assert.equal(result.ok, false);
        assert.match(result.error!, /404/);
    } finally {
        globalThis.fetch = originalFetch;
        rmSync(dir, { recursive: true, force: true });
    }
});

test("downloadImage rejects invalid content type", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dl-test-"));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Map([["content-type", "text/html"], ["content-length", "100"]]),
        arrayBuffer: async () => new ArrayBuffer(100),
    })) as any;
    try {
        const result = await downloadImage(makeImageResult(), dir);
        assert.equal(result.ok, false);
        assert.match(result.error!, /Invalid content type/);
    } finally {
        globalThis.fetch = originalFetch;
        rmSync(dir, { recursive: true, force: true });
    }
});

test("downloadImage rejects oversized response", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dl-test-"));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Map([["content-type", "image/jpeg"], ["content-length", "20000000"]]),
        arrayBuffer: async () => new ArrayBuffer(20000000),
    })) as any;
    try {
        const result = await downloadImage(makeImageResult(), dir, { maxSize: 1000 });
        assert.equal(result.ok, false);
        assert.match(result.error!, /too large/i);
    } finally {
        globalThis.fetch = originalFetch;
        rmSync(dir, { recursive: true, force: true });
    }
});

test("downloadImage avoids overwriting existing files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dl-test-"));
    const filename = safeFilename("https://pixabay.com/get/large.jpg", "image-123");
    writeFileSync(join(dir, filename), "existing");
    try {
        const result = await downloadImage(makeImageResult(), dir);
        assert.equal(result.ok, false);
        assert.match(result.error!, /already exists/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("downloadImage handles timeout", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dl-test-"));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, opts: any) => {
        return new Promise((_resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("aborted")), 100);
            if (opts?.signal) {
                opts.signal.addEventListener("abort", () => {
                    clearTimeout(timer);
                    reject(new DOMException("Aborted", "AbortError"));
                });
            }
        });
    }) as any;
    try {
        const result = await downloadImage(makeImageResult(), dir, { timeoutMs: 50 });
        assert.equal(result.ok, false);
        assert.ok(result.error);
    } finally {
        globalThis.fetch = originalFetch;
        rmSync(dir, { recursive: true, force: true });
    }
});

test("downloadImage preserves attribution metadata", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dl-test-"));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Map([["content-type", "image/jpeg"]]),
        arrayBuffer: async () => new ArrayBuffer(50),
    })) as any;
    try {
        const result = await downloadImage(makeImageResult({
            sourceUrl: "https://pixabay.com/photos/123/",
            photographer: "TestPhotographer",
            attribution: "Image by TestPhotographer from Pixabay",
            license: "Pixabay License",
        }), dir);
        assert.equal(result.ok, true);
        assert.equal(result.metadata?.sourceUrl, "https://pixabay.com/photos/123/");
        assert.equal(result.metadata?.photographer, "TestPhotographer");
        assert.equal(result.metadata?.attribution, "Image by TestPhotographer from Pixabay");
        assert.equal(result.metadata?.license, "Pixabay License");
    } finally {
        globalThis.fetch = originalFetch;
        rmSync(dir, { recursive: true, force: true });
    }
});

test("downloadImage returns error for missing downloadUrl", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dl-test-"));
    try {
        const result = await downloadImage(makeImageResult({ downloadUrl: "" }), dir);
        assert.equal(result.ok, false);
        assert.match(result.error!, /Invalid or missing download URL/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});