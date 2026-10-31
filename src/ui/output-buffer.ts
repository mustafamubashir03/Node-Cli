let buffered: string[] | null = null;

export function pauseOutput(): void {
    buffered ??= [];
}

export function resumeOutput(): void {
    const pending = buffered;
    buffered = null;
    for (const line of pending ?? []) {
        console.log(line);
    }
}

export function writeLine(line: string): void {
    if (buffered) {
        buffered.push(line);
        return;
    }
    console.log(line);
}