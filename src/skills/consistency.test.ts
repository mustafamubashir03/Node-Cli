import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { catalog, getSkill } from "../config/catalog.js";
import { getSkillInfo, isSkillAvailable, listSkillInfos } from "./registry.js";
import { isValidSkillId } from "./loader.js";
import { getSkillReleaseStatus } from "./loader.js";
import { activateSkill } from "./use-skill.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const builtinDir = join(__dirname, "builtin");
const distBuiltinDir = join(__dirname, "..", "..", "dist", "skills", "builtin");

test("every catalog skill id is a valid skill id", () => {
    for (const id of Object.keys(catalog.skills)) {
        assert.ok(isValidSkillId(id), `invalid skill id: ${id}`);
    }
});

test("catalog and builtin directories agree on skill identity", () => {
    const dirs = readdirSync(builtinDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    for (const dir of dirs) {
        assert.ok(getSkill(dir), `builtin directory '${dir}' has no catalog entry`);
    }
});

test("every available skill is activatable", () => {
    for (const info of listSkillInfos()) {
        if (info.availability !== "available") continue;
        const activation = activateSkill(info.id);
        assert.equal(activation.ok, true, `${info.id} should activate`);
        assert.ok(activation.body, `${info.id} should return a body`);
    }
});

test("unavailable skills cannot be activated", () => {
    for (const info of listSkillInfos()) {
        if (info.availability === "available") continue;
        const activation = activateSkill(info.id);
        assert.equal(activation.ok, false, `${info.id} should not activate`);
        assert.equal(activation.body, null);
    }
});

test("available skill ids match registry availability", () => {
    const available = listSkillInfos()
        .filter((i) => i.availability === "available")
        .map((i) => i.id)
        .sort();
    // Every available id must be activatable per getSkillInfo
    for (const id of available) {
        assert.equal(isSkillAvailable(id), true, `${id} should be available`);
    }
});

test("release build (if present) contains only verified skills", () => {
    if (!existsSync(distBuiltinDir)) return;
    const dirs = readdirSync(distBuiltinDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    for (const dir of dirs) {
        const status = getSkillReleaseStatus(dir);
        assert.equal(status, "verified", `dist contains unverified skill: ${dir}`);
        assert.ok(getSkill(dir), `dist skill '${dir}' has no catalog entry`);
    }
});

test("lock file skill ids are valid", () => {
    const lockPath = join(__dirname, "..", "config", "skills.lock.json");
    if (!existsSync(lockPath)) return;
    const lock = JSON.parse(readFileSync(lockPath, "utf8")) as { skills?: Record<string, unknown> };
    for (const id of Object.keys(lock.skills ?? {})) {
        assert.ok(isValidSkillId(id), `invalid lock skill id: ${id}`);
    }
});
