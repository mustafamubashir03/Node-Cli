import { test } from "node:test";
import assert from "node:assert/strict";
import { SkillRouter } from "./router.js";
import { routingCatalog, availableEnabledSkills } from "./registry.js";

function routerFor(enabled: string[]) {
    return new SkillRouter(routingCatalog(), {
        enabledSkills: availableEnabledSkills(enabled),
        maxActive: 3,
        tokenBudget: 4000,
    });
}

test("evaluation: existing design improvement selects frontend-design, not web-quality-audit", () => {
    const router = routerFor(["frontend-design", "baseline-ui", "web-quality-audit", "accessibility", "emil-design-eng"]);
    const result = router.route("improve the existing design to next level", { mode: "agent", fileTypes: [".html", ".css", ".js"] });
    assert.ok(result.active.includes("frontend-design"), "primary design skill missing: " + result.active.join(", "));
    assert.ok(!result.active.includes("web-quality-audit"), "unavailable skill selected: " + result.active.join(", "));
    assert.ok(!result.active.includes("postgres-best-practices"), "unrelated backend skill selected");
});

test("evaluation: new frontend from brief selects design skills", () => {
    const router = routerFor(["frontend-design", "baseline-ui", "accessibility"]);
    const result = router.route("build a landing page for a SaaS product with hero and pricing", { mode: "agent", fileTypes: [".html", ".css"] });
    assert.ok(result.active.includes("frontend-design"), "frontend-design missing: " + result.active.join(", "));
});

test("evaluation: accessibility fix selects accessibility", () => {
    const router = routerFor(["accessibility", "frontend-design", "baseline-ui"]);
    const result = router.route("fix accessibility: keyboard navigation and aria labels", { mode: "agent", fileTypes: [".tsx"] });
    assert.ok(result.active.includes("accessibility"), "accessibility missing: " + result.active.join(", "));
});

test("evaluation: animation improvement selects motion skill", () => {
    const router = routerFor(["emil-design-eng", "improve-animations", "frontend-design"]);
    const result = router.route("improve the modal animation easing and spring", { mode: "agent", fileTypes: [".tsx", ".css"] });
    assert.ok(
        result.active.includes("emil-design-eng") || result.active.includes("improve-animations"),
        "motion skill missing: " + result.active.join(", "),
    );
});

test("evaluation: backend API selects backend skill, not design", () => {
    const router = routerFor(["postgres-best-practices", "mcp-builder", "frontend-design", "baseline-ui"]);
    const result = router.route("implement a REST API endpoint for users with postgres", { mode: "agent", fileTypes: [".ts"] });
    assert.ok(result.active.includes("postgres-best-practices"), "postgres missing: " + result.active.join(", "));
    assert.ok(!result.active.includes("frontend-design"), "design skill wrongly selected for API: " + result.active.join(", "));
});

test("evaluation: debugging selects debugging skill, not design", () => {
    const router = routerFor(["systematic-debugging", "test-driven-development", "frontend-design"]);
    const result = router.route("debug why the form submission crashes", { mode: "agent", fileTypes: [".ts"] });
    assert.ok(result.active.includes("systematic-debugging"), "debugging missing: " + result.active.join(", "));
    assert.ok(!result.active.includes("frontend-design"), "design skill wrongly selected for debug: " + result.active.join(", "));
});

test("evaluation: instruction delivery — enabled skill appears in routing catalog", () => {
    const rc = routingCatalog();
    assert.ok(rc.skills["frontend-design"], "frontend-design must be deliverable");
    assert.ok(!rc.skills["web-quality-audit"], "web-quality-audit must not be deliverable");
});
