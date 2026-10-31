import { test } from "node:test";
import assert from "node:assert/strict";
import { setActiveMode } from "../agent/active-mode.js";
import { createUseSkillTool, activateSkill, skillEnabledError } from "./use-skill.js";

test("createUseSkillTool denies missing skillId", async () => {
    const canUse = createUseSkillTool();
    const res = await canUse("UseSkill", {}) as any;
    assert.equal(res.behavior, "deny");
});

test("createUseSkillTool allows installed skill", async () => {
    setActiveMode("agent");
    const canUse = createUseSkillTool();
    const pending = canUse("UseSkill", { skillId: "accessibility" });
    process.stdin.emit("data", Buffer.from("y\n"));
    const res = await pending as any;
    assert.equal(res.behavior, "allow");
});

test("createUseSkillTool passes through unrelated tools", async () => {
    const canUse = createUseSkillTool();
    const res = await canUse("Read", { file_path: "x" }) as any;
    assert.equal(res.behavior, "allow");
});

test("activateSkill returns body for installed skill", () => {
    const result = activateSkill("accessibility");
    assert.equal(result.ok, true);
    assert.ok(result.body && result.body.length > 0);
});

test("activateSkill fails for missing skill", () => {
    const result = activateSkill("definitely-missing");
    assert.equal(result.ok, false);
    assert.equal(result.body, null);
});

test("activateSkill rejects an unverified skill even if a source file exists", () => {
    // The regression: activating based on file presence alone exposed skills
    // that the release build deliberately excludes.
    const result = activateSkill("web-quality-audit");
    assert.equal(result.ok, false);
    assert.equal(result.body, null);
    assert.match(result.message, /not verified|excluded from the build/);
    assert.match(result.message, /Do not retry/);
});

test("a session cannot activate a skill that is installed but not enabled", () => {
    assert.equal(skillEnabledError("accessibility", ["accessibility"]), null);
    assert.equal(skillEnabledError("accessibility", undefined), null);

    const error = skillEnabledError("performance", ["accessibility"]);
    assert.ok(error);
    assert.match(error, /not enabled/);
    assert.match(error, /\/skills/);
});

test("createUseSkillTool denies an unverified skill without asking the user", async () => {
    setActiveMode("agent");
    const canUse = createUseSkillTool();
    const res = (await canUse("UseSkill", { skillId: "performance" })) as any;
    assert.equal(res.behavior, "deny");
    assert.match(res.message, /not verified|excluded from the build/);
});