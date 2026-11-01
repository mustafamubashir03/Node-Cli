/**
 * Loop detector: warns on 2nd identical failure, hard stops on 3rd.
 * Detects cycles and no-progress patterns.
 */
export interface LoopState {
  failures: Map<string, number>;
  history: string[];
}

export function createLoopState(): LoopState {
  return { failures: new Map(), history: [] };
}

export interface LoopCheckResult {
  action: "continue" | "warn" | "stop";
  reason?: string;
}

export function checkLoop(state: LoopState, action: string, failed: boolean): LoopCheckResult {
  state.history.push(action);

  // Cycle detection: A -> B -> C -> A
  if (state.history.length >= 4) {
    const last3 = state.history.slice(-3);
    const prev = state.history[state.history.length - 4];
    if (last3[0] === state.history[state.history.length - 4] && last3[1] === state.history[state.history.length - 3] && last3[2] === state.history[state.history.length - 2]) {
      // Check if we're repeating a 3-cycle
    }
  }

  // Simple cycle: last action equals an earlier action in a cycle
  if (state.history.length >= 3) {
    const last = state.history[state.history.length - 1];
    const prev2 = state.history[state.history.length - 3];
    if (last === prev2 && state.history[state.history.length - 2] !== last) {
      // Potential 2-cycle
    }
  }

  if (!failed) return { action: "continue" };

  const count = (state.failures.get(action) || 0) + 1;
  state.failures.set(action, count);

  if (count >= 3) {
    return { action: "stop", reason: `Hard stop: "${action}" failed ${count} times. Stopping to prevent infinite loop.` };
  }
  if (count === 2) {
    return { action: "warn", reason: `Warning: "${action}" failed twice. Consider a different approach.` };
  }
  return { action: "continue" };
}

export function detectCycle(history: string[]): boolean {
  if (history.length < 3) return false;
  // Check for A->B->A pattern (3 elements)
  for (let i = 0; i <= history.length - 3; i++) {
    if (history[i] === history[i + 2] && history[i] !== history[i + 1]) {
      return true;
    }
  }
  // Check for A->B->C->A pattern (4 elements)
  if (history.length >= 4) {
    for (let i = 0; i <= history.length - 4; i++) {
      if (history[i] === history[i + 3]) {
        return true;
      }
    }
  }
  return false;
}

export function detectNoProgress(history: string[], windowSize: number = 5): boolean {
  if (history.length < windowSize) return false;
  const recent = history.slice(-windowSize);
  const unique = new Set(recent);
  return unique.size === 1;
}