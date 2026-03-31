---
name: ask
description: "Use when you want a concise answer, but the work should happen in a background subagent first."
---

# Ask

Use this skill when the user wants an answer, but you want the reasoning or research to happen in a subagent running in the background.

## Goal

Always delegate the question to a background subagent, wait for it to finish, then return **only the answer** to the user.

## Workflow

1. **Restate the question briefly** so the subagent has exact context.
2. **Spawn the `asker` subagent in background** with `supervisor-spawn`.
   - Pass the question, relevant context, and the requirement to write the final answer to the artifact dir.
   - Use `visibility: background`.
3. **Wait for completion** with `supervisor-wait`.
4. **Read the answer artifact** from the subagent.
5. **Respond to the user with just the answer**.

## Subagent task format

Use a task prompt like:

> Answer this question concisely and directly. Use the repo/context as needed. Write the final answer to `$PI_SUPERVISOR_ARTIFACT_DIR/answer.md` and do not include process notes.

## Boundaries

- Do **not** answer directly from the parent agent unless the subagent failed.
- Do **not** expose internal orchestration unless the user asks.
- Keep the final response short and focused on the answer.

## Good uses

- "What should we do here?"
- "Why is this failing?"
- "Which option is better?"
- "Can you check the codebase and tell me the answer?"

## Notes

- This skill assumes the current agent can use supervisor tools.
- If the subagent fails, summarize the failure briefly and retry if appropriate.
