---
name: writing-plans
description: "Use after brainstorming is complete. Breaks validated designs into bite-sized, independently implementable tasks."
---

# Writing Plans

Turn a validated design into a concrete implementation plan with independently executable tasks.

## When to Use

After brainstorming has produced a validated design. Never skip brainstorming to jump straight to planning.

## Plan Structure

Write the plan to your artifact directory (`$PI_SUPERVISOR_ARTIFACT_DIR/plan.md`):

```markdown
# [Plan Name]

**Date:** YYYY-MM-DD
**Status:** Draft

## Overview
[What we're building and why — 2-3 sentences]

## Approach
[High-level technical approach]

### Key Decisions
- Decision 1: [choice] — because [reason]

## Tasks

### Task 1: [title]
- **Files:** path/to/create.ts, path/to/modify.ts
- **What:** [exact description with code blocks]
- **Verify:** [how to confirm it works]
- **Depends on:** none

### Task 2: [title]
- **Files:** ...
- **Depends on:** Task 1
```

## Task Quality Rules

Each task MUST be:
- **Bite-sized** — 2-5 minutes of work
- **Independent** — a worker picks it up without reading other tasks
- **Complete** — includes exact file paths, code blocks, and verification steps
- **No placeholders** — no "TBD", "TODO", "implement later", "similar to Task N"
- **No vague instructions** — no "add appropriate error handling" or "write tests for the above"

## Parallel Awareness

Mark tasks that can run in parallel (no shared file dependencies) vs tasks that must be sequential. This lets the orchestrator spawn multiple workers simultaneously.

## After Writing

Present the plan for review: "Plan written to [path]. Ready to execute, or anything to adjust?"
