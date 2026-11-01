import { existsSync, readFileSync, readdirSync } from "node:fs";
import { findProjectRoot } from "../memory/memory.js";
import { execSync } from "node:child_process";

export type VerificationStatus = "passed" | "failed" | "blocked" | "not_run" | "unsupported";

export interface VerificationCheck {
  name: string;
  status: VerificationStatus;
  evidence?: string;
  detail?: string;
}

export interface VerificationResult {
  checks: VerificationCheck[];
  overall: VerificationStatus;
  timestamp: string;
}

/** Detect project type based on files present. */
export function detectProjectType(projectRoot?: string): string {
  const root = projectRoot ?? findProjectRoot();
  if (existsSync(root + "/package.json")) {
    try {
      const pkg = JSON.parse(readFileSync(root + "/package.json", "utf8"));
      if (pkg.dependencies?.react || pkg.devDependencies?.react) return "react";
      if (pkg.dependencies?.express || pkg.dependencies?.fastify || pkg.dependencies?.koa) return "backend";
      if (pkg.devDependencies?.typescript || pkg.dependencies?.typescript) return "typescript";
    } catch { /* ignore */ }
    return "node";
  }
  if (existsSync(root + "/index.html")) return "static-web";
  // Check subdirectories for HTML files (e.g., project/coffee-shop/index.html)
  try {
    const entries = readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        if (existsSync(root + "/" + entry.name + "/index.html")) return "static-web";
      }
    }
  } catch { /* ignore */ }
  if (existsSync(root + "/requirements.txt") || existsSync(root + "/pyproject.toml")) return "python";
  if (existsSync(root + "/Cargo.toml")) return "rust";
  if (existsSync(root + "/go.mod")) return "go";
  return "unknown";
}

/** Detect the package manager for a project. */
export function detectPackageManager(projectRoot: string): "npm" | "pnpm" | "yarn" {
  // Check package.json for packageManager field
  try {
    const pkg = JSON.parse(readFileSync(projectRoot + "/package.json", "utf8"));
    if (pkg.packageManager) {
      if (pkg.packageManager.startsWith("pnpm")) return "pnpm";
      if (pkg.packageManager.startsWith("yarn")) return "yarn";
      if (pkg.packageManager.startsWith("npm")) return "npm";
    }
  } catch { /* ignore */ }

  // Check lockfiles (deterministic precedence: pnpm > yarn > npm)
  if (existsSync(projectRoot + "/pnpm-lock.yaml")) return "pnpm";
  if (existsSync(projectRoot + "/yarn.lock")) return "yarn";
  if (existsSync(projectRoot + "/package-lock.json")) return "npm";

  return "npm"; // default
}

/** Run a command and capture the result. */
export function runCommand(command: string, cwd: string, timeoutMs = 30000): { success: boolean; output: string; exitCode: number } {
  try {
    const output = execSync(command, { cwd, timeout: timeoutMs, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    return { success: true, output: (output || "").slice(0, 500), exitCode: 0 };
  } catch (err: any) {
    const output = (err.stdout || "") + (err.stderr || "");
    return { success: false, output: output.slice(0, 500), exitCode: err.status ?? 1 };
  }
}

/** Run a set of verification checks appropriate for the project type. */
export function runVerification(projectRoot?: string): VerificationResult {
  const root = projectRoot ?? findProjectRoot();
  const projectType = detectProjectType(root);
  const checks: VerificationCheck[] = [];
  const now = new Date().toISOString();

  // Check: project directory exists
  checks.push({
    name: "project-dir-exists",
    status: existsSync(root) ? "passed" : "failed",
    evidence: existsSync(root) ? root : "Directory not found",
  });

  // Check: plan artifacts exist
  const planPath = root + "/.node-cli/project/plan.md";
  checks.push({
    name: "plan-artifact-exists",
    status: existsSync(planPath) ? "passed" : "not_run",
    evidence: existsSync(planPath) ? planPath : "No plan.md found",
  });

  // Type-specific checks
  switch (projectType) {
    case "static-web": {
      // Find HTML files in root or one level of subdirectories
      const htmlPaths: string[] = [];
      if (existsSync(root + "/index.html")) htmlPaths.push("index.html");
      try {
        const entries = readdirSync(root, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
            if (existsSync(root + "/" + entry.name + "/index.html")) {
              htmlPaths.push(entry.name + "/index.html");
            }
          }
        }
      } catch { /* ignore */ }

      if (htmlPaths.length === 0) {
        checks.push({
          name: "html-files-exist",
          status: "failed",
          evidence: "No index.html found in project",
        });
      } else {
        for (const hp of htmlPaths) {
          checks.push({
            name: `file-exists:${hp}`,
            status: "passed",
            evidence: root + "/" + hp,
          });
        }
      }
      break;
    }
    case "typescript":
    case "react":
    case "node": {
      checks.push({
        name: "package-json-exists",
        status: existsSync(root + "/package.json") ? "passed" : "failed",
        evidence: existsSync(root + "/package.json") ? "Found" : "Missing",
      });

      // Check for package.json scripts
      let scripts: Record<string, string> = {};
      try {
        const pkg = JSON.parse(readFileSync(root + "/package.json", "utf8"));
        scripts = pkg.scripts || {};
      } catch { /* ignore */ }

      const pm = detectPackageManager(root);

      // Run typecheck if available
      if (scripts.typecheck) {
        const r = runCommand(`${pm} run typecheck`, root);
        checks.push({
          name: "typecheck",
          status: r.success ? "passed" : "failed",
          evidence: r.success ? "Passed" : r.output.slice(0, 200),
        });
      } else {
        checks.push({
          name: "typecheck",
          status: "not_run",
          evidence: "No typecheck script in package.json",
        });
      }

      // Run tests if available
      if (scripts.test) {
        const r = runCommand(`${pm} test`, root);
        checks.push({
          name: "tests",
          status: r.success ? "passed" : "failed",
          evidence: r.success ? "Passed" : r.output.slice(0, 200),
        });
      } else {
        checks.push({
          name: "tests",
          status: "not_run",
          evidence: "No test script in package.json",
        });
      }
      break;
    }
    default:
      checks.push({
        name: "project-type-detection",
        status: "passed",
        evidence: `Detected: ${projectType}`,
      });
  }

  const overall = checks.some((c) => c.status === "failed")
    ? "failed"
    : checks.some((c) => c.status === "not_run")
    ? "not_run"
    : "passed";

  return { checks, overall, timestamp: now };
}