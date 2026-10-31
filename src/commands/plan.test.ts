import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPlanArtifacts, buildPlanContent, buildTasksContent, updateTaskStatus } from "./plan.js";

test("createPlanArtifacts creates both files", () => {
    const dir = mkdtempSync(join(tmpdir(), "plan-"));
    try {
        const res = createPlanArtifacts(dir, "Build feature");
        assert.ok(existsSync(res.planPath));
        assert.ok(existsSync(join(dir, "tasks.md")));
        assert.match(readFileSync(res.planPath, "utf8"), /Build feature/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("createPlanArtifacts refuses to overwrite by default", () => {
    const dir = mkdtempSync(join(tmpdir(), "plan-"));
    try {
        createPlanArtifacts(dir, "First");
        assert.throws(() => createPlanArtifacts(dir, "Second"), /already exists/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("createPlanArtifacts force overwrites", () => {
    const dir = mkdtempSync(join(tmpdir(), "plan-"));
    try {
        createPlanArtifacts(dir, "First");
        createPlanArtifacts(dir, "Second", { force: true });
        assert.match(readFileSync(join(dir, "plan.md"), "utf8"), /Second/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("buildPlanContent includes goal", () => {
    assert.match(buildPlanContent("Ship it", "proj"), /Ship it/);
});

test("buildTasksContent includes goal", () => {
    assert.match(buildTasksContent("Ship it"), /Ship it/);
});

test("updateTaskStatus marks task complete", () => {
    const dir = mkdtempSync(join(tmpdir(), "plan-"));
    try {
        createPlanArtifacts(dir, "Ship it");
        assert.equal(updateTaskStatus(dir, "Ship it", true), true);
        assert.match(readFileSync(join(dir, "tasks.md"), "utf8"), /\[x\] Ship it/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});