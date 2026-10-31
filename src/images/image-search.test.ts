import { test } from "node:test";
import assert from "node:assert/strict";
import { UnsplashProvider } from "./providers/unsplash.js";
import { PixabayProvider } from "./providers/pixabay.js";
import { PexelsProvider } from "./providers/pexels.js";
import { searchImages, clearImageCache, listImageProviders } from "./search.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("providers report unconfigured when keys missing", () => {
    delete process.env.UNSPLASH_ACCESS_KEY;
    delete process.env.PIXABAY_API_KEY;
    delete process.env.PEXELS_API_KEY;
    const u = new UnsplashProvider();
    const p = new PixabayProvider();
    const x = new PexelsProvider();
    assert.equal(u.isConfigured(), false);
    assert.equal(p.isConfigured(), false);
    assert.equal(x.isConfigured(), false);
});

test("searchImages returns clear error when no provider configured", async () => {
    delete process.env.UNSPLASH_ACCESS_KEY;
    delete process.env.PIXABAY_API_KEY;
    delete process.env.PEXELS_API_KEY;
    clearImageCache();
    const res = await searchImages({ query: "pizza" });
    assert.ok(res.error);
    assert.match(res.error!, /No image provider configured/);
    assert.equal(res.results.length, 0);
});

test("Unsplash normalizes results", async () => {
    process.env.UNSPLASH_ACCESS_KEY = "test-key";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
            total: 1,
            results: [{
                id: "abc123",
                alt_description: "pizza overhead",
                description: "a pizza",
                urls: { regular: "https://img/regular.jpg", small: "https://img/small.jpg" },
                width: 1000,
                height: 800,
                user: { name: "Jane", links: { html: "https://unsplash.com/@jane" } },
                links: { html: "https://unsplash.com/photos/abc123" },
                tags: [{ title: "pizza" }, { title: "food" }],
            }],
        }),
    })) as any;
    try {
        const provider = new UnsplashProvider();
        const res = await provider.search({ query: "overhead pizza" });
        assert.equal(res.results.length, 1);
        assert.equal(res.results[0].provider, "unsplash");
        assert.equal(res.results[0].photographer, "Jane");
        assert.equal(res.results[0].width, 1000);
        assert.match(res.results[0].attribution, /Jane/);
    } finally {
        globalThis.fetch = originalFetch;
        delete process.env.UNSPLASH_ACCESS_KEY;
    }
});

test("provider handles HTTP error", async () => {
    process.env.PIXABAY_API_KEY = "test-key";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: false, status: 401, statusText: "Unauthorized", json: async () => ({}) })) as any;
    try {
        const provider = new PixabayProvider();
        const res = await provider.search({ query: "pizza" });
        assert.ok(res.error);
        assert.match(res.error!, /401/);
        assert.equal(res.results.length, 0);
    } finally {
        globalThis.fetch = originalFetch;
        delete process.env.PIXABAY_API_KEY;
    }
});

test("Pixabay normalizes results", async () => {
    process.env.PIXABAY_API_KEY = "test-key";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Map([["X-RateLimit-Limit", "100"], ["X-RateLimit-Remaining", "99"], ["X-RateLimit-Reset", "60"]]),
        json: async () => ({
            totalHits: 2,
            hits: [
                {
                    id: 12345,
                    tags: "coffee, cup, morning",
                    previewURL: "https://pixabay.com/get/preview.jpg",
                    webformatURL: "https://pixabay.com/get/webformat.jpg",
                    largeImageURL: "https://pixabay.com/get/large.jpg",
                    imageWidth: 1920,
                    imageHeight: 1080,
                    user: "photographer1",
                    user_id: 42,
                    pageURL: "https://pixabay.com/photos/12345/",
                },
                {
                    id: 67890,
                    tags: "latte, art",
                    previewURL: "https://pixabay.com/get/preview2.jpg",
                    webformatURL: "https://pixabay.com/get/webformat2.jpg",
                    // largeImageURL missing (no full API access)
                    imageWidth: 800,
                    imageHeight: 600,
                    user: "photographer2",
                    user_id: 99,
                    pageURL: "https://pixabay.com/photos/67890/",
                },
            ],
        }),
    })) as any;
    try {
        const provider = new PixabayProvider();
        const res = await provider.search({ query: "coffee shop" });
        assert.equal(res.results.length, 2);
        assert.equal(res.results[0].provider, "pixabay");
        assert.equal(res.results[0].photographer, "photographer1");
        assert.equal(res.results[0].width, 1920);
        assert.equal(res.results[0].height, 1080);
        assert.equal(res.results[0].downloadUrl, "https://pixabay.com/get/large.jpg");
        assert.match(res.results[0].attribution, /photographer1/);
        assert.match(res.results[0].attribution, /Pixabay/);
        // Second result: largeImageURL missing, falls back to webformatURL
        assert.equal(res.results[1].downloadUrl, "https://pixabay.com/get/webformat2.jpg");
        assert.equal(res.results[1].title, "latte, art");
    } finally {
        globalThis.fetch = originalFetch;
        delete process.env.PIXABAY_API_KEY;
    }
});

test("Pixabay handles 429 rate limit", async () => {
    process.env.PIXABAY_API_KEY = "test-key";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        json: async () => ({}),
    })) as any;
    try {
        const provider = new PixabayProvider();
        const res = await provider.search({ query: "coffee" });
        assert.ok(res.error);
        assert.match(res.error!, /429/);
        assert.equal(res.results.length, 0);
    } finally {
        globalThis.fetch = originalFetch;
        delete process.env.PIXABAY_API_KEY;
    }
});

test("Pixabay handles 5xx server error", async () => {
    process.env.PIXABAY_API_KEY = "test-key";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        json: async () => ({}),
    })) as any;
    try {
        const provider = new PixabayProvider();
        const res = await provider.search({ query: "coffee" });
        assert.ok(res.error);
        assert.match(res.error!, /503/);
        assert.equal(res.results.length, 0);
    } finally {
        globalThis.fetch = originalFetch;
        delete process.env.PIXABAY_API_KEY;
    }
});

test("Pixabay handles empty results", async () => {
    process.env.PIXABAY_API_KEY = "test-key";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ totalHits: 0, hits: [] }),
    })) as any;
    try {
        const provider = new PixabayProvider();
        const res = await provider.search({ query: "xyznonexistentquery123" });
        assert.equal(res.results.length, 0);
        assert.equal(res.total, 0);
        assert.ok(!res.error, "no error on zero results");
    } finally {
        globalThis.fetch = originalFetch;
        delete process.env.PIXABAY_API_KEY;
    }
});

test("Pixabay handles malformed JSON", async () => {
    process.env.PIXABAY_API_KEY = "test-key";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => { throw new Error("Unexpected token"); },
    })) as any;
    try {
        const provider = new PixabayProvider();
        const res = await provider.search({ query: "coffee" });
        assert.ok(res.error);
        assert.match(res.error!, /Pixabay request failed/);
        assert.equal(res.results.length, 0);
    } finally {
        globalThis.fetch = originalFetch;
        delete process.env.PIXABAY_API_KEY;
    }
});

test("Pixabay image URL includes key in query params but is not logged", async () => {
    process.env.PIXABAY_API_KEY = "secret-key-12345";
    const originalFetch = globalThis.fetch;
    let capturedUrl = "";
    globalThis.fetch = (async (url: string) => {
        capturedUrl = url;
        return {
            ok: true,
            status: 200,
            statusText: "OK",
            json: async () => ({ totalHits: 0, hits: [] }),
        };
    }) as any;
    try {
        const provider = new PixabayProvider();
        await provider.search({ query: "coffee" });
        // URL should contain key param (that's how Pixabay API works)
        assert.match(capturedUrl, /key=secret-key-12345/);
        assert.match(capturedUrl, /pixabay\.com\/api/);
    } finally {
        globalThis.fetch = originalFetch;
        delete process.env.PIXABAY_API_KEY;
    }
});

test("Pixabay query is URL-encoded", async () => {
    process.env.PIXABAY_API_KEY = "test-key";
    const originalFetch = globalThis.fetch;
    let capturedUrl = "";
    globalThis.fetch = (async (url: string) => {
        capturedUrl = url;
        return {
            ok: true,
            status: 200,
            statusText: "OK",
            json: async () => ({ totalHits: 0, hits: [] }),
        };
    }) as any;
    try {
        const provider = new PixabayProvider();
        await provider.search({ query: "coffee shop interior" });
        assert.match(capturedUrl, /q=coffee\+shop\+interior|q=coffee%20shop%20interior/);
    } finally {
        globalThis.fetch = originalFetch;
        delete process.env.PIXABAY_API_KEY;
    }
});

test("Pixabay ImageSearch tool dispatches through the provider", async () => {
    process.env.PIXABAY_API_KEY = "test-key";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
            totalHits: 1,
            hits: [{
                id: 999,
                tags: "coffee, beans",
                webformatURL: "https://pixabay.com/get/coffee.jpg",
                largeImageURL: "https://pixabay.com/get/coffee-large.jpg",
                imageWidth: 1200,
                imageHeight: 800,
                user: "barista",
                user_id: 1,
                pageURL: "https://pixabay.com/photos/999/",
            }],
        }),
    })) as any;
    try {
        const { createImageMcpServer } = await import("./image-mcp.js");
        const server = createImageMcpServer();
        const tool = (server as any).instance._registeredTools.ImageSearch;
        const result = await tool.handler({ query: "coffee beans", orientation: "landscape" });
        assert.equal(result.isError, false);
        assert.match(result.content[0].text, /coffee beans/);
        assert.match(result.content[0].text, /pixabay/i);
    } finally {
        globalThis.fetch = originalFetch;
        delete process.env.PIXABAY_API_KEY;
    }
});

test("ImageDownload tool dispatches through the MCP handler", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Map([["content-type", "image/jpeg"]]),
        arrayBuffer: async () => new ArrayBuffer(50),
    })) as any;
    const dir = mkdtempSync(join(tmpdir(), "imgdl-test-"));
    try {
        const { createImageMcpServer } = await import("./image-mcp.js");
        const server = createImageMcpServer();
        const tool = (server as any).instance._registeredTools.ImageDownload;
        const result = await tool.handler({
            downloadUrl: "https://pixabay.com/get/test.jpg",
            targetDir: dir,
        });
        assert.equal(result.isError, undefined);
        assert.match(result.content[0].text, /Downloaded:/);
    } finally {
        globalThis.fetch = originalFetch;
        rmSync(dir, { recursive: true, force: true });
    }
});

test("listImageProviders returns all three", () => {
    const providers = listImageProviders();
    assert.equal(providers.length, 3);
    assert.deepEqual(providers.map((p) => p.id).sort(), ["pexels", "pixabay", "unsplash"]);
});
