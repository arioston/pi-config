---
name: root-cause-review
description: "Use when fixes are churning or the user asks for root cause before more edits. Produces a diagnostic artifact, not code changes."
---

# Root Cause Review

Diagnose the actual cause of a bug or failure before proposing more changes.

## When to Use

Use this skill when:
- the user explicitly asks for the root cause
- there were multiple failed fix attempts
- symptoms are changing and the cause is unclear
- the team has already changed several things without confidence

Do **not** use this for every small bug. Prefer normal debugging first.

## Modes

### Light
Use for a small but unclear issue.

Output:
- symptom
- top hypotheses
- evidence still needed
- recommended next diagnostic step

### Full
Use when there is churn, regressions, or clear uncertainty.

Output:
- symptom timeline
- attempted fixes
- rejected hypotheses
- root cause
- smallest safe fix
- regression checks

## Artifact Contract

Write a diagnostic artifact to:
- `diagnostics/YYYY-MM-DD-<slug>.md`

Use this structure:

```md
# Root Cause Review

## Mode
Light | Full

## Symptom

## Evidence

## Attempted Fixes

## Rejected Hypotheses

## Root Cause

## Minimal Safe Fix

## Regression Checks
```

For light mode, sections may be shorter, but keep the same structure where possible.

## Process

1. Reconstruct the symptom clearly
2. Gather evidence from code, errors, tests, and prior attempts
3. Separate facts from guesses
4. Eliminate weak hypotheses
5. State the most likely root cause
6. Recommend the smallest safe next fix
7. Define regression checks before implementation starts

## Rules

- Diagnosis first, implementation second.
- Do not make production changes while running this skill.
- Do not present symptom patches as root causes.
- Be explicit about uncertainty when evidence is incomplete.
- If evidence is weak, recommend the next investigation step instead of pretending certainty.
