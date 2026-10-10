# Node CLI

A CLI tool to help you start and develop your project with the power of Claude's Agent SDK.

![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-blue?style=flat-square)
![pnpm](https://img.shields.io/badge/pnpm-12.10.1-orange?style=flat-square)
![License](https://img.shields.io/badge/License-ISC-green?style=flat-square)

---

## Overview

`node-cli` is an interactive command-line tool built on top of `@anthropic-ai/claude-agent-sdk`. It provides one-shot prompt execution and a streaming interactive chat terminal with configurable execution modes, custom model routing (OpenRouter or local Ollama), permission controls, and formatted terminal UI output.

### Key Features

- **Three operation modes** — `agent`, `ask`, and `plan` — to control tool permissions and execution safety.
- **Interactive streaming chat (`pnpm dev chat`)** — real-time conversation loop with prompt history and slash command controls.
- **Flexible model routing** — supports OpenRouter default endpoints as well as local Ollama instances.
- **Permission control system** — enforces mode restrictions dynamically via `canUseTool` callbacks.
- **Rich terminal styling** — colorized text (chalk), ASCII title banners (figlet + boxen), and loading spinners (ora).

---

## Prerequisites & Installation

### Prerequisites

- **Node.js** >= 18.0.0
- **pnpm** v12.10.1+ (enforced via `devEngines` / `packageManager`)

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd node-cli

# Install dependencies using pnpm
pnpm install

# Build the TypeScript project
pnpm build
```

---

## Configuration and Models

Environment variables are loaded from `.env` via `dotenv`.

### Environment Variables

| Variable | Description | Default / Fallback |
|---|---|---|
| `OPENROUTER_API_KEY` | API key for OpenRouter endpoint | — |
| `ANTHROPIC_API_KEY` | Anthropic API key fallback | — |
| `ANTHROPIC_BASE_URL` | Base URL for custom endpoints (e.g. Ollama or custom proxies) | `https://openrouter.ai/api` |
| `ANTHROPIC_AUTH_TOKEN` | Auth token for custom base URLs (e.g. `"ollama"`) | — |
| `AGENT_MODEL` | Primary model identifier | `poolside/laguna-s-2.1:free` |

### Setting the Model Name

The default model is defined in `src/agent/modes.ts`:
- Primary Model (`MODEL`): set via `process.env.AGENT_MODEL` (defaults to `poolside/laguna-s-2.1:free`).
- Small Model (`SMALL_MODEL`): `poolside/laguna-xs-2.1:free` (used as Haiku model fallback).

To change the model, set `AGENT_MODEL` in your `.env`:
```env
AGENT_MODEL=poolside/laguna-s-2.1:free
```

### Switching between OpenRouter and Ollama

#### 1. OpenRouter (Default)
In `src/agent/modes.ts`, `BASE_OPTIONS` configures OpenRouter:
```env
OPENROUTER_API_KEY=your_openrouter_key_here
```

#### 2. Ollama (Local)
To use a local Ollama instance:
1. Set `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` in `.env`:
```env
ANTHROPIC_BASE_URL="http://localhost:11434"
ANTHROPIC_AUTH_TOKEN="ollama"
AGENT_MODEL="llama3"
```
2. `requireApiKey()` in `src/config/env.ts` accepts `"ollama"` as the auth token when `ANTHROPIC_BASE_URL` is set, allowing execution without a standard Anthropic API key.

---

## Usage

### Commands

| Command | Usage | Description |
|---|---|---|
| `chat` | `node-cli chat [-m mode] [-v]` | Start an interactive streaming chat session |
| `run` | `node-cli run <prompt> [-m mode] [-v]` | Send a one-shot prompt to Node CLI |
| `talk` | `node-cli talk <prompt> [-v]` | Send a prompt in agent mode |
| `doctor` | `node-cli doctor` | Verify Node.js version and API key setup |
| `banner` | `node-cli banner` | Display stylized ASCII title banner |
| `help` | `node-cli help` | Show CLI command help |

### Options

- `-m, --mode <mode>`: set operation mode (`agent`, `ask`, or `plan`). Default is `agent`.
- `-v, --verbose`: show detailed SDK message log types.

### Interactive Slash Commands (`node-cli chat`)

While inside an interactive chat session, the following slash commands are supported:

| Slash Command | Description |
|---|---|
| `/mode <agent\|ask\|plan>` | Dynamically switch mode during the chat session |
| `/context` | Display compact token usage summary for active session |
| `/help` | Show available slash commands |
| `/clear` | Clear the terminal screen |
| `/exit` | Gracefully terminate session and exit CLI process |

---

## Operation Modes

| Mode | Permission Mode | Allowed Tools | Disallowed Tools | Description |
|---|---|---|---|---|
| `agent` (default) | `acceptEdits` | `Read`, `Edit`, `Write`, `Bash`, `Glob`, `Grep` | None | Full agent loop; can read, edit files, and execute bash commands. |
| `ask` | `dontAsk` | `Read`, `Grep`, `Glob`, `WebSearch`, `WebFetch` | `Edit`, `Write`, `Bash` | Read-only exploration mode. Answers questions without modifying files. |
| `plan` | `plan` | `Read`, `Grep`, `Glob`, `WebSearch`, `WebFetch` | `Edit`, `Write`, `Bash` | Read-only mode designed to inspect and propose execution plans. |

---

## Key Functions Cheat Sheet

| File | Function | What it does |
|---|---|---|
| `src/cli.ts` | `createCli()` | Registers CLI commands and options using Commander.js. |
| `src/config/env.ts` | `requireApiKey()` | Validates environment and resolves auth token or API key. |
| `src/config/env.ts` | `checkEnvironment()` | Verifies Node.js version >= 18 and API key existence. |
| `src/agent/modes.ts` | `buildModeOptions(mode)` | Builds SDK `Options` object (model, env, tools, maxTurns) for a given mode. |
| `src/agent/modes.ts` | `parseCliMode(value)` | Parses and validates user mode input (`agent`, `ask`, `plan`). |
| `src/agent/permissions.ts` | `createCanUseTool(getMode)` | Returns a `CanUseTool` callback that blocks `Edit`/`Write`/`Bash` in `ask` and `plan` modes. |
| `src/agent/create-session.ts` | `createSession(mode)` | Initializes `InputQueue` and `Query` streaming handle for chat sessions. |
| `src/agent/input-queue.ts` | `InputQueue.push(content)` | Pushes a user prompt string into the SDK async message generator. |
| `src/agent/message-handler.ts` | `handleMessage(message, options)` | Formats and prints incoming SDK messages (`system`, `assistant`, `user`, `result`). |
| `src/agent/run-query.ts` | `runQuery(prompt, options)` | Executes a single-turn `query()` call and processes stream outputs. |
| `src/commands/chat.ts` | `startChat(options)` | Runs interactive REPL chat loop, handling prompts, slash commands, and graceful exit. |
| `src/ui/banner.ts` | `printBanner()` | Renders figlet ASCII art and boxed banner. |
| `src/ui/spinner.ts` | `startSpinner(text)` / `stopSpinner()` | Controls terminal loading spinner via `ora`. |

---

## Project Structure

```
node-cli/
├── src/
│   ├── index.ts              # CLI entry point
│   ├── cli.ts                # Commander CLI setup
│   ├── commands/
│   │   └── chat.ts           # Interactive chat REPL & slash commands
│   ├── config/
│   │   ├── constants.ts      # Modes, descriptions, slash command definitions
│   │   └── env.ts            # Environment checks & API key validation
│   ├── agent/
│   │   ├── create-session.ts # Session factory for streaming query
│   │   ├── input-queue.ts    # Async iterator mapping prompts to SDK user messages
│   │   ├── message-handler.ts# Renders SDK response stream to terminal
│   │   ├── modes.ts          # Options builder & permission modes
│   │   ├── permissions.ts    # Dynamic canUseTool permission enforcement
│   │   └── run-query.ts      # One-shot query runner
│   └── ui/
│       ├── banner.ts         # Figlet & Boxen banner renderer
│       ├── format.ts         # Chalk string styling utilities
│       └── spinner.ts        # Ora spinner helpers
├── package.json
├── tsconfig.json
└── .env                      # Environment settings
```

---

## Known Limits / Gotchas

- **Free Model Limits**: The default model (`poolside/laguna-s-2.1:free`) runs on OpenRouter's free tier, which can encounter rate limits (HTTP 429) or quota errors under heavy usage.
- **Session Constraints**: `BASE_OPTIONS` in `src/agent/modes.ts` caps maximum turns per query (`maxTurns: 25`) and budget limit (`maxBudgetUsd: 1.0`).
- **Tool Restriction Enforcement**: Changing mode mid-session via `/mode` updates SDK `permissionMode` and `canUseTool`, but initial `allowedTools` list is fixed when the underlying query process starts.
- **Package Manager Lock**: Enforced to `pnpm@12.10.1` in `package.json` (`devEngines`).

---

## Troubleshooting

1. **`Error: ANTHROPIC_API_KEY is not defined.`**  
   *Fix*: Add `OPENROUTER_API_KEY` or `ANTHROPIC_API_KEY` to your `.env` file.

2. **`Error: Node version must be >= 18`**  
   *Fix*: Upgrade your Node.js runtime to version 18.0.0 or higher.

3. **`npm error EBADDEVENGINES / Invalid name "pnpm"`**  
   *Fix*: Run commands using `pnpm` (v12.10.1+) instead of `npm` or `yarn`.

4. **`Error: Invalid mode: <val>. Use agent, ask, or plan.`**  
   *Fix*: Provide a valid mode parameter: `-m agent`, `-m ask`, or `-m plan`.

5. **`Tool '...' is disallowed in '...' mode.`**  
   *Fix*: Switch to `agent` mode using `/mode agent` to enable file editing and bash commands.

6. **`Context usage not available for this session`**  
   *Fix*: Wait for the session to finish initializing before executing `/context`.

---

## Development & Scripts

| Script | Command | Description |
|---|---|---|
| `pnpm dev` | `tsx src/index.ts` | Run CLI in development mode |
| `pnpm dev:watch` | `tsx watch src/index.ts` | Run CLI in watch mode |
| `pnpm build` | `tsc` | Compile TypeScript to `dist/` |
| `pnpm start` | `node dist/index.js` | Run compiled distribution build |

---

## Noticed While Documenting

- In `src/config/env.ts:L8`, `requireApiKey()` checks `process.env.ANTHROPIC_BASE_URL`, whereas `BASE_OPTIONS` in `src/agent/modes.ts:L18` defaults `env.ANTHROPIC_BASE_URL` to `"https://openrouter.ai/api"`.
- In `src/config/constants.ts:L7`, `MODE_DESCRIPTIONS.ask` contains a small typo: `"Ready only exploration..."` instead of `"Read only exploration..."`.
- In `src/agent/message-handler.ts:L55-L58`, there is a duplicate `break;` statement in `case "assistant":`.
