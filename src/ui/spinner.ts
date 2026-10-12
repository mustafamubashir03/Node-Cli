import chalk from "chalk";
import ora, { type Ora } from "ora";

let active: Ora | null = null;
let lastText = "";
let suspended = false;

export function startSpinner(text: string) {
    stopSpinner()
    lastText = text;
    active = ora({ text, color: "cyan" }).start();
}
export function updateSpinner(text: string) {
    if (active) {
        active.text = text
        lastText = text;
    }
}

export function stopSpinner() {
    active?.stop();
    active = null;
}

export function suspendSpinner() {
    if (!active || suspended) return;
    suspended = true;
    stopSpinner();
}

export function resumeSpinner() {
    if (!suspended) return;
    suspended = false;
    if (lastText) startSpinner(lastText);
}

export function isSpinnerActive(): boolean {
    return active !== null;
}