import type { Mode } from "./modes.js";

let activeMode: Mode = "agent";

export function getActiveMode(): Mode {
    return activeMode;
}

export function setActiveMode(mode: Mode): void {
    activeMode = mode;
}