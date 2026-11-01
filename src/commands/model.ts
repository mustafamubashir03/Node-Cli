import { select } from "@inquirer/prompts";
import { buildChatPickerEntries, fetchFreeModels } from "../agent/openrouter-models.js";
import { switchModel, type AgentSession } from "../agent/session.js";
import { writeAppConfig } from "../config/app-config.js";
import { describeError, printFailure, printNotice, printSuccess } from "../ui/messages.js";

export async function runModelSwitch(session: AgentSession): Promise<void> {
    printNotice("Fetching free models from OpenRouter...");
    let apiModels;
    try {
        apiModels = await fetchFreeModels();
    } catch (error) {
        printFailure(`Could not fetch OpenRouter models: ${describeError(error)}`);
        return;
    }

    const entries = buildChatPickerEntries(apiModels);
    if (entries.length === 0) {
        printFailure("No free OpenRouter models found.");
        return;
    }

    const chosen = await select<string>({
        message: "Choose a free OpenRouter model",
        choices: entries.map((entry) => ({
            name: entry.name,
            value: entry.value,
            disabled: entry.disabled,
        })),
    });

    await applyModelChoice(chosen, session);
}

async function applyModelChoice(modelId: string, session: AgentSession): Promise<void> {
    process.env.AGENT_MODEL = modelId;
    writeAppConfig({ selectedModel: modelId });
    await switchModel(session, modelId);
    printSuccess(`Model switched to ${modelId}.`);
}

export async function setModelDirect(modelId: string, session: AgentSession): Promise<void> {
    await applyModelChoice(modelId, session);
}