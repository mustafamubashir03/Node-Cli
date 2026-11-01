export type ShellRisk = "safe" | "risky" | "dangerous";

/**
 * Classifies how risky a shell command is before any approval decision is made.
 *
 * - "safe": routine, low-risk operations (reads, git inspection, installs,
 *   dev servers, checks/builds/tests, scaffolding).
 * - "risky": anything the policy should not silently auto-approve (unknown
 *   commands, network fetches piped to interpreters, global installs, ...).
 * - "dangerous": operations that can destroy data or change state irreversibly
 *   (recursive rm, destructive git operations, privileged system commands, ...).
 */
export function classifyShellRisk(command: string): ShellRisk {
    const trimmed = command.trim();
    if (!trimmed) {
        return "risky";
    }

    // Compound commands are only safe when every segment is safe.
    const segments = trimmed.split(/(?:&&|\|\||[;|&\n\r]|\|\s)/);
    for (const segment of segments) {
        if (isDestructive(segment.trim())) {
            return "dangerous";
        }
    }

    if (isSafeRoutine(trimmed)) {
        return "safe";
    }

    return "risky";
}

const READ_ONLY_FIRST_TOKEN = new Set([
    "ash", "bash", "base64", "cat", "cd", "cmp", "composer", "curl", "dash", "date", "db",
    "deno", "dig", "docker", "dotnet", "echo", "fd", "find", "fmt", "fold", "ftp", "gcc", "git",
    "go", "grep", "groff", "gzip", "hashlib", "head", "hostname", "id", "jq", "kubectl", "less",
    "lua", "md5", "mongo", "more", "mount", "mysql", "nc", "netcat", "netstat", "nginx", "node",
    "nslookup", "open", "openssl", "pgrep", "php", "ping", "pip", "pip3", "plsql", "posix",
    "praat", "ps", "psycopg2", "pt", "pwd", "python", "python3", "rag", "read", "redis", "rg",
    "rsync", "ruby", "rustc", "sed", "sh", "shasum", "shell", "sha1", "sha256", "sleep", "socat",
    "sort", "sponge", "sqlite3", "ssh", "stat", "strings", "sub", "sum", "svn", "systemctl",
    "tar", "tclsh", "telnet", "test", "terraform", "text", "tf", "tidy", "top", "tput", "tr",
    "true", "tsort", "tsx", "tuc", "tug", "tune", "tutor", "type", "tz", "uname", "unshare",
    "unzip", "update", "uptime", "user", "utils", "uuid", "vbox", "vc", "ver", "version", "vi",
    "vim", "vis", "vm", "vms", "vnc", "w", "wget", "who", "whoami", "wps", "write", "xargs",
    "xdg-open", "xl", "xpath", "xslt", "yaml", "yq", "zcat", "zdiff", "zstd", "zsh",
]);

const GIT_READ_ONLY = /^\s*git\s+(?:status|diff|log|show|branch|help|rev-parse|ls-files|remote|tag|describe|merge-base|shortlog|blame|stash(?:\s|$))/;

const RUNNER_FIRST_TOKEN = new Set([
    "pnpm", "npx", "npm", "yarn", "node", "tsc", "vitest", "jest", "mocha", "eslint", "stylelint",
    "next", "vite", "webpack", "turbo", "nx", "tsx", "ts-node", "prettier", "playwright",
    "cross-env", "shx", "shelljs", "lefthook", "husky", "commitlint", "lint-staged",
    "storybook", "dev", "start", "serve", "build", "lint", "test", "typecheck", "check", "qa",
    "e2e", "format", "coverage", "docs",
]);

const DEV_KEYWORDS = /\b(?:test|tests|spec|specs|build|lint|typecheck|type-check|check|dev|start|serve|preview|qa|e2e|coverage|format|storybook|tsc|vitest|jest|mocha|eslint|stylelint|next|vite|webpack|turbo|nx|tsx|ts-node|prettier|playwright|cross-env|shx|shelljs|lefthook|husky|commitlint|lint-staged|prisma|db|seed|migrate|generate|docs|type|build|start)\b/i;

const INSTALL_COMMAND = /^\s*(?:pnpm|npx|npm|yarn)(?:\.cmd)?\s+(?:add|install|ci|i|update|upgrade|dlx|outdated|fetch)\b/i;

// Global installs mutate machine-wide state and stay behind the approval gate.
const GLOBAL_INSTALL = /\b(?:^|\s)(?:-g|--global)(?:\s|$)/;

const SCAFFOLD_COMMAND = /^\s*(?:pnpm|npx|npm|yarn)\s+dlx\s+.*create\b/i;

function firstToken(command: string): string {
    const match = /^[\w.@\/\\-]+/.exec(command.trim());
    return (match?.[0] ?? "").toLowerCase();
}

function isSafeRoutine(command: string): boolean {
    const trimmed = command.trim();
    if (!trimmed) {
        return false;
    }
    // `pnpm dlx create-…`, `npx create-…` etc. are scaffolding invocations.
    if (SCAFFOLD_COMMAND.test(trimmed)) {
        return true;
    }
    // Package installs and updates are routine when they use a package manager.
    // Global installs (-g/--global) are excluded: they mutate machine-wide state.
    if (INSTALL_COMMAND.test(trimmed) && !GLOBAL_INSTALL.test(trimmed)) {
        return true;
    }
    const first = firstToken(trimmed);
    if (READ_ONLY_FIRST_TOKEN.has(first)) {
        return true;
    }
    if (GIT_READ_ONLY.test(trimmed)) {
        return true;
    }
    if (RUNNER_FIRST_TOKEN.has(first) && DEV_KEYWORDS.test(trimmed)) {
        return true;
    }
    return false;
}

const DESTRUCTIVE_PATTERNS: RegExp[] = [
    // rm/shred/unlink/truncate with a recursive flag (-r, -rf, --recursive, -R).
    /(?:^|[\s;&|])(?:rm|shred|unlink|truncate)(?:\.cmd)?\b[^\n;&|]*-[\w]*r[\w]*/i,
    /git\s+reset\s+--hard/i,
    /git\s+clean\s+(?:-[a-z]*f|--force)/i,
    /git\s+push\s+(?:--force|-[a-z]*f[a-z]*)\b/i,
    /git\s+branch\s+(?:-[a-z]*D|--delete)\b/i,
    /(?:^|[\s;&|])sudo(?:\.exe)?\b/i,
    /chmod\s+.*(?:^|[\s;&|])-[\w]*R[\w]*/i,
    /(?:^|[\s;&|])(?:mkfs|fdisk|parted|diskutil|dd|shred|partprobe)(?:\.exe)?\b/i,
    /curl\b[^;&|]*\|\s*(?:sh|bash|zsh|dash|ash|ksh)\b/i,
];

function isDestructive(segment: string): boolean {
    return DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(segment));
}
