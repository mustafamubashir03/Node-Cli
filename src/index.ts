#!/usr/bin/env node
import { createCli } from "./cli/program.js";
import { loadEnvironment } from "./config/env.js";
import { describeError, printFailure } from "./ui/messages.js";

async function main(): Promise<void> {
    loadEnvironment();
    await createCli().parseAsync(process.argv);
}

main().catch((error: unknown) => {
    printFailure(describeError(error));
    process.exit(1);
});