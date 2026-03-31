import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type ExecutionContextSource =
  | "env:worktree"
  | "env:project"
  | "git"
  | "cwd";

export type ExecutionContext = {
  cwd: string;
  projectRoot: string;
  worktreeRoot: string;
  gitTopLevel?: string;
  source: ExecutionContextSource;
};

export type ExecutionContextInput = {
  cwd: string;
  env?: Record<string, string | undefined>;
  gitTopLevel?: string;
};

function normalizePath(path: string): string {
  return resolve(path);
}

function findGitRoot(start: string): string | undefined {
  let current = normalizePath(start);
  while (true) {
    if (existsSync(`${current}/.git`)) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function resolveExecutionContext(
  input: ExecutionContextInput,
): ExecutionContext {
  const cwd = normalizePath(input.cwd);
  const env = input.env ?? {};
  const envWorktreeRoot = env.PI_WORKTREE_ROOT
    ? normalizePath(env.PI_WORKTREE_ROOT)
    : undefined;
  const envProjectRoot = env.PI_PROJECT_ROOT
    ? normalizePath(env.PI_PROJECT_ROOT)
    : undefined;
  const gitTopLevel = input.gitTopLevel
    ? normalizePath(input.gitTopLevel)
    : findGitRoot(cwd);

  if (
    envWorktreeRoot &&
    gitTopLevel &&
    envWorktreeRoot !== gitTopLevel &&
    (cwd === envWorktreeRoot || cwd.startsWith(`${envWorktreeRoot}/`))
  ) {
    throw new Error(
      `Ambiguous execution context: PI_WORKTREE_ROOT=${envWorktreeRoot} but git resolved ${gitTopLevel}`,
    );
  }

  if (
    envProjectRoot &&
    gitTopLevel &&
    envProjectRoot !== gitTopLevel &&
    cwd === envProjectRoot
  ) {
    throw new Error(
      `Ambiguous execution context: PI_PROJECT_ROOT=${envProjectRoot} but git resolved ${gitTopLevel}`,
    );
  }

  if (envWorktreeRoot) {
    return {
      cwd,
      projectRoot: envProjectRoot ?? gitTopLevel ?? envWorktreeRoot,
      worktreeRoot: envWorktreeRoot,
      gitTopLevel,
      source: "env:worktree",
    };
  }

  if (envProjectRoot) {
    return {
      cwd,
      projectRoot: envProjectRoot,
      worktreeRoot: gitTopLevel ?? envProjectRoot,
      gitTopLevel,
      source: "env:project",
    };
  }

  if (gitTopLevel) {
    return {
      cwd,
      projectRoot: gitTopLevel,
      worktreeRoot: gitTopLevel,
      gitTopLevel,
      source: "git",
    };
  }

  return {
    cwd,
    projectRoot: cwd,
    worktreeRoot: cwd,
    source: "cwd",
  };
}
