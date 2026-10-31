import { test } from "node:test";
import assert from "node:assert/strict";
import { initializerFor } from "./scaffold.js";

test("React + Vite uses the detected package manager", () => {
    const pnpm = initializerFor("pnpm", "react-vite", "C:\\work\\app");
    assert.equal(pnpm.command, "pnpm");
    assert.deepEqual(pnpm.args, [
        "dlx",
        "create-vite@latest",
        "C:\\work\\app",
        "--template",
        "react-ts",
    ]);

    const npm = initializerFor("npm", "react-vite", "C:\\work\\app");
    assert.equal(npm.command, "npx");
    assert.deepEqual(npm.args, [
        "--yes",
        "create-vite@latest",
        "C:\\work\\app",
        "--template",
        "react-ts",
    ]);
});

test("SvelteKit uses the current sv CLI instead of svite", () => {
    const initializer = initializerFor("pnpm", "sveltekit", "/tmp/app");
    assert.equal(initializer.command, "pnpm");
    assert.deepEqual(initializer.args, [
        "dlx",
        "sv@latest",
        "create",
        "--template",
        "minimal",
        "--types",
        "ts",
        "--no-add-ons",
        "--no-install",
        "/tmp/app",
    ]);
});

test("Next.js receives its non-interactive flags", () => {
    const initializer = initializerFor("npm", "nextjs", "/tmp/app");
    assert.deepEqual(initializer.args, [
        "--yes",
        "create-next-app@latest",
        "/tmp/app",
        "--typescript",
        "--tailwind",
        "--eslint",
        "--app",
        "--src-dir",
        "--import-alias",
        "@/*",
        "--no-git",
    ]);
});

test("an unsupported framework is rejected", () => {
    assert.throws(() => initializerFor("pnpm", "rails", "/tmp/app"), /Unsupported framework/);
});
