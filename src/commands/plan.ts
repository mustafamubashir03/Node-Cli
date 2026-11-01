import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { loadMemoryContext } from "../memory/memory.js";
import { describeError, printFailure, printHint, printSuccess } from "../ui/messages.js";

export type PlanOptions = {
    cwd?: string;
    force?: boolean;
};

export function buildPlanContent(goal: string, projectName: string): string {
    const normalizedGoal = goal.trim() || "Define the project goal.";
    return [
        "# Plan",
        "",
        "## Goal",
        normalizedGoal,
        "",
        "## Project",
        projectName,
        "",
        "## Scope",
        "- Confirmed requirements:",
        "- Assumptions:",
        "",
        "## Decisions",
        "-",
        "",
        "## Risks and dependencies",
        "-",
        "",
        "## Acceptance criteria",
        "-",
        "",
    ].join("\n");
}

export function buildTasksContent(goal: string): string {
    const normalizedGoal = goal.trim() || "Define the project goal.";
    return [
        "# Tasks",
        "",
        `- [ ] ${normalizedGoal}`,
        "",
        "## Notes",
        "- Update status as work progresses.",
        "",
    ].join("\n");
}

export function createPlanArtifacts(cwd: string, goal = "", options: PlanOptions = {}): { planPath: string; tasksPath: string } {
    const planPath = join(cwd, "plan.md");
    const tasksPath = join(cwd, "tasks.md");
    if (!options.force && (existsSync(planPath) || existsSync(tasksPath))) {
        throw new Error("plan.md or tasks.md already exists; use force to overwrite.");
    }
    writeFileSync(planPath, buildPlanContent(goal, basename(cwd)), "utf8");
    writeFileSync(tasksPath, buildTasksContent(goal), "utf8");
    return { planPath, tasksPath };
}

export function updateTaskStatus(cwd: string, taskText: string, completed: boolean): boolean {
    const tasksPath = join(cwd, "tasks.md");
    if (!existsSync(tasksPath)) return false;
    const current = readFileSync(tasksPath, "utf8");
    const from = completed ? "- [ ] " + taskText : "- [x] " + taskText;
    const to = completed ? "- [x] " + taskText : "- [ ] " + taskText;
    if (!current.includes(from)) return false;
    writeFileSync(tasksPath, current.replace(from, to), "utf8");
    return true;
}

export async function runPlanCommand(goal = "", options: PlanOptions = {}): Promise<void> {
    const cwd = options.cwd || process.cwd();
    try {
        createPlanArtifacts(cwd, goal, options);
        const memoryContext = loadMemoryContext({ cwd, maxChars: 3000 });
        if (memoryContext) {
            appendFileSync(join(cwd, "plan.md"), "\n## Memory context\n" + memoryContext + "\n", "utf8");
        }
        printSuccess("Created plan.md and tasks.md.");
        printHint("Edit the files to refine scope, then execute the plan in small tasks.");
    } catch (error) {
        printFailure(describeError(error));
    }
}