import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { USER_SKILLS_ENV } from "./loader.js";
import {
    availableEnabledSkills,
    availableSkillIds,
    getSkillInfo,
    listSkillInfos,
    routingCatalog,
    skillIndex,
} from "./registry.js";

function withUserSkills(run: (root: string) => void): void {
    const root = mkdtempSync(join(tmpdir(), "node-cli-skills-"));
    const previous = process.env[USER_SKILLS_ENV];
    process.env[USER_SKILLS_ENV] = root;
    try {
        run(root);
    } finally {
        if (previous === undefined) delete process.env[USER_SKILLS_ENV];
        else process.env[USER_SKILLS_ENV] = previous;
        rmSync(root, { recursive: true, force: true });
    }
}

function writeSkill(root: string, id: string, content: string): void {
    const dir = join(root, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), content);
}

test("a verified bundled skill is available", () => {
    const info = getSkillInfo("accessibility");
    assert.equal(info.availability, "available");
    assert.equal(info.source, "builtin");
    assert.ok(info.path?.endsWith("SKILL.md"));
    assert.match(info.description, /Accessibility/);
});

test("an unverified skill is rejected even when its source file exists", () => {
    // This is the exact class of failure users hit: the file is present in the
    // source tree, but the release build intentionally excludes it.
    const info = getSkillInfo("web-quality-audit");
    assert.equal(info.availability, "unverified");
    assert.equal(info.source, "none");
    assert.match(info.reason ?? "", /not verified|excluded from the build/);
    assert.ok(!availableSkillIds().includes("web-quality-audit"));
});

test("performance and react-best-practices are not advertised as available", () => {
    for (const id of ["performance", "react-best-practices", "hallmark", "figma-implement-design"]) {
        assert.notEqual(getSkillInfo(id).availability, "available", id);
    }
});

test("an on-demand catalog skill is reported as installable, not available", () => {
    const info = getSkillInfo("database");
    assert.equal(info.availability, "missing");
    assert.match(info.reason ?? "", /skills fetch database|on demand/);
});

test("a removed catalog skill is rejected", () => {
    const info = getSkillInfo("ui-skills");
    assert.equal(info.availability, "unknown");
    assert.match(info.reason ?? "", /removed/);
});

test("an unknown skill explains where to install it", () => {
    const info = getSkillInfo("my-unlisted-skill");
    assert.equal(info.availability, "unknown");
    assert.match(info.reason ?? "", /not in the catalog/);
});

test("path traversal in a skill id is rejected", () => {
    for (const id of ["../accessibility", "..\\accessibility", "", "a/b"]) {
        assert.equal(getSkillInfo(id).availability, "unknown", id);
    }
});

test("a user-installed skill is available and uses its frontmatter", () => {
    withUserSkills((root) => {
        writeSkill(
            root,
            "my-landing-kit",
            [
                "---",
                "name: Landing Kit",
                'triggers: ["hero section", "landing kit"]',
                "contextTokens: 450",
                "---",
                "",
                "# Landing Kit",
                "",
                "Opinionated landing page structure.",
            ].join("\n"),
        );

        const info = getSkillInfo("my-landing-kit");
        assert.equal(info.availability, "available");
        assert.equal(info.source, "user");
        assert.equal(info.name, "Landing Kit");
        assert.equal(info.description, "Landing Kit");
        assert.deepEqual(info.triggers, ["hero section", "landing kit"]);
        assert.equal(info.contextTokens, 450);
    });
});

test("a user install overrides an unverified catalog id", () => {
    withUserSkills((root) => {
        writeSkill(root, "web-quality-audit", "# My audit\n\nLocal copy I chose to install.");

        const info = getSkillInfo("web-quality-audit");
        assert.equal(info.availability, "available");
        assert.equal(info.source, "user");
    });
});

test("an empty SKILL.md is not treated as an installed skill", () => {
    withUserSkills((root) => {
        writeSkill(root, "empty-skill", "   \n");
        assert.equal(getSkillInfo("empty-skill").availability, "unknown");
    });
});

test("routingCatalog contains only usable skills and includes user skills", () => {
    withUserSkills((root) => {
        writeSkill(root, "my-landing-kit", "# Landing Kit\n\nOpinionated landing structure.");

        const view = routingCatalog();
        assert.ok(view.skills["accessibility"], "verified builtin skill missing");
        assert.ok(view.skills["my-landing-kit"], "user skill missing");
        assert.equal(view.skills["performance"], undefined, "unverified skill must not be routable");
        assert.equal(view.skills["database"], undefined, "uninstalled on-demand skill must not be routable");
        assert.ok(view.categories.custom, "custom category missing");
    });
});

test("availableEnabledSkills drops stale and unverified config ids", () => {
    assert.deepEqual(
        availableEnabledSkills([
            "accessibility",
            "performance",
            "web-quality-audit",
            "does-not-exist",
            "accessibility",
        ]),
        ["accessibility"],
    );
});

test("skillIndex returns real descriptions for available skills only", () => {
    const index = skillIndex(["accessibility", "performance", "missing-skill"]);
    assert.equal(index.length, 1);
    assert.equal(index[0].id, "accessibility");
    assert.ok(index[0].description.length > 5);
    assert.notEqual(index[0].description, "accessibility");
});

test("listSkillInfos includes unavailable catalog entries with reasons", () => {
    const infos = listSkillInfos();
    const performance = infos.find((info) => info.id === "performance");
    assert.ok(performance);
    assert.equal(performance.availability, "unverified");
    assert.ok(performance.reason);
});
