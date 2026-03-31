# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

pi-config — Supervisor-managed subagent orchestration for Pi. Spawns agents in tmux with automatic stall detection, respawn, and scoped delegation chains.

## Architecture

This is a **Pi package** (superpower) that provides:

- **Supervisor extension** (`extensions/supervisor.ts`) — The core runtime. Registers 10 tools (`supervisor-spawn`, `supervisor-check`, `supervisor-wait`, `supervisor-status`, `supervisor-kill`, `supervisor-send`, `supervisor-merge`, `supervisor-run`, `supervisor-logs`, `supervisor-prune`), manages a registry at `.pi/supervisor/registry.json`, and runs a background poll loop (every 5s) that detects idle agents and respawns them with augmented prompts.

- **Agent definitions** (`agents/`) — Five specialist agents: `worker` (Sonnet, implements tasks), `scout` (Haiku, read-only recon), `planner` (Opus, interactive planning), `reviewer` (Opus, code review), and `asker` (Sonnet, background question answering). Each is a markdown file with frontmatter defining model, tools, and behavior. Agents with `spawning: true` can delegate to other agents; `spawning: false` agents have spawn tools denied via `PI_DENY_TOOLS`.

- **Skills** (`skills/`) — 12 skills scoped per agent role:
  - `supervisor` — orchestration tools and delegation chain docs
  - `brainstorming`, `writing-plans`, `plan-then-do` — planner skills
  - `commit`, `tdd`, `debugging`, `root-cause-review` — worker skills
  - `learn-codebase` — scout skill
  - `code-review` — reviewer skill
  - `config-update` — merge-safe settings and hook config updates
  - `ask` — background question-answering skill that delegates to a subagent and returns only the final answer

- **Session hook** (`hooks/`) — Injects the supervisor skill at session start so it's always available.

### Delegation Chain

```
planner (opus) ──spawns──→ worker (sonnet) ──spawns──→ scout (haiku)
    │                           │
    ├── spawns scout            ├── spawns planner (re-plan)
    └── spawns reviewer (opus)  └── spawns scout (context)
```

Scouts and reviewers cannot spawn — they're read-only agents that write artifact files and exit.

### Key Patterns

- **Tmux visibility**: `foreground` creates a split pane in the current session; `background` creates a window in a dedicated `pi-supervisor-bg` session.
- **Idle detection**: Supervisor hashes backlog output every 5s. If no change for `idleTimeoutSecs` (default 120s), it kills and respawns.
- **Respawn prompt augmentation**: Failed attempts' last output is included in the retry prompt so the agent tries a different approach.
- **Registry locking**: File-based lock with 10s timeout, auto-reap stale locks >30s (pattern from pi-side-agents).
- **Scoped skills**: Each agent loads only its relevant skills via `--skill` flags in the launch script. Skills are resolved from agent frontmatter.
- **PI_DENY_TOOLS**: Agents with `spawning: false` have `supervisor-spawn`, `supervisor-run`, `supervisor-kill`, `supervisor-send`, `supervisor-merge` denied.
- **Atomic exit files**: Launch scripts write exit.json via temp file + `mv` to prevent partial reads.
- **Lock metadata**: Lock files include pid, ppid, hostname for cross-machine safety.
- **Git worktrees**: Workers get their own worktree at `../<repo>-sv-worktree-NNNN/` for file isolation, enabling parallel execution.
- **Artifact system**: Agents communicate through files in `.pi/supervisor/artifacts/<agentId>/` (context.md, plan.md, review.md). Phase-oriented skills should prefer stable artifact names like `plans/YYYY-MM-DD-<slug>.md`, `context/<slug>-scout-<timestamp>.md`, `reviews/<slug>-plan-review-<timestamp>.md`, and `diagnostics/YYYY-MM-DD-<slug>.md`. Delegated work should prefer artifact-backed handoff over long conversational summaries.

### Runtime State

All state lives in the project's `.pi/supervisor/` directory:
- `registry.json` — Agent records with status, timing, attempt history
- `registry.lock` — Write protection
- `runtime/<agentId>-attempt-<N>/` — Per-attempt: `kickoff.md`, `backlog.log`, `exit.json`, `launch.sh`
- `artifacts/<agentId>/` — Agent output artifacts (plan.md, context.md, review.md)

## Peer Dependencies

This package runs inside the Pi ecosystem. TypeScript diagnostics about missing modules (`@mariozechner/pi-coding-agent`, `@sinclair/typebox`, `node:*`) are expected — they resolve at runtime via peer dependencies.

## Reference Projects

When you need to understand how something works, check patterns, or look for implementation examples, consult these sibling projects under `~/.local/share/`:

- **`~/.local/share/pi-side-agents`** — Parallel agents in tmux + git worktrees. The tmux management, registry locking, and launch script patterns in our extension are derived from `extensions/side-agents.ts`.
- **`~/.local/share/pi-config`** — Personal Pi agent config with agent definitions, skills, and extensions. Our agent definitions follow the same frontmatter format.
- **`~/.local/share/pi-interactive-subagents`** — Interactive subagent spawning with multiplexer abstraction. Reference for the subagent tool interface and `PI_DENY_TOOLS` pattern.
- **`~/.local/share/superpowers`** — Composable skills library. Our package structure (skills/, hooks/, package.json with `pi.extensions` and `pi.skills`) follows this pattern.
- **`~/.local/share/pi-mono`** — The Pi monorepo containing `pi-coding-agent`, `pi-ai`, `pi-agent-core`, etc.
- **`../pi-provider-kiro`** — Kiro API provider for Pi. All agent models use the `kiro/` prefix (e.g. `kiro/opus-4-6`, `kiro/sonnet-4-6`, `kiro/haiku-4-5`). Free models via AWS CodeWhisperer/Q OAuth.
- **`~/.local/share/tmux/tmux_code`** — Tmux source code. Reference for understanding tmux internals when debugging pane/window/session management (e.g. `cmd-split-window.c`, `cmd-pipe-pane.c`, `cmd-send-keys.c`, `cmd-capture-pane.c`).
