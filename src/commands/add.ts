import { input, select } from "@inquirer/prompts";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { requireSupportedNodeVersion } from "../config/env.js";
import { listServices, getService, applyService } from "../config/services.js";
import { describeError, printFailure, printHint, printNotice, printSuccess, printWarning } from "../ui/messages.js";

export type AddOptions = {
    service?: string;
    dir?: string;
    database?: "postgresql" | "sqlite";
    dryRun?: boolean;
    yes?: boolean;
};

export async function runAdd(options: AddOptions = {}): Promise<number> {
    await requireSupportedNodeVersion();

    let serviceId = options.service;
    if (!serviceId) {
        const services = listServices();
        serviceId = await select({
            message: "Choose a service to add:",
            choices: services.map((s) => ({ name: `${s.id} — ${s.name}: ${s.description}`, value: s.id })),
        });
    }

    const service = getService(serviceId!);
    if (!service) {
        printFailure(`Unknown service: ${serviceId}`);
        return 1;
    }

    const projectDir = resolve(options.dir ?? process.cwd());
    if (!existsSync(join(projectDir, "package.json"))) {
        printFailure(`No package.json found in ${projectDir}. Run from a project directory or pass --dir.`);
        return 1;
    }

    printNotice(`Service: ${service.name}`);
    printNotice(`Compatible stacks: ${service.compatibleStacks.join(", ")}`);
    printNotice(`Steps: ${service.steps.join(" → ")}`);
    if (service.requiresDatabase) printWarning("This service requires a database connection.");
    if (service.requiresCredentials) printWarning("This service requires user-provided credentials.");

    if (options.dryRun) {
        printNotice("Dry run: no changes made.");
        return 0;
    }

    const result = await applyService(serviceId!, projectDir, { database: options.database });
    if (!result.ok) {
        printFailure(result.message);
        return 1;
    }
    printSuccess(result.message);
    return 0;
}

export function printServicesList(): void {
    for (const s of listServices()) {
        printNotice(`${s.id} — ${s.name}`);
        printHint(`  ${s.description}`);
        printHint(`  stacks: ${s.compatibleStacks.join(", ")} | db: ${s.requiresDatabase} | creds: ${s.requiresCredentials}`);
    }
}
