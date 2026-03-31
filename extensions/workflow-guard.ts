import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

type PackageJson = {
  scripts?: Record<string, string>;
};

type ToolRunner = {
  kind: "script" | "binary";
  value: string;
};

const FORMAT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".md",
  ".mdx",
  ".yaml",
  ".yml",
  ".css",
  ".scss",
  ".html",
  ".xml",
  ".svg",
  ".sh",
]);

const REVIEW_MESSAGE_TYPE = "workflow-guard-review";
const REVIEWED_COMMITS = new Map<string, string>();

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function isGitCommitCommand(command: string): boolean {
  return (
    /\bgit\s+commit(\s|$)/.test(command) &&
    !/\bgit\s+commit-tree\b/.test(command)
  );
}

export function isFormatCandidate(path: string): boolean {
  return FORMAT_EXTENSIONS.has(extname(path).toLowerCase());
}

export function extractMutationPaths(
  toolName: string,
  args: unknown,
): string[] {
  if (!args || typeof args !== "object") return [];
  const record = args as Record<string, unknown>;
  const paths = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string" && value.trim()) paths.add(value);
  };

  if (toolName === "write" || toolName === "edit") {
    add(record.path);
    if (Array.isArray(record.paths)) {
      for (const value of record.paths) add(value);
    }
  }

  return [...paths];
}

export function buildReviewPrompt(commitHash: string): string {
  const shortHash = commitHash.slice(0, 7);
  return [
    `A commit was just created: ${shortHash}.`,
    "Please run a focused review of that commit only.",
    "Check for scope creep, regressions, missing tests, and workflow issues.",
    "Summarize only actionable findings, or say the commit looks safe if nothing stands out.",
  ].join(" ");
}

function repoRoot(cwd: string): string {
  let current = cwd;
  while (true) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return cwd;
    current = parent;
  }
}

function readPackageJson(root: string): PackageJson | undefined {
  const packageJsonPath = join(root, "package.json");
  if (!existsSync(packageJsonPath)) return undefined;
  try {
    return JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJson;
  } catch {
    return undefined;
  }
}

function hasBinary(root: string, name: string): boolean {
  return existsSync(join(root, "node_modules", ".bin", name));
}

export function resolveRunner(
  root: string,
  scriptName: string,
  fallbackBinary?: string,
): ToolRunner | undefined {
  const pkg = readPackageJson(root);
  const scripts = pkg?.scripts ?? {};
  if (typeof scripts[scriptName] === "string" && scripts[scriptName].trim()) {
    return { kind: "script", value: scriptName };
  }
  if (fallbackBinary && hasBinary(root, fallbackBinary)) {
    return {
      kind: "binary",
      value: join(root, "node_modules", ".bin", fallbackBinary),
    };
  }
  return undefined;
}

function buildRunnerCommand(runner: ToolRunner, args: string[] = []): string {
  if (runner.kind === "script") {
    const suffix = args.length ? ` -- ${args.map(shellQuote).join(" ")}` : "";
    return `npm run --silent ${shellQuote(runner.value)}${suffix}`;
  }
  return `${shellQuote(runner.value)}${args.length ? ` ${args.map(shellQuote).join(" ")}` : ""}`;
}

function buildShellRunnerCommand(runner: ToolRunner, argExpr?: string): string {
  if (runner.kind === "script") {
    return `npm run --silent ${shellQuote(runner.value)}${argExpr ? ` -- ${argExpr}` : ""}`;
  }
  return `${shellQuote(runner.value)}${argExpr ? ` ${argExpr}` : ""}`;
}

async function runCommand(
  pi: ExtensionAPI,
  cwd: string,
  command: string,
  signal?: AbortSignal,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const result = await pi.exec("bash", ["-lc", command], {
    cwd,
    signal,
    timeout: 120_000,
  });
  return {
    code: result.code ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

async function formatPaths(
  pi: ExtensionAPI,
  cwd: string,
  paths: string[],
  signal?: AbortSignal,
): Promise<void> {
  const root = repoRoot(cwd);
  const files = [...new Set(paths)]
    .filter(isFormatCandidate)
    .map((path) => {
      const abs = resolve(cwd, path);
      return relative(root, abs).startsWith("..") ? null : relative(root, abs);
    })
    .filter((path): path is string => path !== null);

  if (!files.length) return;

  const runner =
    resolveRunner(root, "format") ??
    resolveRunner(root, "prettier", "prettier");
  if (!runner) return;

  const result = await runCommand(
    pi,
    root,
    buildRunnerCommand(runner, files),
    signal,
  );
  if (result.code !== 0) {
    throw new Error(
      result.stderr || result.stdout || `format exited ${result.code}`,
    );
  }
}

function buildCommitGuardScript(cwd: string, originalCommand: string): string {
  const root = repoRoot(cwd);
  const formatRunner =
    resolveRunner(root, "format") ??
    resolveRunner(root, "prettier", "prettier");
  const lintRunner = resolveRunner(root, "lint");
  const typecheckRunner =
    resolveRunner(root, "typecheck") ?? resolveRunner(root, "tsc", "tsc");
  const original = shellQuote(originalCommand);

  const lines = [
    "set -euo pipefail",
    "sleep 1",
    `repo_root=${shellQuote(root)}`,
    'cd "$repo_root"',
    "",
    "mapfile -d '' -t staged < <(git diff --cached --name-only -z --diff-filter=ACMR)",
    "mapfile -d '' -t dirty < <(git ls-files -m -o --exclude-standard -z)",
    "",
    "files=()",
    "declare -A seen=()",
    'for rel in "${staged[@]}" "${dirty[@]}"; do',
    '\t[[ -n "$rel" ]] || continue',
    '\tif [[ -n "${seen[$rel]:-}" ]]; then',
    "\t\tcontinue",
    "\tfi",
    "\tseen[$rel]=1",
    '\tcase "$rel" in',
    "\t\t*.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.json|*.jsonc|*.md|*.mdx|*.yaml|*.yml|*.css|*.scss|*.html|*.xml|*.svg|*.sh)",
    '\t\t\tfiles+=("$repo_root/$rel")',
    "\t\t\t;;",
    "\tesac",
    "done",
    "",
  ];

  if (formatRunner) {
    lines.push(
      "if (( ${#files[@]} )); then",
      `\t${buildShellRunnerCommand(formatRunner, '"${files[@]}"')}`,
      '\tgit add -- "${files[@]}"',
      "fi",
      "",
    );
  }

  if (lintRunner) {
    lines.push(
      "lint_files=()",
      'for rel in "${staged[@]}" "${dirty[@]}"; do',
      '\t[[ -n "$rel" ]] || continue',
      '\tcase "$rel" in',
      '\t\t*.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs) lint_files+=("$repo_root/$rel") ;;',
      "\tesac",
      "done",
      "if (( ${#lint_files[@]} )) && command -v npm >/dev/null 2>&1; then",
      `\t${buildShellRunnerCommand(lintRunner, '"${lint_files[@]}"')}`,
      "fi",
      "",
    );
  }

  if (typecheckRunner) {
    lines.push(
      `if command -v npm >/dev/null 2>&1; then`,
      `\t${buildShellRunnerCommand(typecheckRunner)}`,
      "fi",
      "",
    );
  }

  lines.push(`bash -lc ${original}`);
  return lines.join("\n").trim();
}

export default function workflowGuard(pi: ExtensionAPI) {
  // Supervised subagents skip workflow-guard to avoid bloating their context
  // with format/lint/tsc output. Code quality checks run at merge time instead.
  if (process.env.PI_SUPERVISOR_AGENT_ID) return;

  const formatQueue = new Map<string, Promise<void>>();

  pi.on("tool_execution_end", async (event: any, ctx: ExtensionContext) => {
    if (event.isError) return;

    if (event.toolName === "write" || event.toolName === "edit") {
      const paths = extractMutationPaths(event.toolName, event.args);
      if (!paths.length) return;

      const cwd = ctx.cwd;
      const existing = formatQueue.get(cwd) ?? Promise.resolve();
      const next = existing.then(async () => {
        try {
          await formatPaths(pi, cwd, paths, ctx.signal);
        } catch {
          // Best effort: do not break the original edit/write tool result.
        }
      });

      formatQueue.set(
        cwd,
        next.finally(() => {
          if (formatQueue.get(cwd) === next) formatQueue.delete(cwd);
        }),
      );
      return;
    }

    if (event.toolName !== "bash") return;
    const command = String(event.args?.command ?? "");
    if (!isGitCommitCommand(command)) return;

    const root = repoRoot(ctx.cwd);
    try {
      const result = await pi.exec("git", ["rev-parse", "HEAD"], {
        cwd: root,
        signal: ctx.signal,
        timeout: 10_000,
      });
      const commitHash = String(result.stdout ?? "").trim();
      if (!commitHash) return;
      if (REVIEWED_COMMITS.get(root) === commitHash) return;
      REVIEWED_COMMITS.set(root, commitHash);

      pi.sendMessage(
        {
          customType: REVIEW_MESSAGE_TYPE,
          content: buildReviewPrompt(commitHash),
          display: true,
          details: { commitHash, repoRoot: root },
        },
        { triggerTurn: true, deliverAs: "followUp" },
      );
    } catch {
      // Skip the follow-up review if we cannot resolve the commit.
    }
  });

  pi.on("tool_call", async (event: any, ctx: ExtensionContext) => {
    if (event.toolName !== "bash") return;
    const command = String(event.input?.command ?? "");
    if (!isGitCommitCommand(command)) return;
    event.input.command = buildCommitGuardScript(ctx.cwd, command);
  });
}
