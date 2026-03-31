import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync, readFileSync } from "node:fs";
import { join, delimiter } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

function makeRepo(prefix: string) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function runPwd(repo: string) {
  return execFileSync(
    join(process.cwd(), "hooks", "worktree-command"),
    ["pwd"],
    {
      cwd: repo,
      env: {
        ...process.env,
        PI_PROJECT_ROOT: repo,
        PI_WORKTREE_ROOT: repo,
      },
      encoding: "utf8",
    },
  );
}

function makeFakeRunner(binDir: string, name: string, logFile: string) {
  const scriptPath = join(binDir, name);
  writeFileSync(
    scriptPath,
    `#!/usr/bin/env bash\nprintf '%s %s\n' ${JSON.stringify(name)} "$*" >> ${JSON.stringify(logFile)}\n`,
  );
  chmodSync(scriptPath, 0o755);
}

function runCommandWithRepo(repo: string, command: string, extraEnv: Record<string, string> = {}) {
  return execFileSync(
    join(process.cwd(), "hooks", "worktree-command"),
    [command],
    {
      cwd: repo,
      env: {
        ...process.env,
        PI_PROJECT_ROOT: repo,
        PI_WORKTREE_ROOT: repo,
        ...extraEnv,
      },
      encoding: "utf8",
    },
  );
}

describe("worktree-command", () => {
  it("resolves context correctly for a repo using bun", () => {
    const repo = makeRepo("worktree-bun-");
    writeFileSync(
      join(repo, "package.json"),
      JSON.stringify({ scripts: { test: "echo ok" } }),
    );
    writeFileSync(join(repo, "bun.lock"), "");

    const output = runPwd(repo);
    expect(output).toContain(`project_root=${repo}`);
    expect(output).toContain(`worktree_root=${repo}`);
  });

  it("resolves context correctly for a repo using pnpm", () => {
    const repo = makeRepo("worktree-pnpm-");
    writeFileSync(
      join(repo, "package.json"),
      JSON.stringify({ scripts: { test: "echo ok" } }),
    );
    writeFileSync(join(repo, "pnpm-lock.yaml"), "lockfileVersion: 9.0");

    const output = runPwd(repo);
    expect(output).toContain(`project_root=${repo}`);
    expect(output).toContain(`worktree_root=${repo}`);
  });

  it("resolves context correctly for a repo using yarn", () => {
    const repo = makeRepo("worktree-yarn-");
    writeFileSync(
      join(repo, "package.json"),
      JSON.stringify({ scripts: { test: "echo ok" } }),
    );
    writeFileSync(join(repo, "yarn.lock"), "");
    mkdirSync(join(repo, ".git"));

    const output = runPwd(repo);
    expect(output).toContain(`project_root=${repo}`);
    expect(output).toContain(`worktree_root=${repo}`);
  });

  it("uses bun when bun.lock is present", () => {
    const repo = makeRepo("worktree-bun-run-");
    const binDir = join(repo, "bin");
    const logFile = join(repo, "runner.log");
    mkdirSync(binDir);
    writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { test: "echo ok" } }));
    writeFileSync(join(repo, "bun.lock"), "");
    makeFakeRunner(binDir, "bun", logFile);

    runCommandWithRepo(repo, "test", { PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}` });
    expect(readFileSync(logFile, "utf8")).toContain("bun run test --");
  });

  it("uses pnpm when pnpm-lock.yaml is present", () => {
    const repo = makeRepo("worktree-pnpm-run-");
    const binDir = join(repo, "bin");
    const logFile = join(repo, "runner.log");
    mkdirSync(binDir);
    writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { test: "echo ok" } }));
    writeFileSync(join(repo, "pnpm-lock.yaml"), "lockfileVersion: 9.0");
    makeFakeRunner(binDir, "pnpm", logFile);

    runCommandWithRepo(repo, "test", { PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}` });
    expect(readFileSync(logFile, "utf8")).toContain("pnpm run test --");
  });

  it("uses yarn when yarn.lock is present", () => {
    const repo = makeRepo("worktree-yarn-run-");
    const binDir = join(repo, "bin");
    const logFile = join(repo, "runner.log");
    mkdirSync(binDir);
    writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { test: "echo ok" } }));
    writeFileSync(join(repo, "yarn.lock"), "");
    makeFakeRunner(binDir, "yarn", logFile);

    runCommandWithRepo(repo, "test", { PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}` });
    expect(readFileSync(logFile, "utf8")).toContain("yarn test");
  });
});
