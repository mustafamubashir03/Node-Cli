import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSkillBody, skillFileExists, listInstalledSkills } from "./loader.js";

test("loadSkillBody returns null for unknown skill", () => {
    assert.equal(loadSkillBody("definitely-not-a-skill"), null);
});

test("loadSkillBody loads an installed skill", () => {
    const skill = loadSkillBody("accessibility");
    assert.ok(skill);
    assert.equal(skill.id, "accessibility");
    assert.ok(typeof skill.body === "string");
});

test("skillFileExists reflects installed skills", () => {
    assert.equal(skillFileExists("accessibility"), true);
    assert.equal(skillFileExists("nope-skill"), false);
});

test("listInstalledSkills does not throw on missing root", () => {
    const result = listInstalledSkills();
    assert.ok(Array.isArray(result));
});