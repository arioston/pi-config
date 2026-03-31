---
name: commit
description: "Use when committing code changes. Enforces conventional commit format with descriptive messages."
---

# Commit

Polished, descriptive git commits using conventional commit format.

## Format

```
<type>(<scope>): <subject>

<body>
```

**Types:** feat, fix, refactor, test, docs, chore, perf, style, ci
**Scope:** component or area affected (optional but preferred)
**Subject:** imperative, lowercase, no period, under 50 chars
**Body:** explain WHY, not what (the diff shows what)

## Before Committing

1. **Verify changes work** — run tests, check for regressions
2. **Review the diff** — `git diff --staged` to confirm what's included
3. **No debugging artifacts** — remove console.log, TODO comments, test data
4. **No secrets** — check for .env values, API keys, tokens

## Examples

Good:
```
feat(auth): add token refresh on 401 response

The API started returning 401 when tokens expire mid-session.
This adds automatic retry with a fresh token before surfacing
the error to the user.
```

Bad:
```
update auth stuff
```
```
fix bug
```

## Rules

- One commit per logical change — don't bundle unrelated fixes
- Never commit generated files unless they're tracked by convention
- Commit message explains intent, not mechanics
