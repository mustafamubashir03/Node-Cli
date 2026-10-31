import { findCredential, MISSING_CREDENTIALS_MESSAGE, requireSupportedNodeVersion } from "../config/env.js";
import { printCheck } from "../ui/messages.js";

export async function runDoctor(): Promise<void> {
    printCheck("Node", requireSupportedNodeVersion());

    const credential = findCredential();
    if (!credential) {
        throw new Error(MISSING_CREDENTIALS_MESSAGE);
    }

    printCheck("Credentials", credential.variable);
}