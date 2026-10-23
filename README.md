# pi-blocks

Compose a development workflow out of small reusable **blocks** in a TUI, then run it. One command: `/wb`.

```
╭─ Workflow build · 3 steps ──────────────────────────────────────╮
│ 1 Research  →  2 Plan  →  3 Implement                           │
╰─────────────────────────────────────────────────────────────────╯
 Available 10  type to filter
  [research] Research  Gather the facts - code, docs, history, constraints
▸ [plan] Plan  Turn the request into ordered, verifiable steps
  [implement] Implement  Make the change with a minimal, focused diff
  [test] Test  Run the decisive checks once and report honestly
  [debug] Debug  Reproduce, then fix the root cause
  [review] Review  Critique the change as an unfriendly reviewer
  [branch] Branch  Create a fresh branch for the work
  [commit] Commit  Group the working tree into short, coherent commits
  [pr] PR  Open a pull request that explains itself
  [hunt] Hunt  Locate the root cause of a bug without fixing it

 ↑↓ move · ⏎ add · ⌫ undo · tab edit steps · ctrl+r run · ctrl+s save+run · esc cancel
```

A block is an action in the development phase: research, plan, hunt, implement, test, debug, review, branch, commit, open a PR. Each one is a markdown file with frontmatter, so adding a phase is writing a file — no code.

## Install

```bash
pi install ./pi-blocks          # from a local checkout
pi install npm:pi-blocks        # once published
pi -e ./pi-blocks               # try it for one session
pi -e ./pi-blocks/src/index.ts  # or load the extension file directly
```

## Use

| Command | What it does |
|---|---|
| `/wb` | Compose a workflow and run it |
| `/wb <goal>` | Compose, with a stated goal handed to every step |
| `/wb run <name>` | Run a saved workflow, optionally `/wb run <name> <goal>` |
| `/wb edit <name>` | Load a saved workflow back into the composer |
| `/wb save <name>` | Save the last composed or running workflow (project `.pi/workflows`) |
| `/wb list` / `/wb rm <name>` | List or delete saved workflows |
| `/wb blocks` | List every block with where it came from |
| `/wb new <id>` | Scaffold a block file in `.pi/blocks` |

In the composer:

| Key | Action |
|---|---|
| `↑` `↓` | Move in the available list |
| `⏎` | Add the highlighted block. Cursor stays put, so pressing `⏎` again adds it twice |
| `⌫` | With an empty filter: remove the last step. Otherwise: edit the filter |
| type | Fuzzy-filter the available list (`esc` clears it) |
| `tab` | Switch to the step list: `↑↓` select, `ctrl+↑↓` reorder, `x` remove |
| `ctrl+r` | Run the workflow |
| `ctrl+s` | Name it, save it, then run |

## Blocks

A block is a markdown file. The frontmatter is flat scalars only:

```markdown
---
id: plan
name: Plan
description: Turn the request into ordered, verifiable steps
category: think
order: 20
---

You are in the PLANNING phase. Make no changes to any file.

- Number the steps in the order they must happen ...
- Name the files to create, change, or delete for each step.
```

| Field | Required | Notes |
|---|---|---|
| `id` | no | Defaults to the file name. Used in workflows and on the command line |
| `name` | no | Display name. Defaults to a title-cased id |
| `description` | no | One line shown in the composer |
| `category` | no | Grouping label; `/wb blocks` lists by category |
| `order` | no | Sort weight; lower comes first (default `100`) |

The body is the instruction the agent receives. Blocks are read from three places, later ones overriding earlier ones by `id`:

| Source | Directory |
|---|---|
| Bundled | `blocks/` inside this package |
| Global | `~/.pi/agent/blocks/*.md` |
| Project | `<cwd>/.pi/blocks/*.md` |

Bundled: `research`, `plan`, `hunt`, `implement`, `debug`, `test`, `review`, `branch`, `commit`, `pr`.

Blocks are plain instructions, so they can point at anything else the session has: "if a review skill is available, follow it", "use the project's commit conventions". Nothing special is needed — write it in the body.

## How a workflow runs

Selected blocks run **one at a time, each as its own agent turn**. When a step settles, the next step starts automatically; Pi issues exactly one more model request per step.

Between steps the context is **handoff-based**, not cumulative:

- Each step is asked to end with a `## Handoff` section (what it decided, changed, verified). If it forgets, the tail of its final message is used instead.
- The next step sees only: a durable workflow contract (the chain, the current step, the accumulated handoffs) plus the current step's instructions and its own work. The earlier transcript is filtered out of the model context, while the TUI keeps showing everything.
- The contract lives in a system-prompt section, so compaction mid-workflow cannot make the agent forget which step it is on; the current step's instructions are re-injected if compaction drops them.

A workflow of `research → plan → implement → test` therefore behaves like four fresh, connected sessions rather than one long conversation. When a run finishes, filtering stops and the full transcript is available again.

Stop at any point with `esc`: the run is marked aborted and never advances.

## Limits worth knowing

- **No per-block tool or model restrictions.** A block is instructions; it cannot stop the agent from using `write` during a "research" step. Phase boundaries are enforced by wording and by the step contract.
- **Print mode cannot start a workflow.** `pi -p "/wb run x"` is refused: a command cannot open a follow-up turn there. Interactive and RPC sessions are fine.
- **Composer requires the TUI.** `/wb run`, `/wb list`, `/wb blocks` and the other subcommands work without it; only composition needs the terminal UI.
- **One run at a time** per session. Starting a run while the agent is streaming is refused.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # node --test test/*.test.ts
npm run check       # both
```

`node_modules` is dev-only. Pi supplies `@earendil-works/pi-*` at runtime; the pinned `@earendil-works/pi-codemode@1.1.0` devDependency only exists so plain `node` can import the host package in tests.

The suite is hermetic: it loads the real bundled blocks but writes nothing outside a temp directory. The extension takes its agent directory as an optional second argument (`piBlocks(pi, { agentDir })`) so tests never touch `~/.pi`.

The one thing unit tests cannot see is a real terminal. `test/manual/tui-smoke.exp` drives the actual TUI with `expect` — composer, filter keys, and a two-step run — and prints `PASS` or `FAIL`. It needs a model you are willing to call (a local OpenAI-compatible server is ideal) and a scratch directory of trivial blocks; the header of that script has the exact setup.
