import { test } from "node:test";
import assert from "node:assert/strict";
import { catalog } from "../config/catalog.js";
import {
    SkillRouter,
    detectFileTypes,
    formatSkillShortlist,
    matchesTrigger,
} from "./router.js";
import { availableSkillIds, getSkillInfo, routingCatalog, availableEnabledSkills } from "./registry.js";

function createRouter(enabledSkills: string[] = [], options: { maxActive?: number; tokenBudget?: number; debug?: boolean } = {}) {
    return new SkillRouter(catalog, { ...options, enabledSkills });
}

test("router returns empty when no skills are enabled", () => {
    const router = createRouter([]);
    const result = router.route("any prompt", { mode: "agent" });
    assert.deepEqual(result.active, []);
    assert.equal(result.scores.length, 0);
    assert.equal(result.budget.used, 0);
    assert.equal(result.budget.limit, 6000);
    assert.equal(result.budget.over, false);
});

test("only enabled skills are considered", () => {
    const router = createRouter(["accessibility"]);
    const result = router.route("I need accessibility help", { mode: "agent" });
    assert.ok(result.active.includes("accessibility"));
    for (const s of result.scores) {
        assert.ok(s.id === "accessibility", "Unexpected skill in results: " + s.id);
    }
});

test("mode penalties reduce scores in ask mode", () => {
    const router = createRouter(["postgres-best-practices"]);
    const result = router.route("postgres schema design", { mode: "ask" });
    const postgresScore = result.scores.find(s => s.id === "postgres-best-practices");
    assert.ok(postgresScore, "postgres-best-practices should appear");
    assert.ok(postgresScore!.score < 4, "Expected score < 4, got " + postgresScore!.score);
    assert.ok(postgresScore!.score >= 1, "Expected score >= 1, got " + postgresScore!.score);
});

test("maxActive limits the number of selected skills", () => {
    const router = createRouter(["performance", "accessibility"], { maxActive: 1 });
    const result = router.route("I need to fix performance and accessibility", { mode: "agent" });
    assert.ok(result.active.length <= 1, `Expected <= 1 active skill, got ${result.active.length}: ${result.active.join(", ")}`);
});

test("token budget limits the number of selected skills", () => {
    const router = createRouter(["performance", "accessibility"], { maxActive: 10, tokenBudget: 100 });
    const result = router.route("I need to fix performance and accessibility", { mode: "agent" });
    assert.ok(result.active.length === 1, `Expected 1 skill, got ${result.active.length}: ${result.active.join(", ")}`);
    assert.ok(result.budget.used === 900, `Expected usedTokens = 900 (accessibility cost), got ${result.budget.used}`);
    assert.ok(result.budget.over === true, "Budget should be over 100, got " + result.budget.used);
});

test("conflict groups limit to one selection", () => {
    const router = createRouter(["frontend-design", "impeccable"]);
    const result = router.route("I need a visual design review", { mode: "agent" });
    const frontendSelected = result.active.includes("frontend-design");
    const impeccableSelected = result.active.includes("impeccable");
    const count = (frontendSelected ? 1 : 0) + (impeccableSelected ? 1 : 0);
    assert.ok(count === 1, `Exactly one of the conflicting modes should be selected, got ${count}: ${result.active.join(", ")}`);
});

test("file types affect scoring", () => {
    const router = createRouter(["vercel-composition-patterns", "react-best-practices"]);
    const result = router.route("I need to create a React component", { mode: "agent", fileTypes: [".tsx"] });
    const hasReact = result.active.includes("vercel-composition-patterns") || result.active.includes("react-best-practices");
    assert.ok(hasReact, "At least one React-related skill should be selected with .tsx file type, got: " + result.active.join(", "));
});

test("unknown mode defaults to no penalty", () => {
    const router = createRouter(["postgres-best-practices"]);
    const result = router.route("postgres schema design", { mode: "agent" });
    const postgresScore = result.scores.find(s => s.id === "postgres-best-practices");
    assert.ok(postgresScore);
    assert.ok(postgresScore.score >= 4, "Expected score >= 4, got " + postgresScore.score);
});

test("empty prompt returns no matches", () => {
    const router = createRouter(["accessibility"]);
    const result = router.route("", { mode: "agent" });
    assert.equal(result.scores.length, 0);
    assert.equal(result.active.length, 0);
});

test("router handles empty enabled skills gracefully", () => {
    const router = createRouter([]);
    const result = router.route("anything at all", { mode: "agent" });
    assert.deepEqual(result.active, []);
    assert.equal(result.scores.length, 0);
});

test("representative SaaS landing page activates design skills", () => {
    const router = createRouter(["frontend-design", "accessibility", "postgres-best-practices"]);
    const result = router.route("Build a polished animated SaaS landing page", { mode: "agent" });
    assert.ok(result.active.includes("frontend-design"), "frontend-design should activate");
    assert.ok(!result.active.includes("postgres-best-practices"), "postgres should not activate for landing page");
});

test("simple API bug fix does not activate design skills", () => {
    const router = createRouter(["frontend-design", "accessibility", "postgres-best-practices"]);
    const result = router.route("Fix null pointer in user API endpoint", { mode: "agent" });
    assert.ok(!result.active.includes("frontend-design"), "frontend-design should not activate");
});

test("React performance request activates react-performance", () => {
    const router = createRouter(["react-performance", "frontend-design"]);
    const result = router.route("Optimize unnecessary rerenders in React list", { mode: "agent" });
    assert.ok(result.active.includes("react-performance"), "react-performance should activate");
});

test("SEO metadata request activates seo-metadata", () => {
    const router = createRouter(["seo-metadata", "frontend-design"]);
    const result = router.route("Add canonical and Open Graph metadata", { mode: "agent" });
    assert.ok(result.active.includes("seo-metadata"), "seo-metadata should activate");
});

test("short triggers match on word boundaries, not substrings", () => {
    const router = createRouter(["verification-before-completion", "frontend-design"]);
    const result = router.route("Build a premium landing page", { mode: "agent" });
    assert.ok(
        !result.active.includes("verification-before-completion"),
        "the PR trigger must not match inside 'premium'",
    );
    assert.ok(result.active.includes("frontend-design"));
});

test("a real PR mention still matches the verification skill", () => {
    const router = createRouter(["verification-before-completion"]);
    const result = router.route("Open a PR and verify the evidence", { mode: "agent" });
    assert.ok(result.active.includes("verification-before-completion"));
});

test("triggers allow simple plurals", () => {
    assert.equal(matchesTrigger("optimize the rerenders", "rerender"), true);
    assert.equal(matchesTrigger("motion design", "motion"), true);
});

test("the availability gate excludes unverified skills", () => {
    const router = new SkillRouter(catalog, {
        enabledSkills: ["performance", "accessibility"],
        isAvailable: (id) => id !== "performance",
    });
    const result = router.route("improve performance and accessibility", { mode: "agent" });
    assert.ok(!result.scores.some((score) => score.id === "performance"));
    assert.ok(result.active.includes("accessibility"));
});

test("routing only ever sees verified available skills", () => {
    const router = new SkillRouter(routingCatalog(), {
        enabledSkills: availableSkillIds(),
        maxActive: 3,
    });
    const result = router.route(
        "Build a polished responsive landing page with HTML and CSS",
        { mode: "agent", fileTypes: [".html", ".css"] },
    );

    assert.ok(result.active.length > 0);
    for (const id of result.active) {
        assert.equal(getSkillInfo(id).availability, "available", id);
    }
    assert.ok(result.active.includes("frontend-design"), result.active.join(", "));
    assert.ok(!result.active.includes("performance"));
    assert.ok(!result.active.includes("verification-before-completion"));
});

test("formatSkillShortlist is null when nothing matches and names selected skills", () => {
    assert.equal(formatSkillShortlist({ active: [], scores: [], budget: { used: 0, limit: 3000, over: false } }), null);

    const router = createRouter(["frontend-design"]);
    const result = router.route("Build a distinctive landing page", { mode: "agent" });
    const hint = formatSkillShortlist(result);
    assert.ok(hint);
    assert.match(hint, /frontend-design/);
});

test("detectFileTypes finds mentioned file extensions", () => {
    assert.deepEqual(detectFileTypes("Update index.html and styles.css"), [".css", ".html"]);
    assert.ok(detectFileTypes("Edit package.json").includes("package.json"));
    assert.deepEqual(detectFileTypes("nothing to see"), []);
});

test("a non-design file type does not activate design skills", () => {
    const router = createRouter(["frontend-design", "apple-design", "emil-design-eng"]);
    const result = router.route("Refactor this function", {
        mode: "agent",
        fileTypes: [".tsx"],
    });
    assert.equal(result.active.length, 0, result.active.join(", "));
});test("design improvement request selects frontend-design and baseline-ui, not web-quality-audit", () => {
    const router = createRouter(["frontend-design", "baseline-ui", "web-quality-audit", "accessibility", "postgres-best-practices", "mcp-builder"]);
    const result = router.route("improve the existing design to next level", { mode: "agent", fileTypes: [".css", ".html"] });
    assert.ok(result.active.includes("frontend-design"), "frontend-design should be selected: " + result.active.join(", "));
    assert.ok(!result.active.includes("web-quality-audit"), "web-quality-audit must never be selected: " + result.active.join(", "));
    assert.ok(!result.active.includes("postgres-best-practices"), "postgres skill unrelated: " + result.active.join(", "));
    assert.ok(!result.active.includes("mcp-builder"), "mcp-builder unrelated: " + result.active.join(", "));
});

test("design improvement does not select all frontend skills indiscriminately", () => {
    const router = createRouter(["frontend-design", "baseline-ui", "accessibility", "emil-design-eng", "core-web-vitals"]);
    const result = router.route("improve the existing design to next level", { mode: "agent", fileTypes: [".css"] });
    // Should not select everything; maxActive caps at 3 by default.
    assert.ok(result.active.length <= 3, "too many skills selected: " + result.active.join(", "));
    assert.ok(!result.active.includes("core-web-vitals"), "core-web-vitals unrelated to pure design improvement: " + result.active.join(", "));
});

test("API development selects backend skills, not design skills", () => {
    const router = createRouter(["postgres-best-practices", "mcp-builder", "frontend-design", "baseline-ui"]);
    const result = router.route("build a REST API endpoint for user authentication with postgres", { mode: "agent", fileTypes: [".ts"] });
    assert.ok(result.active.includes("postgres-best-practices"), "postgres should be selected: " + result.active.join(", "));
    assert.ok(!result.active.includes("frontend-design"), "frontend-design unrelated to API work: " + result.active.join(", "));
    assert.ok(!result.active.includes("baseline-ui"), "baseline-ui unrelated to API work: " + result.active.join(", "));
});

test("debugging selects debugging skills, not design skills", () => {
    const router = createRouter(["systematic-debugging", "test-driven-development", "frontend-design", "baseline-ui"]);
    const result = router.route("debug why the login flow crashes on submit", { mode: "agent", fileTypes: [".ts"] });
    assert.ok(result.active.includes("systematic-debugging"), "systematic-debugging should be selected: " + result.active.join(", "));
    assert.ok(!result.active.includes("frontend-design"), "frontend-design unrelated to debugging: " + result.active.join(", "));
});

test("accessibility fixes select accessibility skill", () => {
    const router = createRouter(["accessibility", "frontend-design", "baseline-ui"]);
    const result = router.route("fix accessibility issues: keyboard navigation and aria labels", { mode: "agent", fileTypes: [".tsx"] });
    assert.ok(result.active.includes("accessibility"), "accessibility should be selected: " + result.active.join(", "));
});

test("animation work selects motion skills", () => {
    const router = createRouter(["emil-design-eng", "improve-animations", "frontend-design", "baseline-ui"]);
    const result = router.route("add spring animation to the modal dialog", { mode: "agent", fileTypes: [".tsx", ".css"] });
    assert.ok(result.active.includes("emil-design-eng") || result.active.includes("improve-animations"), "motion skill should be selected: " + result.active.join(", "));
});

test("unavailable skill ids are filtered by routingCatalog", () => {
    const rc = routingCatalog();
    assert.equal(rc.skills["web-quality-audit"], undefined, "web-quality-audit must not be in routing catalog");
    assert.ok(rc.skills["frontend-design"], "frontend-design must be in routing catalog");
});

test("invalid model-returned skill ids are ignored by availableEnabledSkills", () => {
    const enabled = availableEnabledSkills(["frontend-design", "web-quality-audit", "nonexistent-skill", "frontend-design"]);
    assert.deepEqual(enabled, ["frontend-design"]);
});

test("an MCP authoring request does not also select postgres-best-practices", () => {
    const router = createRouter(["postgres-best-practices", "mcp-builder"]);
    const result = router.route("Build an MCP server with FastMCP and a tool definition", {
        mode: "agent",
    });
    assert.ok(result.active.includes("mcp-builder"), result.active.join(", "));
    assert.ok(
        !result.active.includes("postgres-best-practices"),
        "generic 'server' must not boost the database skill: " + result.active.join(", "),
    );
});

test("a security audit that mentions API does not select postgres-best-practices", () => {
    const router = createRouter(["best-practices", "postgres-best-practices"]);
    const result = router.route("Run a security audit for CSP, HSTS, and deprecated API usage", {
        mode: "agent",
    });
    assert.ok(result.active.includes("best-practices"), result.active.join(", "));
    assert.ok(
        !result.active.includes("postgres-best-practices"),
        "generic 'API' must not boost the database skill: " + result.active.join(", "),
    );
});

test("backend boosts do not match inside unrelated words", () => {
    const router = createRouter(["postgres-best-practices"]);
    const result = router.route("Rapid prototype for the capital city guide", { mode: "agent" });
    assert.equal(result.active.length, 0, result.active.join(", "));
});

test("database vocabulary still boosts postgres-best-practices", () => {
    const router = createRouter(["postgres-best-practices"]);
    const result = router.route("Design a database schema for billing", { mode: "agent" });
    assert.ok(result.active.includes("postgres-best-practices"), result.active.join(", "));
});
