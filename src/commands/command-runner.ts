import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";

export type PackageManager = "pnpm" | "npm" | "yarn";

export const PACKAGE_MANAGERS: PackageManager[] = ["pnpm", "npm", "yarn"];

export type CommandResult = {
    command: string;
    /** Null when the process could not be started or was killed by a signal. */
    status: number | null;
    stdout: string;
    stderr: string;
    error: NodeJS.ErrnoException | null;
};

export type RunCommandOptions = {
    cwd?: string;
    timeoutMs?: number;
    stdio?: "inherit" | "pipe";
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    pathEnv?: string;
};

/**
 * Characters that the Windows command interpreter treats specially. Arguments
 * containing any of them are rejected instead of escaped: quoting rules for
 * `cmd.exe` + `.cmd` shims are inconsistent enough that escaping is riskier
 * than refusing an unusual path.
 */
const SHELL_UNSAFE = /["&|<>^%()!\r\n;`$]/;

const SAFE_COMMAND = /^[A-Za-z0-9._:/\\ -]+$/;

export function assertShellSafe(value: string, label: string): void {
    if (SHELL_UNSAFE.test(value)) {
        throw new Error(
            `${label} contains characters that cannot be passed safely through the Windows command shell: ${JSON.stringify(value)}. ` +
                "Move the project to a path without & | < > ^ % ( ) ! ; ` $ and quotes, then try again.",
        );
    }
}

export function quoteWindowsArgument(value: string): string {
    return /\s/.test(value) ? `"${value}"` : value;
}

/** Builds the single command line string handed to `cmd.exe` on Windows. */
export function buildWindowsCommandLine(command: string, args: string[]): string {
    if (!SAFE_COMMAND.test(command)) {
        throw new Error(`Refusing to run an unsafe command name: ${JSON.stringify(command)}`);
    }
    assertShellSafe(command, "Command path");
    for (const arg of args) {
        assertShellSafe(arg, "Command argument");
    }
    return [command, ...args].map(quoteWindowsArgument).join(" ");
}

export function formatCommand(command: string, args: string[]): string {
    return [command, ...args]
        .map((part) => (/\s/.test(part) ? `"${part}"` : part))
        .join(" ");
}

function isExecutableFile(path: string, platform: NodeJS.Platform): boolean {
    try {
        if (!statSync(path).isFile()) return false;
        if (platform !== "win32") accessSync(path, constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

/**
 * Finds a command on PATH without spawning a shell. Used for capability checks
 * (is pnpm installed?) and for tests; execution still goes through `runCommand`.
 */
export function findExecutable(
    command: string,
    options: { platform?: NodeJS.Platform; pathEnv?: string; cwd?: string } = {},
): string | null {
    const platform = options.platform ?? process.platform;
    const isWindows = platform === "win32";

    if (command.includes("/") || command.includes("\\") || isAbsolute(command)) {
        const direct = isAbsolute(command) ? command : resolve(options.cwd ?? process.cwd(), command);
        return isExecutableFile(direct, platform) ? direct : null;
    }

    const pathEnv = options.pathEnv ?? process.env.PATH ?? "";
    const extensions = isWindows
        ? [
              ...(process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
                  .split(";")
                  .filter(Boolean),
              "",
          ].map((ext) => ext.toLowerCase())
        : [""];

    for (const directory of pathEnv.split(isWindows ? ";" : delimiter)) {
        if (!directory) continue;
        for (const extension of extensions) {
            const candidate = join(directory, command + extension);
            if (isExecutableFile(candidate, platform)) return candidate;
        }
    }
    return null;
}

export function commandExists(
    command: string,
    options: { platform?: NodeJS.Platform; pathEnv?: string } = {},
): boolean {
    return findExecutable(command, options) !== null;
}

/**
 * Runs a command without `shell: true` on POSIX. On Windows, `.cmd` shims
 * (npm, npx, pnpm, yarn) cannot be spawned directly, so a validated command
 * line is passed to `cmd.exe` via Node's shell option. Every argument is
 * checked against the metacharacter denylist first.
 */
export function runCommand(
    command: string,
    args: string[],
    options: RunCommandOptions = {},
): CommandResult {
    const platform = options.platform ?? process.platform;
    const stdio = options.stdio ?? "pipe";
    const env = options.env ?? process.env;

    if (platform === "win32") {
        const comspec = process.env.ComSpec ?? "cmd.exe";
        if (!/(^|[\\/])cmd\.exe$/i.test(comspec) && !/^cmd(\.exe)?$/i.test(comspec)) {
            throw new Error(
                `Unsupported Windows command interpreter: ${comspec}. node-cli requires cmd.exe to run package managers.`,
            );
        }

        const line = buildWindowsCommandLine(command, args);
        const result = spawnSync(line, {
            shell: true,
            cwd: options.cwd,
            env,
            stdio,
            timeout: options.timeoutMs,
            windowsHide: true,
            encoding: stdio === "pipe" ? "utf8" : undefined,
        });

        return {
            command: formatCommand(command, args),
            status: result.status,
            stdout: typeof result.stdout === "string" ? result.stdout : "",
            stderr: typeof result.stderr === "string" ? result.stderr : "",
            error: (result.error as NodeJS.ErrnoException | undefined) ?? null,
        };
    }

    const result = spawnSync(command, args, {
        cwd: options.cwd,
        env,
        stdio,
        timeout: options.timeoutMs,
        encoding: stdio === "pipe" ? "utf8" : undefined,
    });

    return {
        command: formatCommand(command, args),
        status: result.status,
        stdout: typeof result.stdout === "string" ? result.stdout : "",
        stderr: typeof result.stderr === "string" ? result.stderr : "",
        error: (result.error as NodeJS.ErrnoException | undefined) ?? null,
    };
}

export function commandFailureMessage(result: CommandResult): string {
    if (result.error) {
        return `${result.command}: ${result.error.message}`;
    }
    const stderr = result.stderr.trim();
    if (stderr) {
        const lines = stderr.split(/\r?\n/);
        return `${result.command} failed: ${lines.slice(-8).join("\n")}`;
    }
    return `${result.command} exited with code ${result.status ?? "unknown"}.`;
}

/**
 * Chooses the package manager for the scaffolded project.
 *
 * Order: explicit override, the manager that launched node-cli, a lockfile in
 * the current directory or an ancestor, then the first manager on PATH.
 */
export function detectPackageManager(
    startDir: string = process.cwd(),
    options: {
        available?: (manager: PackageManager) => boolean;
        env?: NodeJS.ProcessEnv;
        platform?: NodeJS.Platform;
        pathEnv?: string;
    } = {},
): PackageManager {
    const env = options.env ?? process.env;
    const isAvailable =
        options.available ??
        ((manager: PackageManager) =>
            commandExists(manager, { platform: options.platform, pathEnv: options.pathEnv }));

    const override = env.NODE_CLI_PACKAGE_MANAGER;
    if (isPackageManager(override) && isAvailable(override)) {
        return override;
    }

    const userAgent = env.npm_config_user_agent ?? "";
    const fromAgent = /^(pnpm|npm|yarn)\//.exec(userAgent)?.[1];
    if (isPackageManager(fromAgent) && isAvailable(fromAgent)) {
        return fromAgent;
    }

    let directory = resolve(startDir);
    for (;;) {
        if (isAvailable("pnpm") && existsSync(join(directory, "pnpm-lock.yaml"))) return "pnpm";
        if (isAvailable("yarn") && existsSync(join(directory, "yarn.lock"))) return "yarn";
        if (isAvailable("npm") && existsSync(join(directory, "package-lock.json"))) return "npm";

        const parent = dirname(directory);
        if (parent === directory) break;
        directory = parent;
    }

    for (const manager of PACKAGE_MANAGERS) {
        if (isAvailable(manager)) return manager;
    }
    return "npm";
}

function isPackageManager(value: unknown): value is PackageManager {
    return typeof value === "string" && (PACKAGE_MANAGERS as string[]).includes(value);
}
