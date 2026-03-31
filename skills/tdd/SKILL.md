---
name: tdd
description: "Use when implementing features. Test-driven development: write failing test first, then implement, then refactor."
---

# Test-Driven Development

Red-Green-Refactor cycle for all implementation work.

## The Cycle

```
1. RED    — Write a test that fails (proves the feature is missing)
2. GREEN  — Write the minimum code to make the test pass
3. REFACTOR — Clean up without changing behavior (tests still pass)
```

## Rules

- **No production code without a failing test first.** If you wrote code before the test, delete it and start over.
- **Run the test after writing it** — it MUST fail. If it passes, the test is wrong.
- **Minimum implementation** — write only enough code to pass the test. Resist the urge to add "obvious" features.
- **Run all tests after implementation** — no regressions allowed.
- **Refactor only when green** — never refactor while tests are failing.

## When TDD Doesn't Apply

- Configuration files, build scripts, CI pipelines
- Pure documentation changes
- One-line fixes where the test already exists and is failing

## Test Quality

- Test behavior, not implementation details
- One assertion per test (or tightly related assertions)
- Tests should be readable as documentation
- Name tests after what they verify: `should reject expired tokens`
