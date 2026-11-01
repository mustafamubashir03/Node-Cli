import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveResource, resolveResources } from "./resource-resolver.js";

test("cataloged-only entry (no commit) is not fetched", async () => {
    const r = await resolveResource("accessibility");
    assert.equal(r.status, "CATALOGED");
    assert.equal(r.content, null);
    assert.equal(r.delivered, false);
});

test("unknown entry is UNAVAILABLE", async () => {
    const r = await resolveResource("definitely-not-a-skill");
    assert.equal(r.status, "UNAVAILABLE");
});

test("successful fetch returns FETCHED with content and hash", async () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), "rr-"));
    const fakeFetch = async (url: string) => {
        return {
            ok: true,
            status: 200,
            text: async () => "# Hello\nSome content",
        } as any;
    };
    const r = await resolveResource("ui-ux-pro-max", {
        cacheRoot,
        fetchImpl: fakeFetch as any,
    });
    assert.equal(r.status, "FETCHED");
    assert.ok(r.content && r.content.includes("Hello"));
    assert.ok(r.contentHash);
    assert.equal(r.files.length, 1);
    rmSync(cacheRoot, { recursive: true, force: true });
});

test("all 404 yields FAILED", async () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), "rr-"));
    const fakeFetch = async () => ({ ok: false, status: 404, text: async () => "" } as any);
    const r = await resolveResource("ui-ux-pro-max", {
        cacheRoot,
        fetchImpl: fakeFetch as any,
    });
    assert.equal(r.status, "FAILED");
    assert.equal(r.content, null);
    rmSync(cacheRoot, { recursive: true, force: true });
});

test("resolveResources deduplicates ids", async () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), "rr-"));
    const fakeFetch = async () => ({ ok: true, status: 200, text: async () => "x" } as any);
    const results = await resolveResources(["ui-ux-pro-max", "ui-ux-pro-max"], {
        cacheRoot,
        fetchImpl: fakeFetch as any,
    });
    assert.equal(results.length, 1);
    rmSync(cacheRoot, { recursive: true, force: true });
});

test("cache reuse avoids refetch", async () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), "rr-"));
    let calls = 0;
    const fakeFetch = async () => {
        calls++;
        return { ok: true, status: 200, text: async () => "cached content" } as any;
    };
    await resolveResource("ui-ux-pro-max", { cacheRoot, fetchImpl: fakeFetch as any });
    const r2 = await resolveResource("ui-ux-pro-max", { cacheRoot, fetchImpl: fakeFetch as any });
    assert.equal(r2.status, "FETCHED");
    assert.equal(calls, 1, "second call should use cache");
    rmSync(cacheRoot, { recursive: true, force: true });
});

test("network error follows bounded retry then FAILED", async () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), "rr-"));
    let calls = 0;
    const fakeFetch = async () => {
        calls++;
        throw new Error("network down");
    };
    const r = await resolveResource("ui-ux-pro-max", {
        cacheRoot,
        fetchImpl: fakeFetch as any,
        maxRetries: 1,
        timeoutMs: 100,
    });
    assert.equal(r.status, "FAILED");
    assert.ok(r.error && r.error.includes("network down"));
    assert.ok(calls >= 2, "should retry");
    rmSync(cacheRoot, { recursive: true, force: true });
});
