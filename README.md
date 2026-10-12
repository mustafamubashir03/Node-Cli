# Node CLI

An agentic coding CLI built on `@anthropic-ai/claude-agent-sdk`. Runs anywhere, like Claude Code.

![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-blue?style=flat-square)
![pnpm](https://img.shields.io/badge/pnpm-12.10.1-orange?style=flat-square)
![License](https://img.shields.io/badge/License-ISC-green?style=flat-square)

---

## Quick start

```bash
pnpm install
pnpm build
pnpm add -g .
```

The last command links this package globally so `node-cli` works from any directory.

```bash
node-cli wake-up
```

Banner, environment check, mode picker, then chat.

---

## Commands

| Command | Description |
|---|---|
| `wake-up` | Banner, environment check, mode picker, then chat |
| `chat [-m mode] [-v]` | Interactive streaming chat |
| `run <prompt> [-m mode] [-v]` | One-shot prompt |
| `talk <prompt> [-v]` | One-shot prompt in agent mode |
| `doctor` | Check Node version and credentials |
| `banner` | ASCII banner |
| `help` | Show CLI help |

Flags: `-m, --mode <agent|ask|plan>` (default `agent`), `-v, --verbose`.

### Slash commands

| Command | Description |
|---|---|
| `/mode <agent\|ask\|plan>` | Switch mode mid-session |
| `/context` | Token usage for the session |
| `/help` | List slash commands |
| `/clear` | Clear the terminal |
| `/exit` | Shut down and exit |

---

## Modes

| Mode | Permission mode | Tools | Turns | Behaviour |
|---|---|---|---|---|
| `agent` | `default` | Read, Grep, Glob, WebSearch, WebFetch, Edit, Write, Bash | 25 | Full loop, asks before every write |
| `ask` | `dontAsk` | Read, Grep, Glob, WebSearch, WebFetch | 6 | Read-only answers |
| `plan` | `plan` | Read, Grep, Glob, WebSearch, WebFetch | 6 | Read-only, proposes a plan |

`Agent`, `Task`, `SendMessage`, `ScheduleWakeup`, cron tools, `TodoWrite`, `NotebookEdit`,
`Skill`, `SlashCommand`, `ExitPlanMode`, `KillShell` and `BashOutput` are disallowed in every mode.

---

## Configuration

Credentials are read from the first file that defines them:

1. `.env` in the current directory
2. `~/.node-cli.env`
3. `.env` next to the installed package

Set your key once, globally:

```bash
cp .env ~/.node-cli.env
```

| Variable | Purpose | Default |
|---|---|---|
| `OPENROUTER_API_KEY` | OpenRouter key | — |
| `ANTHROPIC_API_KEY` | Key for the `BASE_URL` you point at | — |
| `ANTHROPIC_BASE_URL` | Custom endpoint (Ollama, proxy) | `https://openrouter.ai/api` |
| `ANTHROPIC_AUTH_TOKEN` | Auth for a custom base URL | — |
| `AGENT_MODEL` | Primary model | `poolside/laguna-s-2.1:free` |

### Ollama

```env
ANTHROPIC_BASE_URL="http://localhost:11434"
ANTHROPIC_AUTH_TOKEN="ollama"
AGENT_MODEL="llama3"
```

When `ANTHROPIC_BASE_URL` is set, `requireApiKey()` accepts `"ollama"` as the token, so no real
Anthropic key is needed.

---

## Architecture

```
src/
├── index.ts              entry point, shebang, calls createCli()
├── cli.ts                registers commands with Commander
├── commands/
│   ├── wake-up.ts        banner, doctor, mode picker, then chat
│   └── chat.ts           the chat loop, slash commands, drainUntilResult
├── agent/
│   ├── modes.ts          MODES table, SDK options, PreToolUse guard
│   ├── create-session.ts builds the query, recreates it when tools must widen
│   ├── input-queue.ts    turns typed lines into SDK user messages
│   ├── permissions.ts    canUseTool: mode check plus y/N confirmation
│   ├── message-handler.ts prints SDK messages, holds output during prompts
│   └── run-query.ts      one-shot prompt
├── config/
│   ├── env.ts            dotenv chain, requireApiKey, checkEnvironment
│   └── constants.ts      re-exports mode labels, slash command list
└── ui/
    ├── banner.ts         figlet + boxen
    ├── format.ts         chalk styles, truncate
    └── spinner.ts        ora start/stop/suspend/resume
```

### How a turn flows

1. `startChat()` reads a line with Inquirer and pushes it to `InputQueue`.
2. `InputQueue.generator()` hands the message to the SDK subprocess.
3. The model replies. `drainUntilResult()` pulls messages until a `result` arrives.
4. For each `tool_use`, the SDK calls `canUseTool`.
5. `permissions.ts` denies anything outside the mode, then asks `[y/N]` in agent mode.
6. `message-handler.ts` prints tool calls, tool results and the final answer.
7. The loop returns to the prompt.

### Four things worth knowing

**Tools are fixed when a query starts.** The SDK exposes no `setTools`, so a session started in
`ask` can never gain `Write`. `needsRecreation()` detects this and `/mode agent` rebuilds the
query with `resume`, keeping the conversation. Narrowing (agent to ask) needs no restart: the
PreToolUse hook denies the extra tools.

**Never iterate the query with `for await`.** `Query[Symbol.asyncIterator]()` returns a generator
whose `finally` calls `cleanup()`. Breaking out of a `for await` loop calls `.return()` on it,
which sets `cleanupPerformed` and closes the transport, so later `setPermissionMode` calls reject
with `Query closed before response received`. `drainUntilResult()` drives `.next()` manually and
returns without closing, which keeps the session alive across turns.

**Inquirer leaves stdin paused.** Adding a `data` listener to an already paused stream that still
has one does not resume it, so `confirmWithUser` calls `stdin.resume()` explicitly. It also stops
the spinner and holds SDK output, otherwise ora redraws over the prompt.

**Tool results arrive as `user` messages with `parent_tool_use_id: null`.** They are found by
looking for a `tool_result` content block, not by the parent id.

### Safety model

| Layer | Mechanism | Covers |
|---|---|---|
| Prompt surface | `tools` | Hides tools from the model, shrinking context |
| Name deny list | `disallowedTools` | Blocks irrelevant built-ins |
| Hook | `PreToolUse` | Denies tools outside the mode, cannot be shadowed |
| Callback | `canUseTool` | Asks before Edit, Write, Bash in agent mode |
| Budget | `maxTurns`, `maxBudgetUsd` | Caps runaway turns and spend |

`settingSources: []` keeps user and project settings, skills and hooks off disk from adding
allow rules that would override the above.

---

## Scripts

| Script | Command |
|---|---|
| `pnpm dev` | `tsx src/index.ts` |
| `pnpm dev:watch` | `tsx watch src/index.ts` |
| `pnpm build` | `tsc` |
| `pnpm start` | `node dist/index.js` |
| `pnpm test` | `tsx --test "src/**/*.test.ts"` |
| `pnpm typecheck` | `tsc --noEmit` |

---

## Troubleshooting

**`ANTHROPIC_API_KEY is not defined`** — `cp .env ~/.node-cli.env`.

**`EBADDEVENGINES` / `Invalid name "pnpm"`** — use pnpm, not npm or yarn.

**`Invalid mode`** — use `agent`, `ask` or `plan`.

**Tool disallowed in this mode** — `/mode agent`.

**Free model rate limits** — the default model runs on OpenRouter's free tier.

**Mode switch restarts the session** — expected when widening tools; history is resumed.

---

## Requirements

Node.js >= 18, pnpm >= 12.10.1. `pnpm@12.10.1` is pinned in `package.json`.