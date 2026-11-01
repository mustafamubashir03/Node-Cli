import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getSkillReleaseStatus, isSkillDistributable } from "./loader.js";
import lock from "../config/skills.lock.json" with { type: "json" };

const __dirname = dirname(fileURLToPath(import.meta.url));

test("verified skills are distributable", () => {
    const manifest = lock as any;
    for (const [id, meta] of Object.entries(manifest.skills || {})) {
        if ((meta as any).commitSha) {
            assert.equal(isSkillDistributable(id), true, id);
            assert.equal(getSkillReleaseStatus(id), "verified", id);
        } else {
            assert.equal(isSkillDistributable(id), false, id);
            assert.equal(getSkillReleaseStatus(id), "unverified", id);
        }
    }
});

test("release build excludes unverified skills when present", () => {
    const distBuiltin = join(__dirname, "..", "..", "dist", "skills", "builtin");
    if (!existsSync(distBuiltin)) return;
    const shipped = new Set(readdirSync(distBuiltin));
    const manifest = lock as any;
    for (const [id, meta] of Object.entries(manifest.skills || {})) {
        if (!(meta as any).commitSha) {
            assert.equal(shipped.has(id), false, `${id} should not ship`);
        }
    }
});