import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { catalog, getSkill, listSkills } from "./catalog.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const builtinDir = join(__dirname, "..", "skills", "builtin");

test("catalog has at least one skill per bundled directory", () => {
    const dirs = readdirSync(builtinDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    for (const dir of dirs) {
        assert.ok(getSkill(dir), `missing catalog entry for ${dir}`);
    }
});

test("every catalog skill has required fields", () => {
    for (const skill of listSkills()) {
        assert.ok(skill.name, "missing name");
        assert.ok(skill.category, "missing category");
        assert.ok(Array.isArray(skill.triggers), "triggers must be array");
        assert.ok(typeof skill.contextTokens === "number", "contextTokens must be number");
        assert.ok(["vendored", "on-demand", "removed"].includes(skill.install), "invalid install");
    }
});

test("catalog version is a number", () => {
    assert.equal(typeof catalog.version, "number");
});