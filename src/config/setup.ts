import { checkbox, confirm, input, password, select } from "@inquirer/prompts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findProvider, PROVIDERS, type Provider } from "./providers.js";
import { catalog, getSkill } from "./catalog.js";
import { findCredential, loadEnvironment } from "./env.js";
import { writeAppConfig } from "./app-config.js";
import { printFailure, printHint, printNotice, printSuccess } from "../ui/messages.js";
import { listSkillInfos } from "../skills/registry.js";

export async function promptForCredentials(): Promise<void> {
    if (findCredential()) {
        return;
    }

    printNotice("No API key was found. Let's set one up.");

    let provider: Provider;
    let model: string;

    try {
        provider = await pickProvider();
        const key = await askForKey(provider);
        model = await pickModel(provider);

        const env: Record<string, string> = {};
        env[provider.keyVariable] = key;
        env.AGENT_MODEL = model;

        writeDotEnv(env);
        applyEnv(env);
        loadEnvironment();
    } catch {
        printFailure("Setup cancelled. No key was saved.");
        printHint("Run node-cli setup whenever you are ready to add a key.");
        process.exit(1);
    }

    printSuccess("Key saved to .env.");
    printNotice(`Provider: ${provider.name}`);
    printNotice(`Model: ${model}`);

    await askAboutSkills();
}

async function askAboutSkills(): Promise<void> {
    const usable = listSkillInfos().filter((info) => info.availability === "available");
    if (usable.length === 0) {
        printNotice("No verified skills are available in this build. You can add your own later with /skills.");
        return;
    }

    const wantSkills = await confirm({
        message: "Do you want to enable any AI skills?",
        default: false,
    });
    if (!wantSkills) {
        printNotice("No skills enabled. You can add them later with /skills.");
        return;
    }

    const categoryKeys = [...new Set(usable.map((info) => info.category))].sort();
    const category = await select({
        message: "Pick a skill category",
        choices: categoryKeys.map((name) => ({
            name: catalog.categories[name]?.label ?? name,
            value: name,
        })),
    });

    const available = usable
        .filter((info) => info.category === category)
        .map((info) => ({
            name: `${info.id} — ${info.description}`,
            value: info.id,
            checked: false,
        }));

    const selected = await checkbox({
        message: `Select ${catalog.categories[category]?.label ?? category} skills to enable`,
        choices: available,
    });

    if (selected.length > 0) {
        await writeAppConfig({ skills: selected });
        printSuccess(`Enabled skills: ${selected.join(", ")}`);
    } else {
        printNotice("No skills selected.");
    }
}

function pickProvider(): Promise<Provider> {
    return select<Provider>({
        message: "Which AI provider do you want to use?",
        choices: PROVIDERS.map((provider) => ({
            name: `${provider.name} — ${provider.description}`,
            value: provider,
        })),
        default: PROVIDERS[0],
    });
}

function askForKey(provider: Provider): Promise<string> {
    return password({
        message: `Enter your ${provider.name} API key`,
    });
}

async function pickModel(provider: Provider): Promise<string> {
    const choices = provider.models.map((model) => ({ name: model, value: model }));
    choices.push({ name: "Type a custom model", value: "__custom__" });

    const picked = await select<string>({
        message: "Pick a model (or type your own)",
        choices,
        default: provider.exampleModel,
    });

    if (picked !== "__custom__") {
        return picked;
    }

    return input({
        message: "Enter the model name",
        default: provider.exampleModel,
    });
}

function writeDotEnv(updates: Record<string, string>): void {
    const path = join(process.cwd(), ".env");
    let existing = "";
    if (existsSync(path)) {
        existing = readFileSync(path, "utf8");
    }

    const kept = existing
        .split("\n")
        .filter((line) => {
            const key = line.split("=")[0]?.trim();
            return key !== "" && !Object.keys(updates).includes(key);
        });

    kept.push("", "# Added by node-cli setup");
    for (const [key, value] of Object.entries(updates)) {
        kept.push(`${key}="${value}"`);
    }

    writeFileSync(path, kept.join("\n") + "\n");
}

function applyEnv(updates: Record<string, string>): void {
    for (const [key, value] of Object.entries(updates)) {
        process.env[key] = value;
    }
}