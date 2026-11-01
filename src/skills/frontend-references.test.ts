import { test } from "node:test";
import assert from "node:assert/strict";
import { consultFrontendReferences, FRONTEND_REFERENCE_ROLES } from "./frontend-references.js";
import { isFrontendIntent } from "./router.js";

test("backend-only task does not consult frontend references", () => {
    const r = consultFrontendReferences("Build a REST API endpoint for user authentication with postgres");
    assert.equal(r.frontend, false);
    assert.deepEqual(r.consulted, []);
    assert.ok(r.exception);
});

test("mixed frontend/backend activates frontend workflow", () => {
    const r = consultFrontendReferences("Build an API plus a dashboard UI for admins");
    assert.equal(r.frontend, true);
    assert.ok(r.consulted.length >= 1);
});

test("frontend landing page consults at least five references when applicable", () => {
    const r = consultFrontendReferences("Build a polished responsive React landing page with Tailwind and animations");
    assert.equal(r.frontend, true);
    assert.ok(r.consulted.length >= 5, `expected >=5, got ${r.consulted.length}: ${r.consulted.join(", ")}`);
    // distinct
    assert.equal(new Set(r.consulted).size, r.consulted.length);
});

test("CSS bug fix is frontend intent", () => {
    assert.equal(isFrontendIntent("Fix responsive layout bug in the navbar CSS"), true);
});

test("pure database migration is not frontend", () => {
    assert.equal(isFrontendIntent("Run a database migration for the users table"), false);
});

test("reference consultation is bounded (no more than 6)", () => {
    const r = consultFrontendReferences("Build a complex animated React dashboard with 3D canvas and GSAP");
    assert.ok(r.consulted.length <= 6);
});

test("roles are distinct and one per role max", () => {
    const r = consultFrontendReferences("Build a React marketing landing page");
    assert.ok(r.consulted.length <= FRONTEND_REFERENCE_ROLES.length);
});
