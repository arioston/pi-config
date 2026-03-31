---
name: config-update
description: "Use when updating settings.json, hook configuration, or similar repo config files. Read first, merge safely, validate after writing."
---

# Config Update

Safely modify configuration files without clobbering unrelated settings.

## When to Use

Use this skill for:
- `.claude/settings.json`
- `.claude/settings.local.json`
- hook configuration files
- repo-local JSON/YAML config that should be merged, not replaced

## Required Process

1. **Read first**
   - Read the current file before proposing any changes.
   - If the file does not exist, note that you are creating it.

2. **Merge, don't replace**
   - Preserve unrelated keys.
   - Add new hooks or permissions alongside existing ones.
   - Never rewrite the whole file unless the user explicitly requested a reset.

3. **Handle arrays carefully**
   - For hook arrays: append new entries instead of replacing the event block.
   - For permission arrays: preserve existing entries and add only what is needed.
   - Dedupe identical new entries only when safe and obvious.

4. **Validate after writing**
   - Confirm the file is still valid JSON/YAML.
   - Confirm expected top-level keys still exist.
   - Confirm newly added hook/event names are correct.
   - Confirm command quoting/escaping still looks valid.

## Common Failure Modes to Avoid

- Replacing the entire `hooks` object when only one event changed
- Replacing the entire `permissions.allow` array
- Writing malformed shell quoting in hook commands
- Forgetting to read the existing file first
- Moving repo-specific config into global config by accident

## Checklist

Before finishing, verify:
- [ ] Existing file was read first
- [ ] Unrelated settings were preserved
- [ ] New config was merged into the correct key path
- [ ] File parses successfully
- [ ] Hook commands still point to the intended repo-local paths

## Rules

- Prefer the smallest possible edit.
- Preserve existing behavior unless the requested change explicitly alters it.
- If the file is ambiguous or already malformed, stop and explain the risk before making broad rewrites.
