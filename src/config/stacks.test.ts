import { test } from "node:test";
import assert from "node:assert/strict";
import { listStacks, getStack, isLanguageSupported, createFirstPartyTemplate } from "./stacks.js";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("stack registry has unique ids", () => {
    const ids = listStacks().map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
});

test("every stack supports at least one language", () => {
    for (const s of listStacks()) {
        assert.ok(s.languages.length > 0, `${s.id} has no languages`);
    }
});

test("getStack returns undefined for unknown id", () => {
    assert.equal(getStack("nope-stack"), undefined);
});

test("isLanguageSupported reflects languages", () => {
    const s = getStack("react-vite")!;
    assert.equal(isLanguageSupported(s, "ts"), true);
    assert.equal(isLanguageSupported(s, "js"), true);
});

test("express-api first-party template creates runnable files", () => {
    const dir = mkdtempSync(join(tmpdir(), "stack-"));
    try {
        const ok = createFirstPartyTemplate("express-api", "ts", dir);
        assert.equal(ok, true);
        assert.ok(existsSync(join(dir, "package.json")));
        assert.ok(existsSync(join(dir, "src", "index.ts")));
        assert.ok(existsSync(join(dir, "tsconfig.json")));
        const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        assert.ok(pkg.scripts?.dev);
        assert.ok(pkg.scripts?.start);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("unknown stack template returns false", () => {
    const dir = mkdtempSync(join(tmpdir(), "stack-"));
    try {
        assert.equal(createFirstPartyTemplate("nope", "ts", dir), false);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("react-vite declares only checks that its scaffold provides", () => {
    const stack = getStack("react-vite")!;
    assert.deepEqual(stack.verify, ["build"]);
    assert.ok(!stack.verify.includes("typecheck"));
});

test("the first-party TypeScript templates declare only scripts they provide", () => {
    for (const stackId of ["express-api", "mern"] as const) {
        const dir = mkdtempSync(join(tmpdir(), "stack-"));
        try {
            const ok = createFirstPartyTemplate(stackId, "ts", dir);
            assert.equal(ok, true, stackId);

            const scripts = [dir, join(dir, "client"), join(dir, "server")]
                .map((packageDir) => {
                    try {
                        return JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")).scripts ?? {};
                    } catch {
                        return {};
                    }
                });
            for (const concept of getStack(stackId)!.verify) {
                assert.ok(
                    scripts.some((entry) => typeof entry[concept] === "string"),
                    `${stackId} declares '${concept}' but no package provides it`,
                );
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }
});

test("the JavaScript template does not claim a typecheck script it cannot run", () => {
    const dir = mkdtempSync(join(tmpdir(), "stack-"));
    try {
        const ok = createFirstPartyTemplate("express-api", "js", dir);
        assert.equal(ok, true);
        const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        assert.equal(pkg.scripts?.typecheck, undefined);
        // The verifier reports the missing concept as skipped, not as a pass.
        assert.ok(getStack("express-api")!.verify.includes("typecheck"));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
