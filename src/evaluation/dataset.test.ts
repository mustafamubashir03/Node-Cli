import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SKILL_SELECTION_VERSION } from "../skills/selection.js";
import { availableSkillIds } from "../skills/registry.js";
import {
    DatasetError,
    loadDataset,
    parseDataset,
    validateAgainstCatalog,
} from "./dataset.js";

function rawCase(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: "sample-case",
        prompt: "Build a distinctive landing page",
        expectedAny: ["frontend-design"],
        ...overrides,
    };
}

function rawDataset(cases: unknown[] = [rawCase()]): Record<string, unknown> {
    return {
        version: 1,
        selectionVersion: "router-v1",
        description: "test dataset",
        cases,
    };
}

function parseError(raw: unknown): string {
    try {
        parseDataset(raw);
        assert.fail("expected a DatasetError");
    } catch (error) {
        assert.ok(error instanceof DatasetError, String(error));
        return error.message;
    }
}

test("parseDataset accepts a minimal valid dataset", () => {
    const dataset = parseDataset(rawDataset());
    assert.equal(dataset.version, 1);
    assert.equal(dataset.cases.length, 1);
    assert.equal(dataset.cases[0].mode, "agent");
    assert.deepEqual(dataset.cases[0].expectedAny, ["frontend-design"]);
    assert.deepEqual(dataset.cases[0].forbidden, []);
});

test("parseDataset rejects duplicate case ids", () => {
    const message = parseError(rawDataset([rawCase(), rawCase()]));
    assert.match(message, /Duplicate case id/);
});

test("parseDataset rejects a case with no expectation", () => {
    const message = parseError(rawDataset([rawCase({ expectedAny: [] })]));
    assert.match(message, /expectedAny or expectNone/);
});

test("parseDataset rejects expectNone combined with expectedAny", () => {
    const message = parseError(rawDataset([rawCase({ expectNone: true })]));
    assert.match(message, /cannot set both/);
});

test("parseDataset rejects a skill listed as both expected and forbidden", () => {
    const message = parseError(
        rawDataset([rawCase({ expectedAny: ["frontend-design"], forbidden: ["frontend-design"] })]),
    );
    assert.match(message, /both expected and forbidden/);
});

test("parseDataset rejects an expectation outside the enabled subset", () => {
    const message = parseError(
        rawDataset([
            rawCase({
                enabledSkills: ["accessibility"],
                expectedAny: ["frontend-design"],
            }),
        ]),
    );
    assert.match(message, /does not enable/);
});

test("parseDataset rejects invalid modes and non-kebab-case ids", () => {
    assert.match(parseError(rawDataset([rawCase({ mode: "yolo" })])), /mode must be one of/);
    assert.match(parseError(rawDataset([rawCase({ id: "Not_Kebab" })])), /kebab-case/);
});

test("validateAgainstCatalog rejects unknown, unavailable, and non-distributable ids", () => {
    const unknown = parseDataset(
        rawDataset([rawCase({ expectedAny: ["definitely-not-a-skill"] })]),
    );
    assert.throws(() => validateAgainstCatalog(unknown), /unknown skill id/);

    const unavailable = parseDataset(
        rawDataset([rawCase({ expectedAny: ["web-quality-audit"] })]),
    );
    assert.throws(() => validateAgainstCatalog(unavailable), /not available/);
});

test("the shipped dataset has at least 20 cases and only usable skill ids", () => {
    const loaded = loadDataset(join(process.cwd(), "evaluation", "skill-selection.v1.json"));
    const available = new Set(availableSkillIds());

    assert.ok(loaded.dataset.cases.length >= 20, `only ${loaded.dataset.cases.length} cases`);
    assert.equal(loaded.dataset.selectionVersion, SKILL_SELECTION_VERSION);
    assert.match(loaded.sha256, /^[a-f0-9]{64}$/);

    const ids = new Set<string>();
    for (const item of loaded.dataset.cases) {
        assert.ok(!ids.has(item.id), `duplicate id ${item.id}`);
        ids.add(item.id);
        for (const id of [
            ...(item.enabledSkills ?? []),
            ...(item.expectedAny ?? []),
            ...(item.forbidden ?? []),
        ]) {
            assert.ok(available.has(id), `${item.id} references unusable skill ${id}`);
        }
    }
});

test("loadDataset is stable and reports the same digest on repeated loads", () => {
    const path = join(process.cwd(), "evaluation", "skill-selection.v1.json");
    const first = loadDataset(path);
    const second = loadDataset(path);
    assert.equal(first.sha256, second.sha256);
    assert.deepEqual(first.dataset.cases.map((c) => c.id), second.dataset.cases.map((c) => c.id));
});

test("loadDataset wraps missing files and invalid JSON in DatasetError", () => {
    const dir = mkdtempSync(join(tmpdir(), "dataset-"));
    try {
        assert.throws(
            () => loadDataset(join(dir, "missing.json")),
            (error: unknown) => error instanceof DatasetError && /Cannot read dataset/.test(error.message),
        );

        const invalid = join(dir, "invalid.json");
        writeFileSync(invalid, "{ not json");
        assert.throws(
            () => loadDataset(invalid),
            (error: unknown) => error instanceof DatasetError && /not valid JSON/.test(error.message),
        );
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
