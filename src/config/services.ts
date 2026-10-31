import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { runCommand, commandExists, detectPackageManager } from "../commands/command-runner.js";

export type ServiceId = "prisma" | "drizzle" | "tailwind" | "shadcn" | "vitest" | "playwright" | "eslint";

export type ServiceDefinition = {
    id: ServiceId;
    name: string;
    description: string;
    compatibleStacks: string[];
    compatibleLanguages: ("js" | "ts")[];
    requiresNetwork: boolean;
    requiresDatabase: boolean;
    requiresCredentials: boolean;
    steps: string[];
};

export const SERVICES: ServiceDefinition[] = [
    { id: "prisma", name: "Prisma ORM", description: "Prisma schema, client, and migration tooling.", compatibleStacks: ["nextjs", "express-api", "mern"], compatibleLanguages: ["js", "ts"], requiresNetwork: true, requiresDatabase: false, requiresCredentials: false, steps: ["install dependencies", "run prisma init", "generate client", "validate schema"] },
    { id: "drizzle", name: "Drizzle ORM", description: "Drizzle schema, config, and migration tooling.", compatibleStacks: ["nextjs", "express-api", "mern"], compatibleLanguages: ["js", "ts"], requiresNetwork: true, requiresDatabase: false, requiresCredentials: false, steps: ["install dependencies", "create config", "create schema", "generate migrations"] },
    { id: "tailwind", name: "Tailwind CSS", description: "Utility-first CSS framework.", compatibleStacks: ["react-vite", "nextjs", "mern"], compatibleLanguages: ["js", "ts"], requiresNetwork: true, requiresDatabase: false, requiresCredentials: false, steps: ["install dependencies", "init config", "configure content paths"] },
    { id: "shadcn", name: "shadcn/ui", description: "Component primitives via shadcn CLI.", compatibleStacks: ["react-vite", "nextjs"], compatibleLanguages: ["js", "ts"], requiresNetwork: true, requiresDatabase: false, requiresCredentials: false, steps: ["run shadcn init", "add a component"] },
    { id: "vitest", name: "Vitest", description: "Unit testing with Vitest.", compatibleStacks: ["react-vite", "nextjs", "express-api", "mern"], compatibleLanguages: ["js", "ts"], requiresNetwork: true, requiresDatabase: false, requiresCredentials: false, steps: ["install vitest", "add test script", "create example test"] },
    { id: "playwright", name: "Playwright", description: "Browser E2E testing.", compatibleStacks: ["react-vite", "nextjs", "mern"], compatibleLanguages: ["js", "ts"], requiresNetwork: true, requiresDatabase: false, requiresCredentials: false, steps: ["install playwright", "init config", "create smoke test", "install browsers (manual)"] },
    { id: "eslint", name: "ESLint", description: "Linting configuration.", compatibleStacks: ["react-vite", "nextjs", "express-api", "mern"], compatibleLanguages: ["js", "ts"], requiresNetwork: true, requiresDatabase: false, requiresCredentials: false, steps: ["install eslint", "init config"] },
];

export function getService(id: string): ServiceDefinition | undefined {
    return SERVICES.find((s) => s.id === id);
}

export function listServices(): ServiceDefinition[] {
    return [...SERVICES];
}

export type ServiceResult = { ok: boolean; message: string };

function pm(projectDir: string): string {
    return detectPackageManager(projectDir);
}

function run(projectDir: string, command: string, args: string[]): ServiceResult {
    const r = runCommand(command, args, { cwd: projectDir, timeoutMs: 300_000, stdio: "inherit" });
    if (r.error || r.status !== 0) {
        return { ok: false, message: `Command failed: ${command} ${args.join(" ")} (exit ${r.status ?? "err"})` };
    }
    return { ok: true, message: "ok" };
}

function writeIfMissing(path: string, content: string): void {
    if (!existsSync(path)) writeFileSync(path, content);
}

function allowBuilds(pmName: string): string[] {
    return pmName === "pnpm" ? ["--allow-build", "esbuild", "--allow-build", "workerd"] : [];
}

// ---------------------------------------------------------------------------
// Prisma (v7)
// ---------------------------------------------------------------------------

export async function applyPrisma(projectDir: string, database: "postgresql" | "sqlite" = "postgresql"): Promise<ServiceResult> {
    const packageManager = pm(projectDir);
    const pmCmd = packageManager === "npm" ? "npm" : packageManager;
    const allowBuilds = packageManager === "pnpm" ? ["--allow-build", "esbuild", "--allow-build", "workerd"] : [];

    const deps = ["prisma", "@prisma/client", "dotenv"];
    const installArgs = packageManager === "npm" ? ["install", ...deps] : ["add", ...deps, ...allowBuilds];
    const r1 = run(projectDir, pmCmd, installArgs);
    if (!r1.ok) return r1;

    const target = database === "postgresql" ? "postgres" : "sqlite";
    const confirmName = basename(projectDir);
    const initArgs = ["orm", "init", "--target", target, "--authoring", "psl", "--yes", "--write-env", "--confirm", confirmName];
    const r2 = run(projectDir, packageManager === "npm" ? "npx" : packageManager, [packageManager === "npm" ? "exec" : "exec", "prisma", ...initArgs]);
    if (!r2.ok) return { ok: false, message: "Prisma orm init failed." };

    const envExample = database === "postgresql"
        ? 'DATABASE_URL="postgresql://user:password@localhost:5432/mydb"\n'
        : 'DATABASE_URL="file:./dev.db"\n';
    writeIfMissing(join(projectDir, ".env.example"), envExample);
    writeIfMissing(join(projectDir, ".env"), envExample);

    // Offline validation of the contract (Prisma 7+)
    const r3 = run(projectDir, packageManager === "npm" ? "npx" : packageManager, packageManager === "npm" ? ["exec", "prisma", "contract", "format"] : ["exec", "prisma", "contract", "format"]);
    if (!r3.ok) return { ok: false, message: "Prisma contract format failed." };

    return { ok: true, message: "Prisma initialized (Prisma 7+ contract-based) and contract formatted." };
}

// ---------------------------------------------------------------------------
// Drizzle
// ---------------------------------------------------------------------------

export async function applyDrizzle(projectDir: string, database: "postgresql" | "sqlite" = "postgresql"): Promise<ServiceResult> {
    const packageManager = pm(projectDir);
    const pmCmd = packageManager === "npm" ? "npm" : packageManager;
    const deps = database === "postgresql"
        ? ["drizzle-orm", "pg", "dotenv"]
        : ["drizzle-orm", "better-sqlite3", "dotenv"];
    const devDeps = ["drizzle-kit"];

    const r1 = run(projectDir, pmCmd, packageManager === "npm" ? ["install", ...deps] : ["add", ...deps, ...allowBuilds(packageManager)]);
    if (!r1.ok) return r1;
    const r2 = run(projectDir, pmCmd, packageManager === "npm" ? ["install", "-D", ...devDeps] : ["add", "-D", ...devDeps, ...allowBuilds(packageManager)]);
    if (!r2.ok) return r2;

    const configContent = database === "postgresql"
        ? 'import { defineConfig } from "drizzle-kit";\nexport default defineConfig({ schema: "./src/db/schema.ts", out: "./drizzle", dialect: "postgresql", dbCredentials: { url: process.env.DATABASE_URL! } });\n'
        : 'import { defineConfig } from "drizzle-kit";\nexport default defineConfig({ schema: "./src/db/schema.ts", out: "./drizzle", dialect: "sqlite", dbCredentials: { url: process.env.DATABASE_URL! } });\n';
    writeIfMissing(join(projectDir, "drizzle.config.ts"), configContent);

    mkdirSync(join(projectDir, "src", "db"), { recursive: true });
    const schemaContent = database === "postgresql"
        ? 'import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";\nexport const users = pgTable("users", { id: serial("id").primaryKey(), name: text("name").notNull(), createdAt: timestamp("created_at").defaultNow() });\n'
        : 'import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";\nexport const users = sqliteTable("users", { id: integer("id").primaryKey({ autoIncrement: true }), name: text("name").notNull() });\n';
    writeIfMissing(join(projectDir, "src", "db", "schema.ts"), schemaContent);

    const connContent = database === "postgresql"
        ? 'import { drizzle } from "drizzle-orm/node-postgres";\nimport { Pool } from "pg";\nconst pool = new Pool({ connectionString: process.env.DATABASE_URL });\nexport const db = drizzle(pool);\n'
        : 'import { drizzle } from "drizzle-orm/better-sqlite3";\nimport Database from "better-sqlite3";\nconst sqlite = new Database(process.env.DATABASE_URL ?? "local.db");\nexport const db = drizzle(sqlite);\n';
    writeIfMissing(join(projectDir, "src", "db", "index.ts"), connContent);

    const envExample = database === "postgresql"
        ? 'DATABASE_URL="postgresql://user:password@localhost:5432/mydb"\n'
        : 'DATABASE_URL="local.db"\n';
    writeIfMissing(join(projectDir, ".env.example"), envExample);
    writeIfMissing(join(projectDir, ".env"), envExample);

    // generate (may fail without DB; not hard failure)
    run(projectDir, packageManager === "npm" ? "npx" : packageManager, packageManager === "npm" ? ["exec", "drizzle-kit", "generate"] : ["exec", "drizzle-kit", "generate"]);

    return { ok: true, message: "Drizzle configured." };
}

// ---------------------------------------------------------------------------
// Tailwind
// ---------------------------------------------------------------------------

export async function applyTailwind(projectDir: string): Promise<ServiceResult> {
    const packageManager = pm(projectDir);
    const pmCmd = packageManager === "npm" ? "npm" : packageManager;
    const hasVite = existsSync(join(projectDir, "vite.config.ts")) || existsSync(join(projectDir, "vite.config.js"));

    if (hasVite) {
        const r1 = run(projectDir, pmCmd, packageManager === "npm" ? ["install", "-D", "tailwindcss", "@tailwindcss/vite"] : ["add", "-D", "tailwindcss", "@tailwindcss/vite", ...allowBuilds(packageManager)]);
        if (!r1.ok) return r1;

        const viteConfig = existsSync(join(projectDir, "vite.config.ts")) ? join(projectDir, "vite.config.ts") : join(projectDir, "vite.config.js");
        if (existsSync(viteConfig)) {
            let content = readFileSync(viteConfig, "utf8");
            if (!content.includes("@tailwindcss/vite")) {
                content = content.replace('import { defineConfig } from "vite";', 'import { defineConfig } from "vite";\nimport tailwindcss from "@tailwindcss/vite";');
                content = content.replace("import { defineConfig } from 'vite'", "import { defineConfig } from 'vite'\nimport tailwindcss from '@tailwindcss/vite'");
                content = content.replace("plugins: [", "plugins: [tailwindcss(), ");
                writeFileSync(viteConfig, content);
            }
        }
    } else {
        const r1 = run(projectDir, pmCmd, packageManager === "npm" ? ["install", "-D", "tailwindcss", "@tailwindcss/postcss", "postcss"] : ["add", "-D", "tailwindcss", "@tailwindcss/postcss", "postcss", ...allowBuilds(packageManager)]);
        if (!r1.ok) return r1;

        const postcssPath = join(projectDir, "postcss.config.mjs");
        if (!existsSync(postcssPath)) {
            writeFileSync(postcssPath, 'export default { plugins: { "@tailwindcss/postcss": {} } };\n');
        }
    }

    const cssPath = join(projectDir, "src", "index.css");
    if (existsSync(cssPath)) {
        const css = readFileSync(cssPath, "utf8");
        if (!css.includes('@import "tailwindcss"') && !css.includes("@tailwind")) {
            writeFileSync(cssPath, '@import "tailwindcss";\n\n' + css);
        }
    } else {
        mkdirSync(join(projectDir, "src"), { recursive: true });
        writeFileSync(cssPath, '@import "tailwindcss";\n');
    }

    return { ok: true, message: "Tailwind v4 configured." };
}

export async function applyVitest(projectDir: string): Promise<ServiceResult> {
    const packageManager = pm(projectDir);
    const pmCmd = packageManager === "npm" ? "npm" : packageManager;
    const r1 = run(projectDir, pmCmd, packageManager === "npm" ? ["install", "-D", "vitest"] : ["add", "-D", "vitest", ...allowBuilds(packageManager)]);
    if (!r1.ok) return r1;
    const pkgPath = join(projectDir, "package.json");
    if (existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
            pkg.scripts = pkg.scripts || {};
            pkg.scripts.test = "vitest run";
            writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
        } catch { /* ignore */ }
    }
    mkdirSync(join(projectDir, "src"), { recursive: true });
    const testFile = join(projectDir, "src", "example.test.ts");
    if (!existsSync(testFile)) {
        writeFileSync(testFile, 'import { describe, it, expect } from "vitest";\ndescribe("example", () => { it("adds", () => { expect(1 + 1).toBe(2); }); });\n');
    }
    const r2 = run(projectDir, packageManager === "npm" ? "npx" : packageManager, packageManager === "npm" ? ["exec", "vitest", "run"] : ["exec", "vitest", "run"]);
    if (!r2.ok) return { ok: false, message: "Vitest installed but example test failed." };
    return { ok: true, message: "Vitest configured and example test passed." };
}

export async function applyEslint(projectDir: string): Promise<ServiceResult> {
    const packageManager = pm(projectDir);
    const pmCmd = packageManager === "npm" ? "npm" : packageManager;
    const r1 = run(projectDir, pmCmd, packageManager === "npm" ? ["install", "-D", "eslint"] : ["add", "-D", "eslint", ...allowBuilds(packageManager)]);
    if (!r1.ok) return r1;
    const hasConfig = [".eslintrc", ".eslintrc.js", ".eslintrc.json", ".eslintrc.yml", "eslint.config.js", "eslint.config.mjs"].some((f) => existsSync(join(projectDir, f)));
    if (!hasConfig) {
        writeFileSync(join(projectDir, "eslint.config.mjs"), 'export default [{ rules: {} }];\n');
    }
    return { ok: true, message: "ESLint configured." };
}

export async function applyPlaywright(projectDir: string): Promise<ServiceResult> {
    const packageManager = pm(projectDir);
    const pmCmd = packageManager === "npm" ? "npm" : packageManager;
    const r1 = run(projectDir, pmCmd, packageManager === "npm" ? ["install", "-D", "@playwright/test"] : ["add", "-D", "@playwright/test", ...allowBuilds(packageManager)]);
    if (!r1.ok) return r1;
    if (!existsSync(join(projectDir, "playwright.config.ts")) && !existsSync(join(projectDir, "playwright.config.js"))) {
        writeFileSync(join(projectDir, "playwright.config.ts"), 'import { defineConfig } from "@playwright/test";\nexport default defineConfig({ testDir: "./tests", use: { baseURL: "http://localhost:3000" } });\n');
    }
    mkdirSync(join(projectDir, "tests"), { recursive: true });
    const smoke = join(projectDir, "tests", "smoke.spec.ts");
    if (!existsSync(smoke)) {
        writeFileSync(smoke, 'import { test, expect } from "@playwright/test";\ntest("home", async ({ page }) => { await page.goto("/"); await expect(page).toHaveTitle(/.*/); });\n');
    }
    return { ok: true, message: "Playwright installed. Run 'npx playwright install' to download browsers before running tests." };
}

export async function applyShadcn(projectDir: string): Promise<ServiceResult> {
    const packageManager = pm(projectDir);
    const pmCmd = packageManager === "npm" ? "npm" : packageManager;
    const r = run(projectDir, pmCmd, packageManager === "npm" ? ["exec", "shadcn@latest", "init", "-y"] : ["dlx", "shadcn@latest", "init", "-y"]);
    if (!r.ok) {
        return { ok: false, message: "shadcn init failed or requires interactive input. Run 'npx shadcn@latest init' manually." };
    }
    return { ok: true, message: "shadcn/ui initialized." };
}

export async function applyService(serviceId: string, projectDir: string, options: { database?: "postgresql" | "sqlite" } = {}): Promise<ServiceResult> {
    const service = getService(serviceId);
    if (!service) return { ok: false, message: `Unknown service: ${serviceId}` };

    switch (serviceId) {
        case "prisma":
            return applyPrisma(projectDir, options.database ?? "postgresql");
        case "drizzle":
            return applyDrizzle(projectDir, options.database ?? "postgresql");
        case "tailwind":
            return applyTailwind(projectDir);
        case "vitest":
            return applyVitest(projectDir);
        case "playwright":
            return applyPlaywright(projectDir);
        case "eslint":
            return applyEslint(projectDir);
        case "shadcn":
            return applyShadcn(projectDir);
        default:
            return { ok: false, message: `Service '${serviceId}' is not implemented.` };
    }
}
