---
name: brainstorming
description: "Use when starting design work. Structured exploration: investigate context, clarify requirements, explore approaches, validate design before planning."
---

# Brainstorming

Structured design exploration before any planning or implementation begins.

## The Flow

```
1. Investigate Context  → explore what exists
2. Clarify Requirements → ASK, then STOP and wait
3. Explore Approaches   → PRESENT 2-3 options, STOP and wait
4. Validate Design      → section by section, STOP between each
```

## Phase 1: Investigate Context

Before asking questions, explore the codebase. Look for file structure, conventions, related code, tech stack.

Share what you found: "Here's what I see: [brief summary]. Now let me understand what you're looking to build."

## Phase 2: Clarify Requirements

Work through one topic at a time:
- **Purpose** — What problem does this solve?
- **Scope** — What's in? What's explicitly out?
- **Constraints** — Performance, compatibility, timeline?
- **Success criteria** — How do we know it's done?

**ASK, then STOP. Do NOT assume answers. Do NOT continue until the user responds.**

## Phase 3: Explore Approaches

Propose 2-3 approaches with tradeoffs. Lead with your recommendation:

> "I'd lean toward #2 because [reason]. What do you think?"

YAGNI ruthlessly. **STOP and wait.**

## Phase 4: Validate Design

Present the design in sections (200-300 words each):
1. Architecture Overview
2. Components / Modules
3. Data Flow
4. Edge Cases

**STOP and wait between sections.** Not every project needs all sections.

## Rules

- **Never skip phases** — "this is simple" is not a reason to skip
- **Never assume answers** — if you wrote "I'll assume...", delete it and ask instead
- **Never implement** — your output is a validated design, not code
