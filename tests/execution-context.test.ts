import { describe, expect, it } from "vitest";
import { resolveExecutionContext } from "../extensions/execution-context";

describe("resolveExecutionContext", () => {
  it("prefers explicit worktree root", () => {
    const context = resolveExecutionContext({
      cwd: "/repo/.worktrees/task-1/src",
      env: {
        PI_PROJECT_ROOT: "/repo",
        PI_WORKTREE_ROOT: "/repo/.worktrees/task-1",
      },
      gitTopLevel: "/repo/.worktrees/task-1",
    });

    expect(context).toEqual({
      cwd: "/repo/.worktrees/task-1/src",
      projectRoot: "/repo",
      worktreeRoot: "/repo/.worktrees/task-1",
      gitTopLevel: "/repo/.worktrees/task-1",
      source: "env:worktree",
    });
  });

  it("falls back to explicit project root", () => {
    const context = resolveExecutionContext({
      cwd: "/repo/src",
      env: { PI_PROJECT_ROOT: "/repo" },
      gitTopLevel: "/repo",
    });

    expect(context).toEqual({
      cwd: "/repo/src",
      projectRoot: "/repo",
      worktreeRoot: "/repo",
      gitTopLevel: "/repo",
      source: "env:project",
    });
  });

  it("uses git root when env vars are absent", () => {
    const context = resolveExecutionContext({
      cwd: "/repo/src",
      gitTopLevel: "/repo",
    });

    expect(context).toEqual({
      cwd: "/repo/src",
      projectRoot: "/repo",
      worktreeRoot: "/repo",
      gitTopLevel: "/repo",
      source: "git",
    });
  });

  it("falls back to cwd when git root is unavailable", () => {
    const context = resolveExecutionContext({
      cwd: "/tmp/no-repo",
    });

    expect(context).toEqual({
      cwd: "/tmp/no-repo",
      projectRoot: "/tmp/no-repo",
      worktreeRoot: "/tmp/no-repo",
      source: "cwd",
    });
  });

  it("rejects mismatched worktree root and git root when cwd sits inside the declared worktree", () => {
    expect(() =>
      resolveExecutionContext({
        cwd: "/repo/.worktrees/task-1/src",
        env: { PI_WORKTREE_ROOT: "/repo/.worktrees/task-1" },
        gitTopLevel: "/repo",
      }),
    ).toThrow(/Ambiguous execution context/);
  });

  it("rejects mismatched worktree root and git root when cwd is exactly the declared worktree root", () => {
    expect(() =>
      resolveExecutionContext({
        cwd: "/repo/.worktrees/task-1",
        env: { PI_WORKTREE_ROOT: "/repo/.worktrees/task-1" },
        gitTopLevel: "/repo",
      }),
    ).toThrow(/Ambiguous execution context/);
  });
});
