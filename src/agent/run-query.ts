import { Options, query } from "@anthropic-ai/claude-agent-sdk";
import { handleMessage } from "./message-handler.ts";
import { stopSpinner } from "../ui/spinner.ts";
import { fmt } from "../ui/format.ts";
import { buildModeOptions, type Climode } from "./modes.ts";

export type RunQueryOptions = {
    mode?: Climode;
    verbose?: boolean
}

export async function runQuery(prompt: string, options: RunQueryOptions = {}) {
    const { mode = 'agent', verbose = false } = options;
    try {
        for await (const message of query({
            prompt: prompt,
            options: buildModeOptions(mode)
        })) {
            handleMessage(message, { verbose })
        }
    } catch (error) {
        stopSpinner()
        console.error(fmt.error(`Error running query ${error}`));
    }
}