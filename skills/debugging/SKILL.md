---
name: debugging
description: "Use when investigating bugs or unexpected behavior. Systematic root cause analysis before applying fixes."
---

# Systematic Debugging

Investigate before fixing. Understand before changing.

## Process

```
1. REPRODUCE — Confirm the bug exists and is reproducible
2. READ      — Read the error message. All of it.
3. HYPOTHESIZE — Form a theory based on evidence
4. VERIFY    — Test the hypothesis (add logging, inspect state)
5. FIX       — Apply the minimal fix for the root cause
6. CONFIRM   — Verify the fix resolves the issue without regressions
```

## Rules

- **Never guess.** No shotgun debugging — changing random things to see what sticks.
- **Read the error.** The answer is usually in the error message or stack trace.
- **One change at a time.** If you change two things, you don't know which one worked.
- **Understand the root cause.** Don't patch symptoms. A bandaid means the bug will return.
- **Remove debugging artifacts.** No console.log or print statements left in the code after fixing.

## When Stuck

- Check git blame — who changed this last and why?
- Search for similar patterns — is this bug happening elsewhere?
- Read the tests — what behavior was expected?
- Check dependencies — did a library update break something?
