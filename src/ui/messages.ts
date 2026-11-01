import boxen from "boxen";
import { redactError, redactSecrets } from "../security/redact.js";
import { style } from "./styles.js";

export type LabeledRow = {
    label: string;
    value: string;
};

export type ModeCard = {
    mode: string;
    description: string;
    borderColor: string;
};

export type ContextReport = {
    totalTokens: number;
    maxTokens: number;
    categories: LabeledRow[];
};

export function printSessionHeader(mode: string, tools: string): void {
    console.log(style.mode(`Mode: ${mode}`));
    console.log(style.dim(`Tools: ${tools}`));
    console.log();
}

export function printCommandList(title: string, entries: LabeledRow[]): void {
    const width = entries.reduce((widest, entry) => Math.max(widest, entry.label.length), 0);

    console.log(style.bold(title));
    for (const entry of entries) {
        console.log(style.dim(`  ${entry.label.padEnd(width + 2)}${entry.value}`));
    }
    console.log();
}

export function printModeCards(cards: ModeCard[]): void {
    for (const card of cards) {
        console.log(
            boxen(style.bold(card.mode.toUpperCase()) + "\n\n" + style.dim(card.description), {
                padding: 1,
                borderColor: card.borderColor,
            }),
        );
    }
}

export function printContextReport(report: ContextReport): void {
    console.log(
        style.info(`Context window: ${report.totalTokens} / ${report.maxTokens} tokens`),
    );
    printCommandList("Tokens by category", report.categories);
}

export function printCheck(label: string, value: string): void {
    console.log(`${style.success("✓")} ${label.padEnd(16)}${style.dim(value)}`);
}

export function printNotice(message: string): void {
    console.log(style.info(redactSecrets(message)));
}

export function printSuccess(message: string): void {
    console.log(style.success(redactSecrets(message)));
}

export function printHint(message: string): void {
    console.log(style.dim(redactSecrets(message)));
}

export function printWarning(message: string): void {
    console.log(style.warning(redactSecrets(message)));
}

export function printFailure(message: string): void {
    console.error(style.error(redactSecrets(message)));
}

export function printGoodbye(): void {
    console.log(style.dim("Goodbye!"));
}

export function describeError(error: unknown): string {
    return redactError(error);
}