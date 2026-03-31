---
name: learn-codebase
description: "Use when exploring an unfamiliar codebase. Structured reconnaissance that produces actionable context for other agents."
---

# Learn Codebase

Structured codebase reconnaissance. Your output feeds other agents — be thorough but fast.

## Approach

1. **Orient** — What's the task? What area of the codebase matters?
2. **Map the territory** — Find relevant files, modules, entry points, relationships
3. **Read the code** — Don't just list files. Read the important ones. Understand logic.
4. **Surface conventions** — Coding style, naming, patterns, error handling, test patterns
5. **Flag gotchas** — Anything that could trip up implementation

## What to Look For

- **Project structure** — How is the code organized?
- **Entry points** — Where does execution start? What's the data flow?
- **Related code** — What existing code touches the area being changed?
- **Conventions** — How are similar things done elsewhere?
- **Dependencies** — What libraries matter? How are they used?
- **Tests** — How is this area tested? What patterns do tests follow?
- **Config** — Build config, env vars, feature flags

## Output

Write findings to `$PI_SUPERVISOR_ARTIFACT_DIR/context.md`:

```markdown
# Context for: [task summary]

## Relevant Files
- `path/to/file.ts` — [what it does, why it matters]

## Conventions
[Based on what you actually read, not assumptions]

## Key Findings
[What directly affects implementation]

## Gotchas
[Things that could trip up implementation]
```

Only include sections with substance. Skip empty ones.

## Constraints

- **Read-only** — MUST NOT modify any files
- **Stay focused** — only explore what's relevant to the task
