import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseMilestonesFromPlan } from "./plan-artifacts.js";
import { buildSkillManifest } from "./skill-manifest.js";
import { createTaskContext, saveTaskContext, loadTaskContext, findUnfinishedSessions } from "./task-context.js";
import { detectGreenfield } from "./greenfield-detector.js";
import { MANDATORY_FRONTEND_SKILLS, isFrontendTask, MANDATORY_FIGMA_SKILLS, isFigmaTask } from "./skill-manifest.js";
import { detectPackageManager, runCommand } from "./verification.js";
import { computeArtifactsHash } from "./approval-gate.js";


test("computePlanHash returns null when plan.md does not exist", async () => {
  const { computePlanHash } = await import("./approval-gate.js");
  const dir = mkdtempSync(join(tmpdir(), "wf-test-"));
  try {
    const hash = computePlanHash(dir);
    assert.equal(hash, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parseMilestonesFromPlan extracts milestones", () => {
  const content = [
    "# Plan",
    "",
    "## Milestones",
    "- [ ] M1: Setup project",
    "- [x] M2: Add tests",
    "- [ ] M3: Deploy",
    "",
    "## Verification",
    "- Run tests",
  ].join("\n");
  const milestones = parseMilestonesFromPlan(content);
  assert.equal(milestones.length, 3);
  assert.equal(milestones[0].id, "M1");
  assert.equal(milestones[0].status, "pending");
  assert.equal(milestones[1].id, "M2");
  assert.equal(milestones[1].status, "completed");
});

test("parseMilestonesFromPlan returns empty for no milestones section", () => {
  const content = "# Plan\n\n## Goal\nBuild something";
  const milestones = parseMilestonesFromPlan(content);
  assert.equal(milestones.length, 0);
});

test("buildSkillManifest creates candidates for all available skills", () => {
  const manifest = buildSkillManifest({
    taskId: "test-1",
    task: "Build a professional website",
    enabledSkills: [],
    mode: "agent",
    planRevision: 0,
  });
  assert.ok(manifest.candidates.length > 0);
  assert.ok(manifest.selected.length <= 3);
  assert.ok(manifest.budget.used >= 0);
  assert.ok(manifest.budget.limit > 0);
});

test("buildSkillManifest distinguishes selected, rejected, unavailable", () => {
  const manifest = buildSkillManifest({
    taskId: "test-2",
    task: "Build a backend API with database",
    enabledSkills: [],
    mode: "agent",
    planRevision: 0,
  });
  for (const c of manifest.candidates) {
    assert.ok(["candidate", "selected", "loaded", "requested", "applied", "rejected"].includes(c.lifecycle));
  }
  const total = manifest.selected.length + manifest.rejected.length + manifest.unavailable.length;
  assert.equal(total, manifest.candidates.length);
});

test("task context roundtrip", () => {
  const dir = mkdtempSync(join(tmpdir(), "wf-test-"));
  try {
    const ctx = createTaskContext({
      taskId: "session-123",
      originalTask: "Build a website",
      projectRoot: dir,
      workflow: "plan_approve_build",
    });
    ctx.phase = "planning";
    ctx.approvalStatus = "pending";
    saveTaskContext(ctx, dir);

    const loaded = loadTaskContext("session-123", dir);
    assert.ok(loaded);
    assert.equal(loaded!.originalTask, "Build a website");
    assert.equal(loaded!.workflow, "plan_approve_build");
    assert.equal(loaded!.phase, "planning");
    assert.equal(loaded!.approvalStatus, "pending");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadTaskContext returns null for missing file", () => {
  const dir = mkdtempSync(join(tmpdir(), "wf-test-"));
  try {
    const loaded = loadTaskContext("nonexistent", dir);
    assert.equal(loaded, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("findUnfinishedSessions finds non-complete sessions", () => {
  const dir = mkdtempSync(join(tmpdir(), "wf-test-"));
  try {
    const ctx1 = createTaskContext({
      taskId: "session-1",
      originalTask: "Task 1",
      projectRoot: dir,
      workflow: "plan_approve_build",
    });
    ctx1.phase = "implementation";
    saveTaskContext(ctx1, dir);

    const ctx2 = createTaskContext({
      taskId: "session-2",
      originalTask: "Task 2",
      projectRoot: dir,
      workflow: "quick",
    });
    ctx2.phase = "complete";
    saveTaskContext(ctx2, dir);

    const unfinished = findUnfinishedSessions(dir);
    assert.equal(unfinished.length, 1);
    assert.equal(unfinished[0].taskId, "session-1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("detectGreenfield identifies empty directory as greenfield", () => {
  const dir = mkdtempSync(join(tmpdir(), "wf-test-"));
  try {
    const result = detectGreenfield(dir, "Build a professional website");
    assert.equal(result.isGreenfield, true);
    assert.equal(result.confidence, "high");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("detectGreenfield identifies existing project", () => {
  const dir = mkdtempSync(join(tmpdir(), "wf-test-"));
  try {
    writeFileSync(join(dir, "index.html"), "<html></html>", "utf8");
    writeFileSync(join(dir, "style.css"), "body {}", "utf8");
    writeFileSync(join(dir, "script.js"), "console.log('hi')", "utf8");
    const result = detectGreenfield(dir, "Build a professional website");
    assert.equal(result.isGreenfield, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("detectGreenfield does not trigger for non-build requests", () => {
  const dir = mkdtempSync(join(tmpdir(), "wf-test-"));
  try {
    const result = detectGreenfield(dir, "Explain how to use this CLI");
    assert.equal(result.isGreenfield, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("hello", () => {
  assert.equal(1, 1);
});

test("isFrontendTask detects website tasks", () => {
  assert.equal(isFrontendTask("Build a coffee shop website"), true);
  assert.equal(isFrontendTask("Create a landing page"), true);
  assert.equal(isFrontendTask("Build a REST API"), false);
  assert.equal(isFrontendTask("Fix a database migration"), false);
});

test("mandatory frontend skills selected for website task", () => {
  const manifest = buildSkillManifest({
    taskId: "test-mandatory",
    task: "Build a coffee shop website in HTML CSS JS",
    enabledSkills: ["emil-design-eng", "baseline-ui", "frontend-design", "accessibility"],
    mode: "agent",
    planRevision: 0,
  });
  for (const skill of MANDATORY_FRONTEND_SKILLS) {
    assert.ok(manifest.selected.includes(skill), `${skill} should be selected`);
  }
});

test("mandatory frontend skills not selected for backend task", () => {
  const manifest = buildSkillManifest({
    taskId: "test-backend",
    task: "Build a REST API with PostgreSQL",
    enabledSkills: ["emil-design-eng", "baseline-ui", "frontend-design", "postgres-best-practices"],
    mode: "agent",
    planRevision: 0,
  });
  for (const skill of MANDATORY_FRONTEND_SKILLS) {
    assert.ok(!manifest.selected.includes(skill), `${skill} should NOT be selected for backend task`);
  }
});

test("mandatory skills not enabled are rejected not unavailable", () => {
  const manifest = buildSkillManifest({
    taskId: "test-unavail",
    task: "Build a website",
    enabledSkills: [],
    mode: "agent",
    planRevision: 0,
  });
  for (const skill of MANDATORY_FRONTEND_SKILLS) {
    const info = manifest.candidates.find(c => c.id === skill);
    if (info && info.availability === "available") {
      assert.ok(manifest.rejected.includes(skill), `${skill} should be in rejected list when not enabled`);
    }
  }
});

test("isFigmaTask detects figma URLs", () => {
  assert.equal(isFigmaTask("Implement this Figma design: https://www.figma.com/design/ABC/Name"), true);
  assert.equal(isFigmaTask("Convert this figma frame to React"), true);
  assert.equal(isFigmaTask("Build a coffee shop website"), false);
  assert.equal(isFigmaTask("Fix a database migration"), false);
});

test("mandatory figma skills selected for figma task", () => {
  const manifest = buildSkillManifest({
    taskId: "test-figma",
    task: "Implement this Figma design: https://www.figma.com/design/ABC/Name",
    enabledSkills: ["emil-design-eng", "baseline-ui", "frontend-design", "figma-to-code", "accessibility"],
    mode: "agent",
    planRevision: 0,
  });
  for (const skill of MANDATORY_FIGMA_SKILLS) {
    assert.ok(manifest.selected.includes(skill), `${skill} should be selected for Figma task`);
  }
});

test("pm1", () => {
  const dir = mkdtempSync(join(tmpdir(), "pm-test-"));
  try {
    writeFileSync(join(dir, "package.json"), "{}", "utf8");
    writeFileSync(join(dir, "pnpm-lock.yaml"), "", "utf8");
    assert.equal(detectPackageManager(dir), "pnpm");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("detectPackageManager returns yarn for yarn.lock", () => {
  const dir = mkdtempSync(join(tmpdir(), "pm-test-"));
  try {
    writeFileSync(join(dir, "package.json"), "{}", "utf8");
    writeFileSync(join(dir, "yarn.lock"), "", "utf8");
    assert.equal(detectPackageManager(dir), "yarn");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("detectPackageManager returns npm for package-lock.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "pm-test-"));
  try {
    writeFileSync(join(dir, "package.json"), "{}", "utf8");
    writeFileSync(join(dir, "package-lock.json"), "{}", "utf8");
    assert.equal(detectPackageManager(dir), "npm");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("detectPackageManager respects packageManager field", () => {
  const dir = mkdtempSync(join(tmpdir(), "pm-test-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ packageManager: "pnpm@8.0.0" }), "utf8");
    writeFileSync(join(dir, "yarn.lock"), "", "utf8");
    assert.equal(detectPackageManager(dir), "pnpm");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("detectPackageManager defaults to npm when no lockfile", () => {
  const dir = mkdtempSync(join(tmpdir(), "pm-test-"));
  try {
    writeFileSync(join(dir, "package.json"), "{}", "utf8");
    assert.equal(detectPackageManager(dir), "npm");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runCommand captures exit code on failure", () => {
  const dir = mkdtempSync(join(tmpdir(), "cmd-test-"));
  try {
    const r = runCommand("node -e \"process.exit(42)\"", dir);
    assert.equal(r.success, false);
    assert.equal(r.exitCode, 42);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runCommand captures output on success", () => {
  const dir = mkdtempSync(join(tmpdir(), "cmd-test-"));
  try {
    const r = runCommand("node -e \"console.log('hello')\"", dir);
    assert.equal(r.success, true);
    assert.equal(r.exitCode, 0);
    assert.ok(r.output.includes("hello"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runCommand handles spawn error (missing binary)", () => {
  const dir = mkdtempSync(join(tmpdir(), "cmd-test-"));
  try {
    const r = runCommand("nonexistent-binary-xyz", dir);
    assert.equal(r.success, false);
    assert.ok(r.exitCode !== 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("computeArtifactsHash changes when brief.md changes", () => {
  const dir = mkdtempSync(join(tmpdir(), "hash-test-"));
  try {
    mkdirSync(join(dir, ".node-cli", "project"), { recursive: true });
    writeFileSync(join(dir, ".node-cli", "project", "plan.md"), "# Plan", "utf8");
    writeFileSync(join(dir, ".node-cli", "project", "brief.md"), "# Brief v1", "utf8");
    const hash1 = computeArtifactsHash(dir);
    writeFileSync(join(dir, ".node-cli", "project", "brief.md"), "# Brief v2", "utf8");
    const hash2 = computeArtifactsHash(dir);
    assert.notEqual(hash1, hash2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("computeArtifactsHash changes when skill-plan.md changes", () => {
  const dir = mkdtempSync(join(tmpdir(), "hash-test-"));
  try {
    mkdirSync(join(dir, ".node-cli", "project"), { recursive: true });
    writeFileSync(join(dir, ".node-cli", "project", "plan.md"), "# Plan", "utf8");
    writeFileSync(join(dir, ".node-cli", "project", "skill-plan.md"), "# Skills v1", "utf8");
    const hash1 = computeArtifactsHash(dir);
    writeFileSync(join(dir, ".node-cli", "project", "skill-plan.md"), "# Skills v2", "utf8");
    const hash2 = computeArtifactsHash(dir);
    assert.notEqual(hash1, hash2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("computeArtifactsHash returns null when no artifacts exist", () => {
  const dir = mkdtempSync(join(tmpdir(), "hash-test-"));
  try {
    const hash = computeArtifactsHash(dir);
    assert.equal(hash, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});