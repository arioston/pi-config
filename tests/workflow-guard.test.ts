import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildReviewPrompt,
  extractMutationPaths,
  isFormatCandidate,
  isGitCommitCommand,
  resolveRunner,
  shellQuote,
} from "../extensions/workflow-guard";

describe("shellQuote", () => {
  it("wraps values in single quotes", () => {
    expect(shellQuote("hello")).toBe("'hello'");
  });

  it("escapes embedded single quotes", () => {
    expect(shellQuote("it's good")).toBe("'it'\"'\"'s good'");
  });
});

describe("isGitCommitCommand", () => {
  it("detects git commit", () => {
    expect(isGitCommitCommand("git commit -m 'msg'")).toBe(true);
  });

  it("detects amend commits", () => {
    expect(isGitCommitCommand("git commit --amend --no-edit")).toBe(true);
  });

  it("ignores similar commands", () => {
    expect(isGitCommitCommand("git commit-tree HEAD")).toBe(false);
    expect(isGitCommitCommand("git status")).toBe(false);
  });
});

describe("isFormatCandidate", () => {
  it("includes common source and content files", () => {
    expect(isFormatCandidate("src/app.ts")).toBe(true);
    expect(isFormatCandidate("README.md")).toBe(true);
    expect(isFormatCandidate("config.yaml")).toBe(true);
  });

  it("excludes non-format files", () => {
    expect(isFormatCandidate("image.png")).toBe(false);
    expect(isFormatCandidate("archive.zip")).toBe(false);
  });
});

describe("extractMutationPaths", () => {
  it("extracts write paths", () => {
    expect(extractMutationPaths("write", { path: "src/index.ts" })).toEqual([
      "src/index.ts",
    ]);
  });

  it("extracts edit paths", () => {
    expect(extractMutationPaths("edit", { path: "src/index.ts" })).toEqual([
      "src/index.ts",
    ]);
  });

  it("ignores unrelated tools", () => {
    expect(extractMutationPaths("bash", { command: "echo hi" })).toEqual([]);
  });
});

describe("buildReviewPrompt", () => {
  it("mentions the commit hash and review intent", () => {
    const prompt = buildReviewPrompt("1234567890abcdef");
    expect(prompt).toContain("1234567");
    expect(prompt).toContain("focused review");
  });
});

describe("resolveRunner", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), "workflow-guard-"));
    await fs.mkdir(join(root, "node_modules", ".bin"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("prefers package scripts over binaries", async () => {
    await fs.writeFile(
      join(root, "package.json"),
      JSON.stringify({ scripts: { format: "oxmformat", lint: "oxm lint" } }),
    );
    await fs.writeFile(join(root, "node_modules", ".bin", "prettier"), "");

    expect(resolveRunner(root, "format", "prettier")).toEqual({
      kind: "script",
      value: "format",
    });
    expect(resolveRunner(root, "lint")).toEqual({
      kind: "script",
      value: "lint",
    });
  });

  it("falls back to the binary when no script exists", async () => {
    await fs.writeFile(join(root, "node_modules", ".bin", "prettier"), "");

    expect(resolveRunner(root, "format", "prettier")).toEqual({
      kind: "binary",
      value: join(root, "node_modules", ".bin", "prettier"),
    });
  });
});
