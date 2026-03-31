# Architecture

## Overview

pi-config is a Pi package that replaces in-session task execution with supervisor-managed subagents running in tmux. The supervisor monitors agents for stalls and automatically retries with augmented prompts.

## Components

### Supervisor Extension (`extensions/supervisor.ts`)

The single extension file implements everything:

1. **Registry** — JSON file at `.pi/supervisor/registry.json` with file-lock protection. Tracks all agents with their status, timing, attempt history, and tmux targets.

2. **Tmux Layer** — Two visibility modes:
   - **Foreground**: `tmux split-window` in the current session (visible to user)
   - **Background**: window in a dedicated `pi-supervisor-bg` session (hidden)

3. **Supervisor Loop** — `setInterval` at 5s that:
   - Reads each running agent's backlog
   - Hashes output to detect new content
   - Marks stalled agents (no new output for `idleTimeoutSecs`)
   - Kills stalled agents and respawns with augmented prompt
   - Detects crashed agents (tmux target gone, no exit marker)
   - Updates statusline

4. **Tools** — Four tools exposed to the agent:
   - `supervisor-spawn` — Create new supervised agent
   - `supervisor-status` — List all agents with details
   - `supervisor-kill` — Manual termination
   - `supervisor-send` — Send message to running agent

### Agent Definitions (`agents/`)

Markdown files with YAML frontmatter. Each defines a specialist role:

| Agent | Model | Auto-exit | Purpose |
|-------|-------|-----------|---------|
| worker | Sonnet 4.6 | yes | Implementation |
| scout | Haiku 4.5 | yes | Read-only reconnaissance |
| planner | Opus 4.6 | no | Interactive planning |
| reviewer | Opus 4.6 | yes | Code review |

### Respawn Strategy

When a stalled agent is killed:

1. Previous attempt's last ~50 lines of output are captured
2. A new prompt is built:
   ```
   # Task (Retry Attempt #N)
   Previous attempts stalled. Try a DIFFERENT approach.

   ## Previous Attempt #1 (ran for 95s, ended: idle_timeout)
   Last output before stall:
   [captured output]

   ---
   ## Original Task
   [original task text]
   ```
3. New tmux pane/window is created with same visibility setting
4. Agent runs with fresh context but awareness of what failed

Each attempt gets its own runtime directory (`runtime/<id>-attempt-<N>/`) so all backlogs are preserved for debugging.

## State Layout

```
.pi/supervisor/
├── registry.json           # Agent records
├── registry.lock           # Write protection
└── runtime/
    ├── fix-auth-attempt-1/
    │   ├── kickoff.md      # Task prompt
    │   ├── backlog.log     # Tmux pane output
    │   ├── exit.json       # Exit code + timestamp
    │   └── launch.sh       # Generated launcher
    └── fix-auth-attempt-2/
        └── ...
```
