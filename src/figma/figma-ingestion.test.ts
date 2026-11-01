import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, opts?: any) => Promise<Response>): void {
    (globalThis as any).fetch = async (url: string, opts?: any) => {
        return handler(String(url), opts);
    };
}

function restoreFetch(): void {
    (globalThis as any).fetch = originalFetch;
}

const FIXTURE_FILE_KEY = "fix-12345";