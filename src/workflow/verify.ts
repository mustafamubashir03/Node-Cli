/**
 * Real [VERIFY] command: lists each check and fails if any fails.
 */
export interface VerifyCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface VerifyResult {
  checks: VerifyCheck[];
  allPassed: boolean;
}

export function runVerifyChecks(checks: { name: string; fn: () => { passed: boolean; detail?: string } }[]): VerifyResult {
  const results: VerifyCheck[] = [];
  for (const check of checks) {
    try {
      const r = check.fn();
      results.push({ name: check.name, passed: r.passed, detail: r.detail });
    } catch (e: any) {
      results.push({ name: check.name, passed: false, detail: e.message });
    }
  }
  return { checks: results, allPassed: results.every((r) => r.passed) };
}

export function formatVerifyResult(result: VerifyResult): string {
  const lines: string[] = ["[VERIFY]"];
  for (const check of result.checks) {
    const status = check.passed ? "PASS" : "FAIL";
    lines.push(`  [${status}] ${check.name}${check.detail ? `: ${check.detail}` : ""}`);
  }
  lines.push("");
  lines.push(result.allPassed ? "All checks passed." : "Some checks failed.");
  return lines.join("\n");
}