import { test } from "node:test";
import assert from "node:assert/strict";
import { availableSkillIds } from "./registry.js";
import {
    DEFAULT_MAX_ACTIVE,
    DEFAULT_SKILL_TOKEN_BUDGET,
    SKILL_SELECTION_VERSION,
    selectSkills,
    type SkillSelection,
} from "./selection.js";

function selection(prompt: string, enabledSkills: string[] = availableSkillIds()): SkillSelection {
    return selectSkills(prompt, { mode: "agent", enabledSkills });
}

test("selectSkills exposes the production defaults", () => {
    assert.equal(SKILL_SELECTION_VERSION, "router-v1");
    assert.equal(DEFAULT_MAX_ACTIVE, 3);
    assert.equal(DEFAULT_SKILL_TOKEN_BUDGET, 6000);
});

test("selectSkills reports candidates, enabled, recommended, and selected separately", () => {
    const result = selection("Build a distinctive landing page", ["frontend-design", "accessibility"]);

    assert.ok(result.candidates.length >= result.enabled.length);
    assert.deepEqual(result.enabled, ["frontend-design", "accessibility"]);
    assert.ok(result.recommended.includes("frontend-design"));
    assert.deepEqual(result.selected, result.recommended);
});

test("selectSkills filters unavailable and duplicate configured skills", () => {
    const result = selection("Build a distinctive landing page", [
        "frontend-design",
        "frontend-design",
        "web-quality-audit",
        "not-a-skill",
    ]);

    assert.deepEqual(result.enabled, ["frontend-design"]);
    assert.ok(!result.selected.includes("web-quality-audit"));
    assert.ok(!result.selected.includes("not-a-skill"));
});

test("selectSkills never selects more than maxActive", () => {
    const result = selectSkills(
        "Improve accessibility, animation, typography, and layout for a landing page",
        { mode: "agent", enabledSkills: availableSkillIds(), maxActive: 2 },
    );
    assert.ok(result.selected.length <= 2, result.selected.join(", "));
});

test("selectSkills is deterministic for the same prompt and settings", () => {
    const first = selection("Optimize unnecessary rerenders in a React list");
    const second = selection("Optimize unnecessary rerenders in a React list");
    assert.deepEqual(first.selected, second.selected);
    assert.deepEqual(first.scores, second.scores);
    assert.deepEqual(first.budget, second.budget);
});

test("selectSkills accepts explicit file types", () => {
    const result = selectSkills("Refactor this function", {
        mode: "agent",
        enabledSkills: ["frontend-design", "apple-design", "emil-design-eng"],
        fileTypes: [".tsx"],
    });
    assert.deepEqual(result.selected, []);
});
