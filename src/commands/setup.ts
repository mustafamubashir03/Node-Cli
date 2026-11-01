import { promptForCredentials } from "../config/setup.js";

export async function runSetup(): Promise<void> {
    await promptForCredentials();
}