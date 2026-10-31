import { test } from "node:test";
import assert from "node:assert/strict";
import { availableSkillIds } from "../skills/registry.js";
import { parseDataset } from "./dataset.js";
import { bucketize, evaluateCase, evaluateDataset, summarize } from "./evaluate.js";
import type { CaseEvaluation, GoldenCase, LoadedDataset } from "./types.js";

const available = availableSkillIds();

function golden(overrides: Partial<GoldenCase> = {}): GoldenCase {
    return {
        id: "case",
        prompt: "Fix accessibility issues: keyboard navigation and ARIA labels",
        mode: "agent",
        expectedAny: ["accessibility"],
        forbidden: [],
        expectNone: false,
        tags: [],
        ...overrides,
    };
}

function caseEval(overrides: Partial<CaseEvaluation> = {}): CaseEvaluation {
    return {
        id: "case",
        prompt: "prompt",
        mode: "agent",
        tags: [],
        expectedAny: ["accessibility"],
        forbidden: [],
        expectNone: false,
        enabledSkills: available,
        selected: ["accessibility"],
        recommended: ["accessibility"],
        scores: [],
        budget: { used: 900, limit: 3000, over: false },
        hitAt1: true,
        hitAtK: true,
        expectedMatched: ["accessibility"],
        forbiddenSelected: [],
        emptySelection: false,
        selectedTokens: 900,
        passed: true,
        failureReason: null,
        ...overrides,
    };
}

test("evaluateCase marks a correct first choice as a pass and hit@1", () => {
    const result = evaluateCase(golden(), available);
    assert.deepEqual(result.selected, ["accessibility"]);
    assert.equal(result.hitAt1, true);
    assert.equal(result.hitAtK, true);
    assert.equal(result.passed, true);
    assert.equal(result.failureReason, null);
    assert.ok(result.selectedTokens > 0);
});

test("evaluateCase detects forbidden skills before missing expectations", () => {
    const result = evaluateCase(
        golden({
            prompt: "Build a polished, distinctive landing page",
            expectedAny: ["accessibility"],
            forbidden: ["frontend-design"],
        }),
        available,
    );
    assert.equal(result.passed, false);
    assert.deepEqual(result.forbiddenSelected, ["frontend-design"]);
    assert.match(result.failureReason ?? "", /forbidden/i);
});

test("evaluateCase treats hit@K separately from hit@1", () => {
    const result = evaluateCase(
        golden({
            prompt: "Build a distinctive landing page with strong typography.",
            expectedAny: ["apple-design"],
            enabledSkills: ["frontend-design", "apple-design"],
        }),
        available,
    );
    assert.equal(result.selected[0], "frontend-design");
    assert.ok(result.selected.includes("apple-design"), result.selected.join(", "));
    assert.equal(result.hitAt1, false);
    assert.equal(result.hitAtK, true);
    assert.equal(result.passed, true);
});

test("expectNone passes only when nothing is selected", () => {
    const passed = evaluateCase(
        golden({
            id: "trivial",
            prompt: "Draft a short email thanking the team for attending the workshop.",
            expectedAny: [],
            expectNone: true,
        }),
        available,
    );
    assert.equal(passed.passed, true);
    assert.equal(passed.emptySelection, true);

    const failed = evaluateCase(
        golden({
            id: "not-trivial",
            prompt: "Build a polished, distinctive landing page",
            expectedAny: [],
            expectNone: true,
        }),
        available,
    );
    assert.equal(failed.passed, false);
    assert.equal(failed.emptySelection, false);
    assert.match(failed.failureReason ?? "", /Expected no skill selection/);
});

test("summarize computes pass, hit, and precision metrics", () => {
    const cases: CaseEvaluation[] = [
        caseEval(),
        caseEval({
            id: "second",
            hitAt1: false,
            hitAtK: true,
            selected: ["baseline-ui", "accessibility"],
            expectedMatched: ["accessibility"],
            selectedTokens: 1300,
        }),
        caseEval({
            id: "forbidden",
            passed: false,
            forbiddenSelected: ["mcp-builder"],
            failureReason: "Selected forbidden skill(s): mcp-builder.",
        }),
        caseEval({
            id: "none",
            expectedAny: [],
            expectNone: true,
            selected: [],
            recommended: [],
            hitAt1: false,
            hitAtK: false,
            emptySelection: true,
            expectedMatched: [],
            selectedTokens: 0,
        }),
        caseEval({
            id: "over",
            budget: { used: 4000, limit: 3000, over: true },
        }),
    ];

    const summary = summarize(cases);
    assert.equal(summary.total, 5);
    assert.equal(summary.positiveCases, 4);
    assert.equal(summary.passed, 4);
    assert.equal(summary.failed, 1);
    assert.equal(summary.passRate, 0.8);
    assert.equal(summary.hitAt1, 3);
    assert.equal(summary.hitAt1Rate, 0.75);
    assert.equal(summary.hitAtK, 4);
    assert.equal(summary.hitAtKRate, 1);
    assert.equal(summary.forbiddenViolations, 1);
    assert.deepEqual(summary.forbiddenCaseIds, ["forbidden"]);
    assert.equal(summary.emptySelections, 1);
    assert.equal(summary.budgetOverruns, 1);
    assert.equal(summary.averageSelectedCount, (1 + 2 + 1 + 0 + 1) / 5);
    assert.equal(summary.averageSelectedTokens, (900 + 1300 + 900 + 0 + 900) / 5);
});

test("summarize handles an empty case list without dividing by zero", () => {
    const summary = summarize([]);
    assert.equal(summary.total, 0);
    assert.equal(summary.passRate, 0);
    assert.equal(summary.hitAt1Rate, 0);
    assert.equal(summary.hitAtKRate, 0);
    assert.equal(summary.averageSelectedCount, 0);
    assert.equal(summary.averageRequiredPrecision, 0);
});

test("bucketize groups by every tag and by mode", () => {
    const cases = [
        caseEval({ id: "a", tags: ["design", "frontend"] }),
        caseEval({ id: "b", tags: ["design"], passed: false }),
        caseEval({ id: "c", tags: [], mode: "ask" }),
    ];

    const byTag = bucketize(cases, (item) => (item.tags.length > 0 ? item.tags : ["untagged"]));
    assert.equal(byTag.design.total, 2);
    assert.equal(byTag.design.passed, 1);
    assert.equal(byTag.frontend.total, 1);
    assert.equal(byTag.untagged.total, 1);

    const byMode = bucketize(cases, (item) => [item.mode]);
    assert.equal(byMode.agent.total, 2);
    assert.equal(byMode.ask.total, 1);
});

test("evaluateDataset produces a deterministic report with dataset metadata", () => {
    const dataset = parseDataset({
        version: 1,
        selectionVersion: "router-v1",
        description: "tiny",
        cases: [
            {
                id: "one",
                prompt: "Fix accessibility issues: keyboard navigation and ARIA labels",
                expectedAny: ["accessibility"],
                tags: ["quality"],
            },
            {
                id: "two",
                prompt: "Draft a short email thanking the team.",
                expectNone: true,
                tags: ["negative"],
            },
        ],
    });
    const loaded: LoadedDataset = {
        dataset,
        path: "memory.json",
        sha256: "a".repeat(64),
    };

    const report = evaluateDataset(loaded, {
        availableSkills: available,
        now: new Date("2026-01-02T03:04:05.000Z"),
    });

    assert.equal(report.generatedAt, "2026-01-02T03:04:05.000Z");
    assert.equal(report.dataset.sha256, "a".repeat(64));
    assert.equal(report.summary.total, 2);
    assert.equal(report.summary.passed, 2);
    assert.equal(report.byTag.quality.total, 1);
    assert.equal(report.byTag.negative.total, 1);
    assert.equal(report.catalog.hitAtK, 3);
    assert.equal(report.cases[0].id, "one");
});
