import { pauseOutput, resumeOutput } from "./output-buffer.js";
import { resumeSpinner, suspendSpinner } from "./spinner.js";

const waiting: (() => void)[] = [];
let promptOnScreen = false;

export function confirmInTerminal(question: string): Promise<boolean> {
    if (promptOnScreen) {
        return new Promise((resolve) => {
            waiting.push(() => {
                void runPrompt(question).then(resolve);
            });
        });
    }

    promptOnScreen = true;
    return runPrompt(question);
}

async function runPrompt(question: string): Promise<boolean> {
    try {
        return await askOnScreen(question);
    } finally {
        releasePrompt();
    }
}

function releasePrompt(): void {
    const next = waiting.shift();
    if (next) {
        next();
        return;
    }
    promptOnScreen = false;
}

function askOnScreen(question: string): Promise<boolean> {
    suspendSpinner();
    pauseOutput();
    process.stdout.write(`\n${question} `);

    const stdin = process.stdin;
    stdin.resume();

    return new Promise<boolean>((resolve) => {
        const answer = (approved: boolean) => {
            stdin.removeListener("data", onData);
            stdin.removeListener("end", onEnd);
            stdin.removeListener("error", onError);
            stdin.pause();
            process.stdout.write("\n");
            resumeSpinner();
            resumeOutput();
            resolve(approved);
        };

        function onData(chunk: Buffer) {
            answer(isApproval(chunk.toString()));
        }

        function onEnd() {
            answer(false);
        }

        function onError() {
            answer(false);
        }

        stdin.on("data", onData);
        stdin.once("end", onEnd);
        stdin.once("error", onError);
    });
}

function isApproval(answer: string): boolean {
    const normalized = answer.trim().toLowerCase();
    return normalized === "y" || normalized === "yes";
}