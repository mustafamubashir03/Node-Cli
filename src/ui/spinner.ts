import chalk from "chalk";
import ora, { type Ora } from "ora";

let active: Ora | null = null;

export function startSpinner(text: string) {
    stopSpinner()
    active = ora({ text, color: "cyan" }).start();
}
export function updateSpinner(text: string) {
    if (active) active.text = text
}

export function stopSpinner() {
    active?.stop();
    active = null;
}