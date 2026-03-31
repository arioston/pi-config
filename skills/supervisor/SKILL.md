---
name: supervisor
description: "Use when delegating tasks to subagents. Manages spawning, monitoring, and automatic respawn of stalled agents in tmux sessions."
---

# Supervisor Orchestration

You have access to a supervisor system that spawns, monitors, and manages subagents running in tmux. The supervisor automatically detects stalled agents and respawns them with augmented prompts.

## Tools

### `supervisor-spawn`
Spawn a new subagent in tmux. Workers get their own git worktree for isolation.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `task` | yes | — | Clear, complete task description |
| `agent` | yes | — | Agent type: `worker`, `scout`, `planner`, `reviewer` |
| `visibility` | no | `background` | `foreground` or `background` |
| `idleTimeoutSecs` | no | `120` | Stall detection threshold. Set `0` to disable. |
| `maxAttempts` | no | `3` | Maximum spawn attempts before giving up |

### `supervisor-check`
Check a single agent's status and recent backlog output.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `agentId` | yes | Agent or process ID |

### `supervisor-wait`
Block until any of the given agents reach terminal status (done/failed/crashed/killed).

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `ids` | yes | — | Array of agent IDs to wait for |
| `timeoutSecs` | no | `300` | Timeout in seconds |

### `supervisor-status`
List all tracked agents/processes with status, elapsed time, and recent output.

### `supervisor-kill`
Kill an agent or process by ID.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `agentId` | yes | Agent ID to kill |

### `supervisor-send`
Send a message to a running agent's tmux pane.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `agentId` | yes | Target agent ID |
| `message` | yes | Text to send |

### `supervisor-merge`
Merge a completed worker's branch back to the current branch.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `agentId` | yes | — | Agent whose branch to merge |
| `strategy` | no | `merge` | `merge` (fast-forward) or `rebase` |

### `supervisor-attach`
Switch to (or show) an agent's tmux pane for direct interaction.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `agentId` | yes | Agent or process ID |

### `supervisor-run`
Run a raw shell command in tmux. No stall detection — just lifecycle tracking.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `command` | yes | — | Shell command (supports pipes, redirects) |
| `name` | yes | — | Display name / ID |
| `visibility` | no | `background` | `foreground` or `background` |
| `cwd` | no | project root | Working directory |

### `supervisor-logs`
Tail or search an agent/process's backlog.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `agentId` | yes | — | Agent or process ID |
| `lines` | no | `50` | Lines to tail |
| `grep` | no | — | Case-insensitive filter |

### `supervisor-prune`
Clean up old worktrees, artifacts, and runtime dirs for agents no longer tracked.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `ageHours` | no | `24` | Only prune entries older than this |

## Delegation Chain

Agents form a scoped chain — each can only delegate to specific other agents:

| Agent | Can Delegate To | Hard Boundary |
|-------|----------------|---------------|
| **planner** | worker, scout, reviewer | MUST NOT write production code |
| **worker** | planner, scout | MUST NOT redesign or expand scope |
| **scout** | nobody | MUST NOT modify files |
| **reviewer** | nobody | MUST NOT fix code |

Scouts and reviewers have spawn/kill/send/run/merge denied via `PI_DENY_TOOLS`. They can still use check/wait/status/logs (read-only).

## Artifact System

Agents communicate through files in `.pi/supervisor/artifacts/<agentId>/`:

- **Scout** writes `context.md`
- **Planner** writes `plan.md`
- **Reviewer** writes `review.md`
- **Worker** may write supporting handoff/context artifacts when needed, but should not rely on chat alone

The artifact directory is absolute (in the main repo's `.pi/`) so all agents can access it regardless of worktree location.

Prefer stable, phase-oriented names when work spans multiple steps:
- `plans/YYYY-MM-DD-<slug>.md`
- `context/<slug>-scout-<timestamp>.md`
- `reviews/<slug>-plan-review-<timestamp>.md`
- `diagnostics/YYYY-MM-DD-<slug>.md`

When spawning, include artifact paths in the task:
```
supervisor-spawn(task: "Review changes. Plan at .pi/supervisor/artifacts/plan-auth/plan.md", agent: "reviewer")
```

## Worktrees

Workers automatically get a git worktree at `../<repo>-sv-worktree-NNNN/` with branch `supervisor/<agentId>-attempt-<N>`. This enables parallel execution — multiple workers run simultaneously without file conflicts.

After a worker finishes, use `supervisor-merge` to bring its changes back.

## Example Orchestration Flow

```
1. Planner spawns scout → supervisor-wait([scout-id])
2. Scout writes context.md, exits
3. Planner reads context.md, writes plan.md
4. Planner spawns 3 workers in parallel (each gets own worktree)
5. Planner calls supervisor-wait([worker-a, worker-b, worker-c])
6. As each finishes → supervisor-merge(agentId) then spawn reviewer
7. Reviewer writes review.md → planner reads it
8. If issues → new worker to fix; if clean → next task
9. All done → supervisor-prune() to clean up
```

## Session Resilience

**Foreground panes die with your terminal.** If your tmux session disconnects or crashes, any agents running in foreground split panes are killed.

**Background agents survive.** Agents in the `pi-supervisor-bg` session persist across parent terminal crashes. Always use `background` for long-running agents (planners, workers).

**On session restart**, the supervisor immediately scans the registry and detects crashed agents. Use `supervisor-status` to see what survived and what didn't.

**To reconnect** to a running background agent: `supervisor-attach(agentId: "my-agent")` switches your terminal to its tmux session.

**To resume a crashed agent**: Use `supervisor-spawn` with the same task — it will create a new agent. If the original had artifacts, reference them in the new task.

## Idle Detection

The supervisor polls every 5s and hashes each agent's recent output:
- If no new output for `idleTimeoutSecs` (default 120s) → marked **stalled**
- Stalled agents killed and respawned with augmented prompt (up to `maxAttempts`)
- Set `idleTimeoutSecs: 0` to disable (useful for long compilations or silent agents)
- Processes (`supervisor-run`) never get stall-detected

## Process Management

Use `supervisor-run` for dev servers, build watchers, test runners:
```
supervisor-run(command: "PORT=3002 yarn dev", name: "dev-server", cwd: ".worktrees/feature-auth")
supervisor-logs(agentId: "dev-server", grep: "compiled")
```

## Delegation Guidelines

**Spawn a subagent for:**
- Implementation tasks ready to execute
- Code review of recent changes
- Codebase reconnaissance
- Planning sessions
- Reusable diagnostic or context work that should survive beyond the current chat turn

**Do NOT spawn for:**
- Quick fixes (< 2 minutes)
- Simple questions
- Single-file changes with obvious scope
