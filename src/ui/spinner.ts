import ora, { type Ora } from "ora";

let spinner: Ora | null = null;
let lastMessage = "";
let paused = false;

export function startSpinner(message: string): void {
    stopSpinner();
    lastMessage = message;
    spinner = ora({ text: message, color: "cyan" }).start();
}

export function stopSpinner(): void {
    spinner?.stop();
    spinner = null;
}

export function suspendSpinner(): void {
    if (!spinner || paused) {
        return;
    }
    paused = true;
    stopSpinner();
}

export function resumeSpinner(): void {
    if (!paused) {
        return;
    }
    paused = false;
    if (lastMessage) {
        startSpinner(lastMessage);
    }
}

export function isSpinnerActive(): boolean {
    return spinner !== null;
}