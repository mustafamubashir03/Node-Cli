import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { detectPackageManager, runCommand, commandExists, type PackageManager } from "../commands/command-runner.js";

export type StackLanguage = "js" | "ts";

export type StackFamily =
    | "frontend"
    | "fullstack"
    | "api"
    | "mobile"
    | "monorepo";

export type StackDefinition = {
    id: string;
    name: string;
    family: StackFamily;
    languages: StackLanguage[];
    description: string;
    scaffold: ((language: StackLanguage, targetPath: string, packageManager: PackageManager) => { command: string; args: string[] } | null) | null;
    verify: string[];
    docs: string;
    verifiedAt: string;
};

function viteReact(language: StackLanguage, targetPath: string, pm: PackageManager) {
    const spec = "create-vite@latest";
    const template = language === "ts" ? "react-ts" : "react";
    const args = pm === "npm" ? ["--yes", spec, targetPath, "--template", template] : ["dlx", spec, targetPath, "--template", template];
    return { command: pm === "npm" ? "npx" : pm, args };
}

function nextjs(language: StackLanguage, targetPath: string, pm: PackageManager) {
    const spec = "create-next-app@latest";
    const args = [
        targetPath,
        "--eslint",
        "--app",
        "--src-dir",
        "--import-alias",
        "@/*",
        "--no-git",
        ...(language === "ts" ? ["--typescript", "--tailwind"] : ["--javascript"]),
    ];
    return pm === "npm"
        ? { command: "npx", args: ["--yes", spec, ...args] }
        : { command: pm, args: ["dlx", spec, ...args] };
}

function expressApi(language: StackLanguage, targetPath: string, _pm: PackageManager) {
    return null; // first-party template
}

function mern(language: StackLanguage, targetPath: string, _pm: PackageManager) {
    return null; // first-party template
}

export const STACKS: StackDefinition[] = [
    {
        id: "react-vite",
        name: "React + Vite",
        family: "frontend",
        languages: ["js", "ts"],
        description: "Vite + React single-page app.",
        scaffold: viteReact,
        verify: ["build"],
        docs: "https://vite.dev/guide/",
        verifiedAt: "2026-10-27",
    },
    {
        id: "nextjs",
        name: "Next.js",
        family: "frontend",
        languages: ["js", "ts"],
        description: "Next.js App Router application.",
        scaffold: nextjs,
        verify: ["build"],
        docs: "https://nextjs.org/docs",
        verifiedAt: "2026-10-27",
    },
    {
        id: "express-api",
        name: "Express API",
        family: "api",
        languages: ["js", "ts"],
        description: "Express REST API (first-party template).",
        scaffold: expressApi,
        verify: ["typecheck", "test"],
        docs: "https://expressjs.com/",
        verifiedAt: "2026-10-27",
    },
    {
        id: "mern",
        name: "MERN (MongoDB, Express, React, Node)",
        family: "fullstack",
        languages: ["js", "ts"],
        description: "Full-stack MERN application (first-party template).",
        scaffold: mern,
        verify: ["typecheck", "build", "test"],
        docs: "https://www.mongodb.com/mern-stack",
        verifiedAt: "2026-10-27",
    },
];

export function getStack(id: string): StackDefinition | undefined {
    return STACKS.find((s) => s.id === id);
}

export function listStacks(): StackDefinition[] {
    return [...STACKS];
}

export function isLanguageSupported(stack: StackDefinition, language: StackLanguage): boolean {
    return stack.languages.includes(language);
}

function writeJson(path: string, value: unknown): void {
    writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

function expressPackage(isTs: boolean): Record<string, unknown> {
    return {
        name: "express-api",
        version: "1.0.0",
        type: "module",
        scripts: isTs
            ? { dev: "tsx src/index.ts", build: "tsc", typecheck: "tsc --noEmit", start: "node dist/index.js", test: "node --test" }
            : { dev: "node --watch src/index.js", start: "node src/index.js", test: "node --test" },
        dependencies: { express: "^4.21.0" },
        ...(isTs ? { devDependencies: { typescript: "^5.0.0", "@types/express": "^4.17.0", "@types/node": "^22.0.0", tsx: "^4.0.0" } } : {}),
    };
}

function expressIndex(isTs: boolean): string {
    return 'import express from "express";\nconst app = express();\napp.get("/health", (_req, res) => res.json({ ok: true }));\napp.listen(3000, () => console.log("listening on 3000"));\n';
}

function expressTsConfig(): Record<string, unknown> {
    return { compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "nodenext", outDir: "dist", rootDir: "src", strict: true, esModuleInterop: true, skipLibCheck: true }, include: ["src/**/*.ts"] };
}

export function createFirstPartyTemplate(
    stackId: string,
    language: StackLanguage,
    targetPath: string,
): boolean {
    const isTs = language === "ts";

    if (stackId === "express-api") {
        mkdirSync(targetPath, { recursive: true });
        mkdirSync(join(targetPath, "src"), { recursive: true });
        writeJson(join(targetPath, "package.json"), expressPackage(isTs));
        writeFileSync(join(targetPath, "src", isTs ? "index.ts" : "index.js"), expressIndex(isTs));
        if (isTs) writeJson(join(targetPath, "tsconfig.json"), expressTsConfig());
        writeFileSync(join(targetPath, ".gitignore"), "node_modules/\ndist/\n.env\n");
        writeFileSync(join(targetPath, "pnpm-workspace.yaml"), "onlyBuiltDependencies:\n  - esbuild\n");
        return true;
    }

    if (stackId === "mern") {
        const clientDir = join(targetPath, "client");
        const serverDir = join(targetPath, "server");
        mkdirSync(targetPath, { recursive: true });
        mkdirSync(clientDir, { recursive: true });
        mkdirSync(serverDir, { recursive: true });
        mkdirSync(join(clientDir, "src"), { recursive: true });
        mkdirSync(join(serverDir, "src"), { recursive: true });

        // Root package.json with workspace scripts
        writeJson(join(targetPath, "package.json"), {
            name: "mern-app",
            version: "1.0.0",
            private: true,
            type: "module",
            scripts: {
                "dev:client": "npm --prefix client run dev",
                "dev:server": "npm --prefix server run dev",
                "dev": "concurrently \"npm run dev:server\" \"npm run dev:client\"",
                "build:client": "npm --prefix client run build",
                "build:server": isTs ? "npm --prefix server run build" : "echo 'no build'",
                "build": "npm run build:client && npm run build:server",
                "test": "npm --prefix server run test",
            },
            devDependencies: { concurrently: "^9.0.0" },
        });

        // Client package.json
        writeJson(join(clientDir, "package.json"), {
            name: "mern-client",
            version: "1.0.0",
            type: "module",
            scripts: {
                dev: "vite",
                build: "vite build",
                preview: "vite preview",
                ...(isTs ? { typecheck: "tsc --noEmit" } : {}),
            },
            dependencies: {
                react: "^18.3.0",
                "react-dom": "^18.3.0",
            },
            devDependencies: {
                "@vitejs/plugin-react": "^4.3.0",
                vite: "^5.4.0",
                ...(isTs ? { typescript: "^5.0.0", "@types/react": "^18.3.0", "@types/react-dom": "^18.3.0" } : {}),
            },
        });

        // Vite config
        writeFileSync(join(clientDir, "vite.config.js"), 'import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\nexport default defineConfig({ plugins: [react()], server: { proxy: { "/api": "http://localhost:5000" } } });\n');

        // Client index.html
        writeFileSync(join(clientDir, "index.html"), '<!doctype html>\n<html lang="en">\n<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>MERN App</title></head>\n<body><div id="root"></div><script type="module" src="/src/main.' + (isTs ? "tsx" : "jsx") + '"></script></body>\n</html>\n');

        // Client main
        writeFileSync(join(clientDir, "src", isTs ? "main.tsx" : "main.jsx"), 'import React from "react";\nimport ReactDOM from "react-dom/client";\nimport App from "./App.' + (isTs ? "tsx" : "jsx") + '";\nReactDOM.createRoot(document.getElementById("root")).render(<App />);\n');

        // Client App
        const appContent = isTs
            ? 'import { useEffect, useState } from "react";\n\ntype Health = { ok: boolean };\n\nexport default function App() {\n    const [health, setHealth] = useState<string>("checking...");\n    useEffect(() => {\n        fetch("/api/health")\n            .then((r) => r.json())\n            .then((d: Health) => setHealth(d.ok ? "server ok" : "server error"))\n            .catch(() => setHealth("server unreachable"));\n    }, []);\n    return (\n        <main style={{ fontFamily: "system-ui", padding: 24 }}>\n            <h1>MERN App</h1>\n            <p>API health: {health}</p>\n        </main>\n    );\n}\n'
            : 'import { useEffect, useState } from "react";\n\nexport default function App() {\n    const [health, setHealth] = useState("checking...");\n    useEffect(() => {\n        fetch("/api/health")\n            .then((r) => r.json())\n            .then((d) => setHealth(d.ok ? "server ok" : "server error"))\n            .catch(() => setHealth("server unreachable"));\n    }, []);\n    return (\n        <main style={{ fontFamily: "system-ui", padding: 24 }}>\n            <h1>MERN App</h1>\n            <p>API health: {health}</p>\n        </main>\n    );\n}\n';
        writeFileSync(join(clientDir, "src", isTs ? "App.tsx" : "App.jsx"), appContent);

        if (isTs) {
            writeJson(join(clientDir, "tsconfig.json"), { compilerOptions: { target: "ES2020", useDefineForClassFields: true, lib: ["ES2020", "DOM", "DOM.Iterable"], module: "ESNext", skipLibCheck: true, moduleResolution: "bundler", allowImportingTsExtensions: true, resolveJsonModule: true, isolatedModules: true, noEmit: true, jsx: "react-jsx", strict: true }, include: ["src"] });
            writeJson(join(clientDir, "tsconfig.node.json"), { compilerOptions: { composite: true, skipLibCheck: true, module: "ESNext", moduleResolution: "bundler", allowSyntheticDefaultImports: true }, include: ["vite.config.ts"] });
        }

        // Server package.json
        writeJson(join(serverDir, "package.json"), {
            name: "mern-server",
            version: "1.0.0",
            type: "module",
            scripts: isTs
                ? { dev: "tsx watch src/index.ts", build: "tsc", typecheck: "tsc --noEmit", start: "node dist/index.js", test: "node --test" }
                : { dev: "node --watch src/index.js", start: "node src/index.js", test: "node --test" },
            dependencies: { express: "^4.21.0", cors: "^2.8.5", mongodb: "^6.8.0", dotenv: "^16.4.0" },
            ...(isTs ? { devDependencies: { typescript: "^5.0.0", "@types/express": "^4.17.0", "@types/cors": "^2.8.0", "@types/node": "^22.0.0", tsx: "^4.0.0" } } : {}),
        });

        const serverIndex = isTs
            ? 'import express from "express";\nimport cors from "cors";\nimport dotenv from "dotenv";\ndotenv.config();\n\nconst app = express();\napp.use(cors());\napp.use(express.json());\n\napp.get("/health", (_req, res) => res.json({ ok: true }));\napp.get("/api/health", (_req, res) => res.json({ ok: true }));\n\nconst port = process.env.PORT || 5000;\napp.listen(port, () => console.log(`server listening on ${port}`));\n'
            : 'import express from "express";\nimport cors from "cors";\nimport dotenv from "dotenv";\ndotenv.config();\n\nconst app = express();\napp.use(cors());\napp.use(express.json());\n\napp.get("/health", (_req, res) => res.json({ ok: true }));\napp.get("/api/health", (_req, res) => res.json({ ok: true }));\n\nconst port = process.env.PORT || 5000;\napp.listen(port, () => console.log(`server listening on ${port}`));\n';
        writeFileSync(join(serverDir, "src", isTs ? "index.ts" : "index.js"), serverIndex);

        if (isTs) {
            writeJson(join(serverDir, "tsconfig.json"), { compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "nodenext", outDir: "dist", rootDir: "src", strict: true, esModuleInterop: true, skipLibCheck: true }, include: ["src/**/*.ts"] });
        }

        writeFileSync(join(serverDir, ".env.example"), "PORT=5000\nMONGODB_URI=mongodb://localhost:27017/mern-app\n");
        writeFileSync(join(serverDir, ".gitignore"), "node_modules/\ndist/\n.env\n");
        writeFileSync(join(clientDir, ".env"), "VITE_API_URL=http://localhost:5000\n");
        writeFileSync(join(clientDir, ".gitignore"), "node_modules/\ndist/\n");
        writeFileSync(join(targetPath, ".gitignore"), "node_modules/\nclient/dist/\nserver/dist/\n.env\n");
        writeFileSync(join(targetPath, "README.md"), "# MERN App\n\nRun `npm run dev:server` and `npm run dev:client` (or `npm run dev` with concurrently).\n\nSet MONGODB_URI in server/.env for database features.\n");
        writeFileSync(join(targetPath, "pnpm-workspace.yaml"), "onlyBuiltDependencies:\n  - esbuild\n");

        return true;
    }

    return false;
}
