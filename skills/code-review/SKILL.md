---
name: code-review
description: "Use when reviewing code changes. Structured review with priority levels, security checks, and actionable feedback."
---

# Code Review

Review changes for quality, security, and correctness. Flag issues — don't fix them.

## Process

1. **Understand intent** — Read the task/plan to know what was built and why
2. **Examine changes** — `git log --oneline -10` then `git diff HEAD~N`
3. **Run tests** — `npm test`, `npm run typecheck` (if applicable)
4. **Write review** — structured findings with priority levels

## Output

Write to `$PI_SUPERVISOR_ARTIFACT_DIR/review.md`:

```markdown
# Code Review

**Reviewed:** [brief description]
**Verdict:** APPROVED | NEEDS CHANGES

## Summary
[1-2 sentences]

## Findings

### [P0] Critical: [title]
**File:** `path/to/file.ts:123`
**Issue:** [description]
**Fix:** [how to fix]

### [P1] Important: [title]
...

## What's Good
- [genuine observations]
```

## Priority Levels

- **P0** — Will break production, lose data, or create a security hole. Must be provable.
- **P1** — Genuine foot gun. Someone WILL trip over this.
- **P2** — Worth mentioning. Code works without it.

## What NOT to Flag

- Naming preferences (unless actively misleading)
- Hypothetical edge cases (check if they're actually possible)
- Style differences
- "Best practice" violations where the code works fine

## What TO Flag

- Real bugs that manifest in usage
- Security issues with concrete exploit scenarios
- Missing error handling where errors WILL occur
- Newly added dependencies
- Secrets or credentials in code

## Constraints

- **MUST NOT modify code** — flag, don't fix
- **Be specific** — file, line, exact problem, suggested fix
- **Verify claims** — don't say "this would break X" without checking
