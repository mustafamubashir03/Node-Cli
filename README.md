# Node CLI

Node CLI is an AI-powered coding assistant that runs in your terminal. Think of it as a smart assistant you can talk to about your code — it can read files, make edits, run commands, search the web, and help you plan and build software projects.

You interact with it through a chat-like interface. You type what you want to do, and it figures out which actions to take, asking your permission before making changes to your files.

---

## How to install and start

### What you need

- **Node.js** version 18 or newer
- **pnpm** version 12.10.1 or newer

### Install

1. Download or clone this project.
2. Open a terminal in the project folder and run:

   ```bash
   pnpm install
   pnpm build
   pnpm add -g .
   ```

   The last command makes the `node-cli` command available from anywhere on your computer.

3. Start the assistant:

   ```bash
   node-cli wake-up
   ```

   You'll see a banner, an environment check, and a menu to pick a mode. Then you can start chatting.

### Set up your AI key

Node CLI needs an AI model to generate responses. The easiest way is to get a free API key from [OpenRouter](https://openrouter.ai):

1. Create an account at OpenRouter and generate an API key.
2. Run `node-cli setup` and follow the prompts, or create a file named `.env` in the project folder with:

   ```
   OPENROUTER_API_KEY=your_key_here
   ```

3. Run `node-cli wake-up` again.

---

## How to use the main features

### Start a chat

```bash
node-cli wake-up
```

Pick a mode (see below), then type your request. For example:

- "Read the files in my project and explain how they're organized."
- "Fix the bug in src/utils.js where the date format is wrong."
- "Create a new file called hello.html with a simple page."
- "Check if https://example.com loads without errors."

### Send a one-shot prompt

If you just want a quick answer without starting a full chat:

```bash
node-cli run "Explain how to center a div in CSS"
node-cli talk "Create a todo list page with HTML and CSS"
```

`run` lets you pick a mode; `talk` always uses the full editing mode.

---

### Switch modes mid-chat

While chatting, type:

- `/mode agent` — Full editing mode (default).
- `/mode ask` — Read-only answers; no file changes.
- `/mode plan` — Read-only planning; proposes steps without editing.
- `/mode strict` — Full editing, but asks for approval on every change.

### Other useful slash commands

Type any of these while in a chat:

- `/help` — List all available commands.
- `/model` — Switch the AI model (shows free options from OpenRouter).
- `/skills` — Manage AI skills that add specialized knowledge.
- `/memory` — Save and recall notes across conversations.
- `/qa <url>` — Check a web page for loading problems.
- `/exit` — Quit the chat.

## Working modes explained

| Mode | What it can do | Best for |
|------|---------------|----------|
| **Agent** | Read files, edit files, run commands, search the web | General coding help, building features, fixing bugs |
| **Strict** | Same as agent, but asks before every single change | When you want to review everything before it happens |
| **Ask** | Read files and search, but cannot edit or run commands | Getting explanations, learning how code works |
| **Plan** | Read files and search, proposes a plan without editing | Figuring out what to build before making changes |

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