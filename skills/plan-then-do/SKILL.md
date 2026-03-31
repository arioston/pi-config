---
name: plan-then-do
description: "Use for implementation requests that should follow a plan-first workflow with optional scout/review phases before execution."
---

# Plan Then Do

A structured implementation workflow that keeps planning, review, and execution separate.

## Goal

Turn an implementation request into the smallest safe execution flow:
- plan first
- gather context only when needed
- review before execution only when risk justifies it
- hand off to a worker with artifact-backed context

## Modes

Choose the smallest mode that fits the task.

### Small
Use when the task is tightly scoped and obvious:
- single-file or very small multi-file change
- clear acceptance criteria
- low risk of architecture drift

Flow:
1. Write a compact plan artifact
2. Stop and ask whether to execute

### Medium
Use when the task spans multiple files or non-trivial verification:
- feature/fix with clear scope
- some codebase context needed
- implementation should still be straightforward

Flow:
1. Write plan artifact
2. Optionally gather one scout artifact if context is missing
3. Stop and ask whether to execute

### Large / Risky
Use when the task is ambiguous, architectural, or likely to churn:
- unclear boundaries
- multiple systems involved
- bug has hidden causes
- review before coding would reduce waste

Flow:
1. Write plan artifact
2. Gather scout context artifact(s)
3. Optionally request plan review
4. Stop and ask whether to execute

## Output Contract

Write artifacts with stable names:
- `plans/YYYY-MM-DD-<slug>.md` — required
- `context/<slug>-scout-<timestamp>.md` — optional scout findings
- `reviews/<slug>-plan-review-<timestamp>.md` — optional plan review
- `context/<slug>-execution-handoff-<timestamp>.md` — execution handoff for worker

## Plan Requirements

The plan artifact must include:
- task summary
- selected mode (`small`, `medium`, or `large`)
- files likely to change
- verification steps
- explicit risks or open questions
- recommended next action

## Execution Handoff

If the user asks to continue into execution, the handoff must give the worker:
- the exact artifact path(s) to read
- explicit cwd / worktree context if known
- the concrete task slice to implement
- verification expectations

Do **not** rely on chat history alone for the handoff.

## Rules

- Default to the smallest useful mode.
- Do not force scout/review phases for trivial work.
- Do not auto-implement after writing the plan unless the user asked for execution.
- Prefer artifacts over long conversational summaries.
- If the task starts looking ambiguous or churn-prone, escalate to `root-cause-review` or a larger planning mode.
