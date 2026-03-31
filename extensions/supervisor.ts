import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { hostname as osHostname } from "node:os";
import { fileURLToPath } from "node:url";

// ─── Constants ──────────────────────────────────────────────────────────────

const STATUS_KEY = "supervisor";
const REGISTRY_VERSION = 1;
const SUPERVISOR_POLL_INTERVAL_MS = 5_000;
const DEFAULT_IDLE_TIMEOUT_SECS = 120;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_WAIT_TIMEOUT_SECS = 300;
const BACKLOG_TAIL_LINES = 50;
const BACKLOG_CONTEXT_LINES = 20;
const BG_SESSION_NAME = "pi-supervisor-bg";
const WORKTREE_SLOT_PATTERN = "-sv-worktree-";
const MAX_SEND_SIZE = 100_000;
const ANSI_CSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const ANSI_OSC_RE = /\x1b\][^\x07]*(?:\x07|\x1b\\)/g;
const CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const SPAWN_TOOLS = ["supervisor-spawn", "supervisor-run", "supervisor-kill", "supervisor-send", "supervisor-merge"];
const WORKTREE_AGENTS = new Set(["worker"]);

// ─── Types ──────────────────────────────────────────────────────────────────

type AgentStatus = "spawning" | "running" | "stalled" | "killed" | "done" | "failed" | "crashed";
type PreviousAttempt = { attempt: number; duration: number; lastOutput: string; reason: string };
type AgentRecord = {
	type: "agent" | "process"; id: string; task: string; agent: string; command?: string; cwd?: string;
	status: AgentStatus; visibility: "foreground" | "background"; tmuxSession: string; tmuxTarget: string;
	startedAt: string; updatedAt: string; lastOutputAt: string; lastOutputHash: string;
	attempt: number; maxAttempts: number; idleTimeoutSecs: number; previousAttempts: PreviousAttempt[];
	runtimeDir: string; logPath: string; exitFile: string;
	artifactDir?: string; worktreePath?: string; branch?: string; exitCode?: number; error?: string;
};
type RegistryFile = { version: number; agents: Record<string, AgentRecord> };
type CommandResult = { ok: boolean; status: number | null; stdout: string; stderr: string; error?: string };
type RespawnIntent = { record: AgentRecord; reason: string };
type AgentFrontmatter = { skills: string[]; spawning: boolean; model?: string; thinking?: string; tools?: string; denyTools?: string };
type SpawnParams = { task: string; agent: string; visibility: "foreground" | "background"; idleTimeoutSecs: number; maxAttempts: number; useWorktree?: boolean; previousAttempts?: PreviousAttempt[]; existingId?: string; attempt?: number };
type ProcessSpawnParams = { command: string; name: string; visibility: "foreground" | "background"; cwd?: string };

// ─── Utilities ──────────────────────────────────────────────────────────────

function nowIso() { return new Date().toISOString(); }
function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }
function stringifyError(err: unknown) { return err instanceof Error ? err.message : String(err); }
function shellQuote(v: string) { return `'${v.replace(/'/g, `'"'"'`)}'`; }
function stripNoise(t: string) { return t.replace(ANSI_CSI_RE, "").replace(ANSI_OSC_RE, "").replace(/\r/g, "").replace(CONTROL_RE, ""); }
function simpleHash(t: string) { let h = 0; for (let i = 0; i < t.length; i++) h = ((h << 5) - h + t.charCodeAt(i)) | 0; return h.toString(36); }
function emptyRegistry(): RegistryFile { return { version: REGISTRY_VERSION, agents: {} }; }
function isTerminal(s: AgentStatus) { return s === "done" || s === "failed" || s === "crashed" || s === "killed"; }
function toolResult(data: Record<string, unknown>) { return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], details: data }; }

/** Wraps a tool executor with a timeout so it NEVER hangs */
const TOOL_TIMEOUT_MS = 10_000;
async function withToolTimeout<T>(fn: () => Promise<T>, label: string): Promise<T> {
	return Promise.race([
		fn(),
		new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${TOOL_TIMEOUT_MS / 1000}s`)), TOOL_TIMEOUT_MS)),
	]);
}

// ─── Shell ──────────────────────────────────────────────────────────────────

function run(cmd: string, args: string[], opts?: { input?: string }): CommandResult {
	const r = spawnSync(cmd, args, { input: opts?.input, encoding: "utf8", timeout: 5000 });
	if (r.error) return { ok: false, status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error.message };
	return { ok: r.status === 0, status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}
function runOrThrow(cmd: string, args: string[]) {
	const r = run(cmd, args);
	if (!r.ok) throw new Error(`${cmd} ${args.join(" ")} failed: ${r.error || r.stderr || `exit ${r.status}`}`.trim());
	return r;
}

// ─── Filesystem ─────────────────────────────────────────────────────────────

async function fileExists(p: string) { try { await fs.stat(p); return true; } catch { return false; } }
async function ensureDir(p: string) { await fs.mkdir(p, { recursive: true }); }
async function readJson<T>(p: string): Promise<T | undefined> { try { return JSON.parse(await fs.readFile(p, "utf8")); } catch { return undefined; } }
async function atomicWrite(p: string, c: string) { await ensureDir(dirname(p)); const t = `${p}.tmp.${process.pid}.${Math.random().toString(16).slice(2)}`; await fs.writeFile(t, c, "utf8"); await fs.rename(t, p); }

function lockPayload() { return JSON.stringify({ pid: process.pid, ppid: process.ppid, hostname: osHostname(), createdAt: nowIso() }) + "\n"; }

async function withLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
	await ensureDir(dirname(lockPath));
	const t0 = Date.now();
	while (true) {
		try {
			const h = await fs.open(lockPath, "wx");
			try { await h.writeFile(lockPayload(), "utf8"); } catch {}
			try { return await fn(); } finally { await h.close().catch(() => {}); await fs.unlink(lockPath).catch(() => {}); }
		} catch (err: any) {
			if (err?.code !== "EEXIST") throw err;
			try {
				const st = await fs.stat(lockPath);
				const age = Date.now() - st.mtimeMs;
				if (age > 30_000) { await fs.unlink(lockPath).catch(() => {}); continue; }
				if (age > 2_000) {
					try { const d = JSON.parse(await fs.readFile(lockPath, "utf8")); if (typeof d.pid === "number" && (!d.hostname || d.hostname === osHostname())) { try { process.kill(d.pid, 0); } catch { await fs.unlink(lockPath).catch(() => {}); continue; } } } catch {}
				}
			} catch {}
			if (Date.now() - t0 > 10_000) throw new Error(`Lock timeout: ${lockPath}`);
			await sleep(40 + Math.random() * 80);
		}
	}
}

// ─── Logging ────────────────────────────────────────────────────────────────

let logPath: string | undefined;
function setLogPath(p: string) { logPath = p; }
async function log(level: string, msg: string, d?: Record<string, unknown>) {
	if (!logPath) return;
	try { await fs.appendFile(logPath, JSON.stringify({ ts: nowIso(), level, msg, ...d }) + "\n", "utf8"); } catch {}
}

// ─── Backlog ────────────────────────────────────────────────────────────────

function readBacklogTail(p: string, n: number) {
	const r = run("tail", ["-n", String(n), p]);
	if (!r.ok) return "";
	return r.stdout.split(/\r?\n/).map((l) => stripNoise(l).trimEnd()).filter(Boolean).join("\n");
}

// ─── Package root & frontmatter ─────────────────────────────────────────────

function getPackageRoot() { return resolve(dirname(fileURLToPath(import.meta.url)), ".."); }

function parseFrontmatter(agent: string): AgentFrontmatter {
	const p = join(getPackageRoot(), "agents", `${agent}.md`);
	if (!existsSync(p)) return { skills: [], spawning: false };
	const c = readFileSync(p, "utf8");
	const m = c.match(/^---\n([\s\S]*?)\n---/);
	if (!m) return { skills: [], spawning: false };
	const fm = m[1];
	const get = (k: string) => { const x = fm.match(new RegExp(`^${k}:\\s*(.+)$`, "m")); return x ? x[1].trim() : undefined; };
	const skills = (get("skills") ?? get("skill") ?? "").split(",").map(s => s.trim()).filter(Boolean);
	return { skills, spawning: get("spawning") === "true", model: get("model"), thinking: get("thinking"), tools: get("tools"), denyTools: get("deny-tools") };
}

function resolveSkills(names: string[]) { const root = getPackageRoot(); return names.map(n => join(root, "skills", n)).filter(p => existsSync(p)); }

function buildDenyList(fm: AgentFrontmatter) {
	const deny = fm.spawning ? [] : [...SPAWN_TOOLS];
	if (fm.denyTools) for (const t of fm.denyTools.split(",").map(s => s.trim()).filter(Boolean)) if (!deny.includes(t)) deny.push(t);
	return deny;
}

// ─── Registry ───────────────────────────────────────────────────────────────

function gitRoot(cwd: string) { const r = run("git", ["-C", cwd, "rev-parse", "--show-toplevel"]); return r.ok && r.stdout.trim() ? resolve(r.stdout.trim()) : resolve(cwd); }
function stateRoot(ctx: ExtensionContext) { return gitRoot(ctx.cwd); }
function metaDir(sr: string) { return join(sr, ".pi", "supervisor"); }
function regPath(sr: string) { return join(metaDir(sr), "registry.json"); }
function regLock(sr: string) { return join(metaDir(sr), "registry.lock"); }
function rtDir(sr: string, id: string) { return join(metaDir(sr), "runtime", id); }

async function loadReg(sr: string): Promise<RegistryFile> {
	const p = await readJson<RegistryFile>(regPath(sr));
	if (!p || typeof p !== "object" || typeof p.agents !== "object" || !p.agents) return emptyRegistry();
	if (!p.version || p.version < REGISTRY_VERSION) { for (const r of Object.values(p.agents)) { if (!r.type) r.type = "agent"; } p.version = REGISTRY_VERSION; }
	return p;
}
async function saveReg(sr: string, reg: RegistryFile) { await atomicWrite(regPath(sr), JSON.stringify(reg, null, 2) + "\n"); }
async function mutateReg(sr: string, fn: (reg: RegistryFile) => Promise<void> | void) {
	return withLock(regLock(sr), async () => { const reg = await loadReg(sr); const b = JSON.stringify(reg); await fn(reg); if (JSON.stringify(reg) !== b) await saveReg(sr, reg); return reg; });
}

function slugFromTask(task: string) {
	const stop = new Set(["a","an","the","to","in","on","at","of","for","and","or","is","it","be","do","with"]);
	const w = task.replace(/[^a-zA-Z0-9\s]/g, " ").split(/\s+/).map(w => w.toLowerCase()).filter(w => w.length > 0 && !stop.has(w));
	return w.slice(0, 3).join("-") || "agent";
}
function dedup(slug: string, existing: Set<string>) {
	if (!existing.has(slug)) return slug;
	for (let i = 2; i < 100; i++) { const c = `${slug}-${i}`; if (!existing.has(c)) return c; }
	return `${slug}-${Date.now()}`;
}

// ─── Worktree ───────────────────────────────────────────────────────────────

function wtPrefix(root: string) { return `${basename(root)}${WORKTREE_SLOT_PATTERN}`; }

async function allocateWt(root: string, agentId: string, attempt: number) {
	const parent = dirname(root), prefix = wtPrefix(root), branch = `supervisor/${agentId}-attempt-${attempt}`;
	const head = runOrThrow("git", ["-C", root, "rev-parse", "HEAD"]).stdout.trim();
	let entries: string[]; try { entries = await fs.readdir(parent); } catch { entries = []; }
	const slots = entries.filter(e => e.startsWith(prefix)).sort();

	for (const slot of slots) {
		const sp = join(parent, slot), lp = join(sp, ".pi", "active.lock");
		if (await fileExists(lp)) continue;
		const bl = run("git", ["-C", sp, "branch", "--list", "supervisor/*"]);
		if (bl.ok) for (const b of bl.stdout.split("\n").map(l => l.replace(/^\*?\s+/, "").trim()).filter(Boolean)) run("git", ["-C", sp, "branch", "-D", b]);
		run("git", ["-C", sp, "merge", "--abort"]);
		runOrThrow("git", ["-C", sp, "reset", "--hard", head]);
		run("git", ["-C", sp, "clean", "-fd"]);
		runOrThrow("git", ["-C", sp, "checkout", "-B", branch, head]);
		await ensureDir(join(sp, ".pi"));
		await atomicWrite(lp, lockPayload());
		return { worktreePath: sp, branch };
	}

	const idx = slots.length + 1, name = `${prefix}${String(idx).padStart(4, "0")}`, sp = join(parent, name);
	runOrThrow("git", ["-C", root, "worktree", "add", "-B", branch, sp, head]);
	await ensureDir(join(sp, ".pi"));
	await atomicWrite(join(sp, ".pi", "active.lock"), lockPayload());
	return { worktreePath: sp, branch };
}

async function cleanWtLock(wt?: string) { if (wt) await fs.unlink(join(wt, ".pi", "active.lock")).catch(() => {}); }

// ─── Tmux ───────────────────────────────────────────────────────────────────

function ensureTmux() { if (!run("tmux", ["-V"]).ok) throw new Error("tmux required"); }
function curSession() { const r = runOrThrow("tmux", ["display-message", "-p", "#S"]); return r.stdout.trim() || (() => { throw new Error("No tmux session"); })(); }
function hasSess(n: string) { return run("tmux", ["has-session", "-t", n]).ok; }
// Env vars to forward from the current process to the background tmux session.
// This ensures spawned processes have access to AWS creds, PATH, nvm, etc.
const ENV_FORWARD_PREFIXES = ["AWS_", "PATH", "HOME", "USER", "SHELL", "LANG", "LC_", "NVM_", "NODE_", "SSH_", "DISPLAY", "TERM", "XDG_", "GOOGLE_", "KIRO_", "BUN_"];

function syncEnvToBgSession(sess: string) {
	for (const [key, val] of Object.entries(process.env)) {
		if (!val) continue;
		if (ENV_FORWARD_PREFIXES.some(p => key.startsWith(p))) {
			run("tmux", ["set-environment", "-t", sess, key, val]);
		}
	}
}

function bgSession() {
	const created = !hasSess(BG_SESSION_NAME);
	if (created) runOrThrow("tmux", ["new-session", "-d", "-s", BG_SESSION_NAME, "-x", "200", "-y", "50"]);
	// Always sync env — creds may have been refreshed since session creation
	syncEnvToBgSession(BG_SESSION_NAME);
	return BG_SESSION_NAME;
}
function newWin(sess: string, name: string) { const r = runOrThrow("tmux", ["new-window", "-d", "-t", `${sess}:`, "-P", "-F", "#{window_id}", "-n", name]); return r.stdout.trim(); }
function splitPane(name: string) { const r = runOrThrow("tmux", ["split-window", "-h", "-d", "-P", "-F", "#{pane_id}"]); run("tmux", ["select-pane", "-t", r.stdout.trim(), "-T", name]); return r.stdout.trim(); }
function targetAlive(t: string) { const r = run("tmux", ["display-message", "-p", "-t", t, "#{pane_id}"]); if (r.ok && r.stdout.trim()) return true; const r2 = run("tmux", ["display-message", "-p", "-t", t, "#{window_id}"]); return r2.ok && r2.stdout.trim() === t; }
function pipeTo(t: string, log: string) { runOrThrow("tmux", ["pipe-pane", "-t", t, "-o", `cat >> '${log.replace(/'/g, `'"'"'`)}'`]); }
function sendLine(t: string, l: string) { runOrThrow("tmux", ["send-keys", "-t", t, l, "C-m"]); }
function sendPrompt(t: string, p: string) { if (p.length > MAX_SEND_SIZE) throw new Error("Message too large"); const r = run("tmux", ["load-buffer", "-"], { input: p }); if (!r.ok) throw new Error(`tmux buffer: ${r.stderr}`); runOrThrow("tmux", ["paste-buffer", "-d", "-t", t]); runOrThrow("tmux", ["send-keys", "-t", t, "C-m"]); }
function killTmux(t: string) { const r1 = run("tmux", ["kill-pane", "-t", t]); const r2 = run("tmux", ["kill-window", "-t", t]); if (!r1.ok && !r2.ok) console.warn(`[sv] kill ${t} failed`); }

// ─── Launch scripts ─────────────────────────────────────────────────────────

const WRITE_EXIT = `write_exit() { local c="$1" tmp="\${EXIT_FILE}.tmp"; printf '{"exitCode":%d,"finishedAt":"%s"}\\n' "$c" "$(date -Is)" > "$tmp"; mv "$tmp" "$EXIT_FILE"; }`;

function agentScript(p: { agentId: string; stateRoot: string; projectRoot: string; tmuxTarget: string; promptPath: string; exitFile: string; agentDef?: string; runtimeDir: string; skillPaths?: string[]; artifactDir?: string; denyTools?: string[]; worktreePath?: string }) {
	const skills = (p.skillPaths ?? []).map(s => `PI_CMD+=(--skill ${shellQuote(s)})`).join("\n");
	const cd = p.worktreePath ? `cd ${shellQuote(p.worktreePath)}` : "";
	const artExp = p.artifactDir ? `export PI_SUPERVISOR_ARTIFACT_DIR=${shellQuote(p.artifactDir)}` : "";
	const rootExp = [
		`export PI_PROJECT_ROOT=${shellQuote(p.projectRoot)}`,
		p.worktreePath ? `export PI_WORKTREE_ROOT=${shellQuote(p.worktreePath)}` : "",
	].filter(Boolean).join("\n");
	const denyExp = (p.denyTools ?? []).length > 0 ? `export PI_DENY_TOOLS=${shellQuote(p.denyTools!.join(","))}` : "";
	return `#!/usr/bin/env bash
set -euo pipefail
AGENT_ID=${shellQuote(p.agentId)}
TMUX_TARGET=${shellQuote(p.tmuxTarget)}
PROMPT_FILE=${shellQuote(p.promptPath)}
EXIT_FILE=${shellQuote(p.exitFile)}
AGENT_DEF=${shellQuote(p.agentDef ?? "")}
export PI_SUPERVISOR_AGENT_ID="$AGENT_ID"
${artExp}
${rootExp}
${denyExp}
${WRITE_EXIT}
echo "[sv] $(date -Is) Agent $AGENT_ID starting"
${cd}
PI_CMD=(pi)
if [[ -n "$AGENT_DEF" ]]; then PI_CMD+=(--agent "$AGENT_DEF"); fi
${skills}
set +e
"\${PI_CMD[@]}" "$(cat "$PROMPT_FILE")"
exit_code=$?
set -e
write_exit "$exit_code"
echo "[sv] Agent $AGENT_ID exited ($exit_code)"
read -n 1 -s -r -p "[sv] Press any key..." || true
echo
tmux kill-pane -t "$TMUX_TARGET" 2>/dev/null || tmux kill-window -t "$TMUX_TARGET" 2>/dev/null || true
`;
}

function processScript(p: { agentId: string; tmuxTarget: string; command: string; exitFile: string; cwd?: string }) {
	const cd = p.cwd ? `cd ${shellQuote(p.cwd)}` : "";
	const rootExp = p.cwd ? `export PI_PROJECT_ROOT=${shellQuote(p.cwd)}\nexport PI_WORKTREE_ROOT=${shellQuote(p.cwd)}` : "";
	return `#!/usr/bin/env bash
set -euo pipefail
AGENT_ID=${shellQuote(p.agentId)}
TMUX_TARGET=${shellQuote(p.tmuxTarget)}
EXIT_FILE=${shellQuote(p.exitFile)}
export PI_SUPERVISOR_AGENT_ID="$AGENT_ID"
${rootExp}
${WRITE_EXIT}
echo "[sv] $(date -Is) Process $AGENT_ID starting"
${cd}
# Run command in foreground — use bash -c to ensure pipes/subprocesses stay attached
bash -c ${shellQuote(p.command)}
exit_code=$?
write_exit "$exit_code"
echo "[sv] Process $AGENT_ID exited ($exit_code)"
tmux kill-pane -t "$TMUX_TARGET" 2>/dev/null || tmux kill-window -t "$TMUX_TARGET" 2>/dev/null || true
`;
}

// ─── Agent spawning ─────────────────────────────────────────────────────────

async function spawnAgent(ctx: ExtensionContext, params: SpawnParams): Promise<AgentRecord> {
	ensureTmux();
	const sr = stateRoot(ctx), root = gitRoot(ctx.cwd), now = nowIso(), attempt = params.attempt ?? 1;
	const fm = parseFrontmatter(params.agent), skills = resolveSkills(fm.skills), deny = buildDenyList(fm);

	let id: string;
	if (params.existingId) { id = params.existingId; }
	else { const s = slugFromTask(params.task); const reg = await loadReg(sr); const ex = new Set(Object.keys(reg.agents)); const rec = reg.agents[s]; id = (ex.has(s) && rec && !isTerminal(rec.status)) ? dedup(s, ex) : dedup(s, ex); }

	let wt: string | undefined, br: string | undefined;
	if (params.useWorktree ?? WORKTREE_AGENTS.has(params.agent)) { const w = await allocateWt(root, id, attempt); wt = w.worktreePath; br = w.branch; }

	const rd = rtDir(sr, `${id}-attempt-${attempt}`); await ensureDir(rd);
	const pp = join(rd, "kickoff.md"), lp = join(rd, "backlog.log"), ef = join(rd, "exit.json"), ls = join(rd, "launch.sh");
	// Clean stale exit.json from previous runs in same runtime dir
	await fs.unlink(ef).catch(() => {});
	const ad = join(metaDir(sr), "artifacts", id); await ensureDir(ad);

	let prompt = params.task;
	if (params.previousAttempts?.length) {
		const hist = params.previousAttempts.map(pa => `## Attempt #${pa.attempt} (${pa.duration}s, ${pa.reason})\n\`\`\`\n${pa.lastOutput}\n\`\`\``).join("\n\n");
		prompt = `# Retry #${attempt}\nPrevious stalled. Different approach.\n\n${hist}\n\n---\n## Original Task\n${params.task}`;
	}
	prompt += `\n\n---\n## Artifacts\nWrite to: ${ad}\n`;
	if (wt) prompt += `Worktree: ${wt} (branch: ${br})\n`;

	await atomicWrite(pp, prompt + "\n"); await atomicWrite(lp, "");

	let sess: string, tgt: string;
	if (params.visibility === "foreground") { sess = curSession(); tgt = splitPane(`sv-${id}`); }
	else { sess = bgSession(); tgt = newWin(sess, `sv-${id}`); }

	await atomicWrite(ls, agentScript({ agentId: id, stateRoot: sr, projectRoot: root, tmuxTarget: tgt, promptPath: pp, exitFile: ef, agentDef: params.agent, runtimeDir: rd, skillPaths: skills, artifactDir: ad, denyTools: deny, worktreePath: wt }));
	await fs.chmod(ls, 0o755);
	// Brief pause so tmux pane shell is ready before piping/sending (avoids init race)
	await sleep(100);
	pipeTo(tgt, lp); sendLine(tgt, `bash ${shellQuote(ls)}`);

	const rec: AgentRecord = { type: "agent", id, task: params.task, agent: params.agent, status: "running", visibility: params.visibility, tmuxSession: sess, tmuxTarget: tgt, startedAt: now, updatedAt: now, lastOutputAt: now, lastOutputHash: "", attempt, maxAttempts: params.maxAttempts, idleTimeoutSecs: params.idleTimeoutSecs, previousAttempts: params.previousAttempts ?? [], runtimeDir: rd, logPath: lp, exitFile: ef, artifactDir: ad, worktreePath: wt, branch: br };
	await mutateReg(sr, reg => { reg.agents[id] = rec; });
	agentCache.set(id, rec);
	return rec;
}

async function spawnProcess(ctx: ExtensionContext, params: ProcessSpawnParams): Promise<AgentRecord> {
	ensureTmux();
	const sr = stateRoot(ctx), now = nowIso();
	const s = slugFromTask(params.name); const reg = await loadReg(sr); const id = dedup(s, new Set(Object.keys(reg.agents)));
	const rd = rtDir(sr, `${id}-attempt-1`); await ensureDir(rd);
	const lp = join(rd, "backlog.log"), ef = join(rd, "exit.json"), ls = join(rd, "launch.sh");
	// Clean stale files from previous runs in same runtime dir
	await atomicWrite(lp, "");
	await fs.unlink(ef).catch(() => {});

	let sess: string, tgt: string;
	if (params.visibility === "foreground") { sess = curSession(); tgt = splitPane(`sv-${id}`); }
	else { sess = bgSession(); tgt = newWin(sess, `sv-${id}`); }

	await atomicWrite(ls, processScript({ agentId: id, tmuxTarget: tgt, command: params.command, exitFile: ef, cwd: params.cwd }));
	await fs.chmod(ls, 0o755);
	await sleep(100);
	pipeTo(tgt, lp); sendLine(tgt, `bash ${shellQuote(ls)}`);

	const rec: AgentRecord = { type: "process", id, task: params.name, agent: "", command: params.command, cwd: params.cwd, status: "running", visibility: params.visibility, tmuxSession: sess, tmuxTarget: tgt, startedAt: now, updatedAt: now, lastOutputAt: now, lastOutputHash: "", attempt: 1, maxAttempts: 1, idleTimeoutSecs: 0, previousAttempts: [], runtimeDir: rd, logPath: lp, exitFile: ef };
	await mutateReg(sr, r => { r.agents[id] = rec; });
	agentCache.set(id, rec);
	return rec;
}

// ─── In-memory agent cache (tools read from here, never from disk) ──────────

const agentCache = new Map<string, AgentRecord>();

function cacheFromRegistry(reg: RegistryFile) {
	agentCache.clear();
	for (const [id, rec] of Object.entries(reg.agents)) agentCache.set(id, rec);
}

function cachedAgents(): AgentRecord[] { return Array.from(agentCache.values()); }

// ─── Supervisor loop ────────────────────────────────────────────────────────

let timer: NodeJS.Timeout | undefined, inFlight = false, sCtx: ExtensionContext | undefined, sApi: ExtensionAPI | undefined;

async function tick() {
	if (!sCtx || !sApi) return;
	const sr = stateRoot(sCtx), pi = sApi, intents: RespawnIntent[] = [];

	const reg = await mutateReg(sr, async reg => {
		// Auto-prune only "done" (success) entries older than 5 minutes.
		// Failed/crashed/killed entries stay for user inspection (use supervisor-prune to clean).
		const pruneCutoff = Date.now() - 5 * 60_000;
		for (const [id, rec] of Object.entries(reg.agents)) {
			if (rec.status === "done" && new Date(rec.updatedAt).getTime() < pruneCutoff) {
				delete reg.agents[id];
			}
		}

		for (const rec of Object.values(reg.agents)) {
			if (isTerminal(rec.status)) continue;

			// Check exit.json FIRST — process may have exited but pane still open
			if (await fileExists(rec.exitFile)) {
				const ex = await readJson<{ exitCode?: number }>(rec.exitFile);
				if (ex && typeof ex.exitCode === "number") {
					rec.exitCode = ex.exitCode; rec.status = ex.exitCode === 0 ? "done" : "failed"; rec.updatedAt = nowIso();
					await cleanWtLock(rec.worktreePath); await log("info", "exited", { id: rec.id, code: ex.exitCode });
					continue;
				}
			}

			if (!targetAlive(rec.tmuxTarget)) {
				rec.status = "crashed"; rec.error = "tmux gone"; rec.updatedAt = nowIso(); await cleanWtLock(rec.worktreePath); await log("error", "crashed", { id: rec.id }); continue;
			}
			if (rec.status !== "running" || rec.type === "process" || rec.idleTimeoutSecs <= 0) continue;
			const out = readBacklogTail(rec.logPath, BACKLOG_CONTEXT_LINES), hash = simpleHash(out);
			if (hash !== rec.lastOutputHash) { rec.lastOutputHash = hash; rec.lastOutputAt = nowIso(); rec.updatedAt = nowIso(); continue; }
			const idle = (Date.now() - new Date(rec.lastOutputAt).getTime()) / 1000;
			if (idle < rec.idleTimeoutSecs) continue;
			rec.status = "stalled"; rec.updatedAt = nowIso();
			if (rec.attempt < rec.maxAttempts) { await log("warn", "stalled", { id: rec.id, idle: Math.round(idle) }); killTmux(rec.tmuxTarget); await cleanWtLock(rec.worktreePath); intents.push({ record: { ...rec }, reason: "idle_timeout" }); }
			else { rec.status = "failed"; rec.error = `Max attempts exhausted`; rec.updatedAt = nowIso(); await cleanWtLock(rec.worktreePath); await log("error", "failed", { id: rec.id }); pi.sendMessage({ customType: "sv", content: `[sv] ${rec.id} FAILED`, display: true }, { triggerTurn: false, deliverAs: "followUp" }); }
		}
	});

	for (const { record: rec, reason } of intents) {
		try {
			const out = readBacklogTail(rec.logPath, BACKLOG_TAIL_LINES), dur = Math.round((Date.now() - new Date(rec.startedAt).getTime()) / 1000);
			const prev: PreviousAttempt[] = [...rec.previousAttempts, { attempt: rec.attempt, duration: dur, lastOutput: out.slice(-2000), reason }];
			await log("info", "respawning", { id: rec.id, attempt: rec.attempt + 1 });
			const nr = await spawnAgent(sCtx!, { task: rec.task, agent: rec.agent, visibility: rec.visibility, idleTimeoutSecs: rec.idleTimeoutSecs, maxAttempts: rec.maxAttempts, previousAttempts: prev, existingId: rec.id, attempt: rec.attempt + 1 });
			pi.sendMessage({ customType: "sv", content: `[sv] Respawned ${rec.id} (#${nr.attempt}/${nr.maxAttempts})`, display: true }, { triggerTurn: false, deliverAs: "followUp" });
		} catch (err) {
			await log("error", "respawn failed", { id: rec.id, error: stringifyError(err) });
			pi.sendMessage({ customType: "sv", content: `[sv] Respawn failed ${rec.id}: ${stringifyError(err)}`, display: true }, { triggerTurn: false, deliverAs: "followUp" });
		}
	}
	// Update in-memory cache from the registry we just mutated
	cacheFromRegistry(reg);
	await renderStatus();
}

// ─── Widget rendering ───────────────────────────────────────────────────────

const ACCENT = "\x1b[38;2;77;163;255m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RST = "\x1b[0m";

function fmtElapsed(startedAt: string) {
	const s = Math.round((Date.now() - new Date(startedAt).getTime()) / 1000);
	const m = Math.floor(s / 60), sec = s % 60;
	return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function statusColor(s: AgentStatus) {
	if (s === "running") return GREEN;
	if (s === "stalled" || s === "spawning") return YELLOW;
	return RED;
}

function widgetTop(title: string, info: string, w: number) {
	if (w <= 2) return `${ACCENT}╭╮${RST}`;
	const inner = w - 2;
	const tp = `─ ${title} `, ip = ` ${info} ─`;
	const fill = "─".repeat(Math.max(0, inner - tp.length - ip.length));
	return `${ACCENT}╭${(tp + fill + ip).slice(0, inner).padEnd(inner, "─")}╮${RST}`;
}

function widgetLine(left: string, right: string, w: number) {
	const inner = Math.max(0, w - 2);
	const pad = Math.max(0, inner - left.length - right.length);
	return `${ACCENT}│${RST}${left}${" ".repeat(pad)}${right}${ACCENT}│${RST}`;
}

function widgetBottom(w: number) {
	return `${ACCENT}╰${"─".repeat(Math.max(0, w - 2))}╯${RST}`;
}

function renderWidgetLines(agents: AgentRecord[], width: number): string[] {
	const active = agents.filter(r => !isTerminal(r.status));
	if (!active.length) return [];

	const agentCount = active.filter(r => r.type === "agent").length;
	const procCount = active.filter(r => r.type === "process").length;
	const parts: string[] = [];
	if (agentCount) parts.push(`${agentCount} agent${agentCount > 1 ? "s" : ""}`);
	if (procCount) parts.push(`${procCount} proc${procCount > 1 ? "s" : ""}`);

	const lines: string[] = [widgetTop("Supervisor", parts.join(", "), width)];

	for (const r of active) {
		const elapsed = fmtElapsed(r.startedAt);
		const sc = statusColor(r.status);
		const tp = r.type === "process" ? `${DIM}[p]${RST} ` : "";
		const att = r.type === "agent" && r.attempt > 1 ? ` ${DIM}#${r.attempt}${RST}` : "";
		const vis = r.visibility === "foreground" ? "fg" : "bg";
		const left = ` ${elapsed}  ${tp}${r.id}${att} `;
		const right = ` ${sc}${r.status}${RST} ${DIM}@${vis}${RST} `;
		lines.push(widgetLine(left, right, width));
	}

	lines.push(widgetBottom(width));
	return lines;
}

let widgetTimer: ReturnType<typeof setInterval> | null = null;

function updateWidget() {
	if (!sCtx?.hasUI) return;
	const ctx = sCtx;

	// Read from in-memory cache — ZERO file I/O
	const active = cachedAgents().filter(r => !isTerminal(r.status));

	if (!active.length) {
		ctx.ui.setWidget("supervisor-widget", undefined);
		ctx.ui.setStatus(STATUS_KEY, undefined);
		if (widgetTimer) { clearInterval(widgetTimer); widgetTimer = null; }
		return;
	}

	// Widget
	ctx.ui.setWidget("supervisor-widget", (_tui: any, _theme: any) => ({
		invalidate() {},
		render(width: number) { return renderWidgetLines(active, width); },
	}), { placement: "belowEditor" });

	// Statusline (compact fallback)
	const th = ctx.ui.theme;
	const line = active.sort((a, b) => { const t = (a.type === "agent" ? 0 : 1) - (b.type === "agent" ? 0 : 1); return t || a.id.localeCompare(b.id); }).map(r => {
		const el = Math.round((Date.now() - new Date(r.startedAt).getTime()) / 1000), m = Math.floor(el / 60), s = el % 60;
		const tm = m > 0 ? `${m}m${s}s` : `${s}s`, v = r.visibility === "foreground" ? "fg" : "bg";
		const tp = r.type === "process" ? "[p]" : "", att = r.type === "agent" && r.attempt > 1 ? `#${r.attempt}` : "";
		const c = r.status === "running" ? "muted" as const : r.status === "stalled" ? "warning" as const : r.status === "spawning" ? "accent" as const : "error" as const;
		return th.fg(c, `${tp}${r.id}:${r.status}:${tm}${att}@${v}`);
	}).join(" ");
	ctx.ui.setStatus(STATUS_KEY, line);
}

function startWidgetRefresh() {
	if (widgetTimer) return;
	updateWidget();
	widgetTimer = setInterval(updateWidget, 2000);
}

async function renderStatus() {
	if (!sCtx?.hasUI) return;
	updateWidget();
}

function ensureLoop(pi: ExtensionAPI, ctx: ExtensionContext) {
	sCtx = ctx; sApi = pi; setLogPath(join(metaDir(stateRoot(ctx)), "supervisor.log"));
	// Bootstrap cache from disk on first call (non-blocking)
	if (agentCache.size === 0) { loadReg(stateRoot(ctx)).then(cacheFromRegistry).catch(() => {}); }
	if (ctx.hasUI) startWidgetRefresh();
	if (!timer) { timer = setInterval(() => { if (inFlight) return; inFlight = true; void tick().catch(e => console.error("[sv]", stringifyError(e))).finally(() => { inFlight = false; }); }, SUPERVISOR_POLL_INTERVAL_MS); timer.unref(); }
}

// ─── Check/wait helpers ─────────────────────────────────────────────────────

// checkPayload reads from in-memory cache — no file I/O in the fast path
function checkPayload(_sr: string, id: string) {
	const r = agentCache.get(id);
	if (!r) return { ok: false, error: `Unknown: ${id}. Cache has: ${[...agentCache.keys()].join(", ") || "(empty)"}` };
	const el = Math.round((Date.now() - new Date(r.startedAt).getTime()) / 1000);
	const idle = Math.round((Date.now() - new Date(r.lastOutputAt).getTime()) / 1000);
	const warn = r.idleTimeoutSecs > 0 && idle > r.idleTimeoutSecs * 0.8 ? `Idle ${idle}s (threshold: ${r.idleTimeoutSecs}s)` : null;
	return { ok: true, agent: { type: r.type, id: r.id, agent: r.agent || undefined, command: r.command, status: r.status, visibility: r.visibility, attempt: r.attempt, maxAttempts: r.maxAttempts, elapsed: `${el}s`, idleFor: `${idle}s`, artifactDir: r.artifactDir, worktreePath: r.worktreePath, branch: r.branch, exitCode: r.exitCode, error: r.error }, diagnostics: { stallWarning: warn, lastOutputAt: r.lastOutputAt } };
}

async function waitFor(sr: string, ids: string[], timeout: number, signal?: AbortSignal) {
	const uids = [...new Set(ids)], known = new Set<string>(); let first = true; const dl = Date.now() + timeout * 1000;
	while (true) {
		if (signal?.aborted) return { ok: false, error: "Aborted" };
		if (Date.now() > dl) return { ok: false, error: `Timeout ${timeout}s` };
		const unk: string[] = [];
		for (const id of uids) {
			const p = checkPayload(sr, id);
			if (!p.ok) { if (known.has(id)) return { ok: true, agent: { id, status: "done" }, backlog: "" }; if (first) unk.push(id); continue; }
			known.add(id); const s = (p.agent as any)?.status as AgentStatus | undefined;
			if (s && isTerminal(s)) return p;
		}
		if (first && unk.length) return { ok: false, error: `Unknown: ${unk.join(", ")}` };
		first = false; await sleep(1000);
	}
}

// ─── Extension export ───────────────────────────────────────────────────────

export default function supervisorExtension(pi: ExtensionAPI) {
	const denied = new Set((process.env.PI_DENY_TOOLS ?? "").split(",").map(s => s.trim()).filter(Boolean));
	const ok = (n: string) => !denied.has(n);

	ok("supervisor-spawn") && pi.registerTool({ name: "supervisor-spawn", label: "Spawn", description: "Spawn a supervised agent in tmux.",
		parameters: Type.Object({ task: Type.String(), agent: Type.String(), visibility: Type.Optional(Type.Union([Type.Literal("foreground"), Type.Literal("background")])), idleTimeoutSecs: Type.Optional(Type.Number()), maxAttempts: Type.Optional(Type.Number()) }),
		async execute(_t, p, _s, _u, ctx) { try { ensureLoop(pi, ctx);
			const LONG = new Set(["planner"]); let vis = p.visibility ?? "background"; let warn: string | undefined;
			if (vis === "foreground" && LONG.has(p.agent)) warn = "Warning: foreground agents die if terminal disconnects.";
			const r = await spawnAgent(ctx, { task: p.task, agent: p.agent, visibility: vis, idleTimeoutSecs: p.idleTimeoutSecs ?? DEFAULT_IDLE_TIMEOUT_SECS, maxAttempts: p.maxAttempts ?? DEFAULT_MAX_ATTEMPTS });
			const res: Record<string, unknown> = { ok: true, id: r.id, agent: r.agent, visibility: r.visibility, attempt: r.attempt, artifactDir: r.artifactDir, worktreePath: r.worktreePath, branch: r.branch };
			if (warn) res.warning = warn; return toolResult(res);
		} catch (e) { return toolResult({ ok: false, error: stringifyError(e) }); } },
	});

	pi.registerTool({ name: "supervisor-status", label: "Status", description: "List all tracked agents/processes. Reads from in-memory cache — instant response.",
		parameters: Type.Object({}),
		async execute(_t, _p, _s, _u, ctx) { try { ensureLoop(pi, ctx);
			// Read from in-memory cache — no file I/O, no tmux calls
			const recs = cachedAgents().sort((a, b) => { const t = (a.type === "agent" ? 0 : 1) - (b.type === "agent" ? 0 : 1); return t || a.id.localeCompare(b.id); });
			const out = recs.map(r => { const el = Math.round((Date.now() - new Date(r.startedAt).getTime()) / 1000); const idle = Math.round((Date.now() - new Date(r.lastOutputAt).getTime()) / 1000);
				return { type: r.type, id: r.id, agent: r.agent || undefined, command: r.command, status: r.status, visibility: r.visibility, attempt: r.attempt, maxAttempts: r.maxAttempts, elapsed: `${el}s`, idleFor: `${idle}s`, artifactDir: r.artifactDir, worktreePath: r.worktreePath, branch: r.branch, exitCode: r.exitCode, error: r.error };
			});
			return toolResult({ ok: true, count: out.length, agents: out });
		} catch (e) { return toolResult({ ok: false, error: stringifyError(e) }); } },
	});

	pi.registerTool({ name: "supervisor-check", label: "Check", description: "Check single agent status + backlog. Always returns within 10s.",
		parameters: Type.Object({ agentId: Type.String() }),
		async execute(_t, p, _s, _u, ctx) { try { return toolResult(checkPayload(stateRoot(ctx), p.agentId)); } catch (e) { return toolResult({ ok: false, error: stringifyError(e) }); } },
	});

	pi.registerTool({ name: "supervisor-wait", label: "Wait", description: "Block until agents finish.",
		parameters: Type.Object({ ids: Type.Array(Type.String()), timeoutSecs: Type.Optional(Type.Number()) }),
		async execute(_t, p, sig, _u, ctx) { try { ensureLoop(pi, ctx); return toolResult(await waitFor(stateRoot(ctx), p.ids, p.timeoutSecs ?? DEFAULT_WAIT_TIMEOUT_SECS, sig)); } catch (e) { return toolResult({ ok: false, error: stringifyError(e) }); } },
	});

	ok("supervisor-kill") && pi.registerTool({ name: "supervisor-kill", label: "Kill", description: "Kill agent/process by ID.",
		parameters: Type.Object({ agentId: Type.String() }),
		async execute(_t, p, _s, _u, ctx) { try { let found = false; await mutateReg(stateRoot(ctx), async reg => { const r = reg.agents[p.agentId]; if (!r) return; found = true; if (!isTerminal(r.status)) { killTmux(r.tmuxTarget); await cleanWtLock(r.worktreePath); r.status = "killed"; r.updatedAt = nowIso(); r.error = "Manually killed"; } }); return found ? toolResult({ ok: true, message: `Killed ${p.agentId}` }) : toolResult({ ok: false, error: `Unknown: ${p.agentId}` }); } catch (e) { return toolResult({ ok: false, error: stringifyError(e) }); } },
	});

	ok("supervisor-send") && pi.registerTool({ name: "supervisor-send", label: "Send", description: "Send message to agent tmux pane.",
		parameters: Type.Object({ agentId: Type.String(), message: Type.String() }),
		async execute(_t, p, _s, _u, ctx) { try { const sr = stateRoot(ctx), reg = await loadReg(sr), r = reg.agents[p.agentId];
			if (!r) return toolResult({ ok: false, error: `Unknown: ${p.agentId}` }); if (isTerminal(r.status)) return toolResult({ ok: false, error: `${p.agentId} is ${r.status}` }); if (!targetAlive(r.tmuxTarget)) return toolResult({ ok: false, error: "tmux gone" });
			sendPrompt(r.tmuxTarget, p.message); await mutateReg(sr, reg2 => { const r2 = reg2.agents[p.agentId]; if (r2 && !isTerminal(r2.status)) { r2.status = "running"; r2.lastOutputAt = nowIso(); r2.updatedAt = nowIso(); } });
			return toolResult({ ok: true, message: `Sent to ${p.agentId}` });
		} catch (e) { return toolResult({ ok: false, error: stringifyError(e) }); } },
	});

	ok("supervisor-merge") && pi.registerTool({ name: "supervisor-merge", label: "Merge", description: "Merge worker branch back.",
		parameters: Type.Object({ agentId: Type.String(), strategy: Type.Optional(Type.Union([Type.Literal("merge"), Type.Literal("rebase")])) }),
		async execute(_t, p, _s, _u, ctx) { try { const reg = await loadReg(stateRoot(ctx)), r = reg.agents[p.agentId];
			if (!r) return toolResult({ ok: false, error: `Unknown: ${p.agentId}` }); if (!isTerminal(r.status)) return toolResult({ ok: false, error: `Still ${r.status}` }); if (!r.branch) return toolResult({ ok: false, error: "No branch" });
			const root = gitRoot(ctx.cwd);
			if ((p.strategy ?? "merge") === "rebase") { const res = run("git", ["-C", root, "rebase", r.branch]); if (!res.ok) return toolResult({ ok: false, error: "Rebase conflict", details: res.stderr }); }
			else { let res = run("git", ["-C", root, "merge", "--ff-only", r.branch]); if (!res.ok) { res = run("git", ["-C", root, "merge", r.branch]); if (!res.ok) return toolResult({ ok: false, error: "Merge conflict", details: res.stderr }); } }
			run("git", ["-C", root, "branch", "-d", r.branch]); await cleanWtLock(r.worktreePath);
			return toolResult({ ok: true, message: `Merged ${r.branch}` });
		} catch (e) { return toolResult({ ok: false, error: stringifyError(e) }); } },
	});

	ok("supervisor-run") && pi.registerTool({ name: "supervisor-run", label: "Run", description: "Run shell command in tmux.",
		parameters: Type.Object({ command: Type.String(), name: Type.String(), visibility: Type.Optional(Type.Union([Type.Literal("foreground"), Type.Literal("background")])), cwd: Type.Optional(Type.String()) }),
		async execute(_t, p, _s, _u, ctx) { try { ensureLoop(pi, ctx);
			const r = await spawnProcess(ctx, { command: p.command, name: p.name, visibility: p.visibility ?? "background", cwd: p.cwd });
			return toolResult({ ok: true, id: r.id, command: r.command, visibility: r.visibility, tmuxTarget: r.tmuxTarget });
		} catch (e) { return toolResult({ ok: false, error: stringifyError(e) }); } },
	});

	pi.registerTool({ name: "supervisor-logs", label: "Logs", description: "Tail/search agent backlog. Use agentId='supervisor' for supervisor log. Always returns within 10s.",
		parameters: Type.Object({ agentId: Type.String(), lines: Type.Optional(Type.Number()), grep: Type.Optional(Type.String()) }),
		async execute(_t, p, _s, _u, ctx) { try { return await withToolTimeout(async () => { const sr = stateRoot(ctx), n = p.lines ?? 50;
			if (p.agentId === "supervisor") { let out = readBacklogTail(join(metaDir(sr), "supervisor.log"), n); if (p.grep) { const g = p.grep.toLowerCase(); out = out.split("\n").filter(l => l.toLowerCase().includes(g)).join("\n"); } return toolResult({ ok: true, id: "supervisor", type: "supervisor", output: out || "(empty)" }); }

			// Check in-memory cache first, then file registry, then scan runtime dirs
			const cached = agentCache.get(p.agentId);
			let logFile: string | undefined;
			let status = "unknown";
			let type = "unknown";

			if (cached) {
				logFile = cached.logPath; status = cached.status; type = cached.type;
			} else {
				const reg = await loadReg(sr);
				const r = reg.agents[p.agentId];
				if (r) { logFile = r.logPath; status = r.status; type = r.type; }
			}

			// Fallback: scan runtime dirs for the agent ID (even if pruned from registry)
			if (!logFile) {
				const rtBase = join(metaDir(sr), "runtime");
				try {
					const dirs = await fs.readdir(rtBase);
					const match = dirs.filter(d => d.startsWith(p.agentId + "-attempt-")).sort().pop();
					if (match) logFile = join(rtBase, match, "backlog.log");
				} catch {}
			}

			if (!logFile) return toolResult({ ok: false, error: `No logs found for '${p.agentId}'` });
			let out = readBacklogTail(logFile, n); if (p.grep) { const g = p.grep.toLowerCase(); out = out.split("\n").filter(l => l.toLowerCase().includes(g)).join("\n"); }
			return toolResult({ ok: true, id: p.agentId, type, status, output: out || "(no output)" });
		}, "supervisor-logs"); } catch (e) { return toolResult({ ok: false, error: stringifyError(e) }); } },
	});

	pi.registerTool({ name: "supervisor-prune", label: "Prune", description: "Clean old worktrees, artifacts, runtime.",
		parameters: Type.Object({ ageHours: Type.Optional(Type.Number()) }),
		async execute(_t, p, _s, _u, ctx) { try { const sr = stateRoot(ctx), root = gitRoot(ctx.cwd), reg = await loadReg(sr), active = new Set(Object.keys(reg.agents));
			const age = (p.ageHours ?? 24) * 3600000, cut = Date.now() - age; let pw = 0, pa = 0, pr = 0;
			const pdir = dirname(root), pfx = wtPrefix(root);
			try { for (const e of await fs.readdir(pdir)) { if (!e.startsWith(pfx)) continue; const sp = join(pdir, e), lp = join(sp, ".pi", "active.lock"); if (await fileExists(lp)) { const d = await readJson<any>(lp); if (d?.agentId && active.has(d.agentId)) continue; if (d?.createdAt && new Date(d.createdAt).getTime() > cut) continue; await fs.unlink(lp).catch(() => {}); } run("git", ["-C", root, "worktree", "remove", "--force", sp]); pw++; } } catch {}
			try { const ad = join(metaDir(sr), "artifacts"); for (const e of await fs.readdir(ad)) { if (active.has(e)) continue; const dp = join(ad, e), st = await fs.stat(dp); if (st.mtimeMs > cut) continue; await fs.rm(dp, { recursive: true, force: true }); pa++; } } catch {}
			try { const rd = join(metaDir(sr), "runtime"); for (const e of await fs.readdir(rd)) { const aid = e.replace(/-attempt-\d+$/, ""); if (active.has(aid)) continue; const dp = join(rd, e), st = await fs.stat(dp); if (st.mtimeMs > cut) continue; await fs.rm(dp, { recursive: true, force: true }); pr++; } } catch {}
			return toolResult({ ok: true, pruned: { worktrees: pw, artifacts: pa, runtime: pr } });
		} catch (e) { return toolResult({ ok: false, error: stringifyError(e) }); } },
	});

	pi.registerTool({ name: "supervisor-attach", label: "Attach", description: "Get info to attach to agent's tmux pane. Always returns within 10s.",
		parameters: Type.Object({ agentId: Type.String() }),
		async execute(_t, p, _s, _u, ctx) { try { return await withToolTimeout(async () => { const reg = await loadReg(stateRoot(ctx)), r = reg.agents[p.agentId];
			if (!r) return toolResult({ ok: false, error: `No agent '${p.agentId}'. Use supervisor-status to list.` });
			if (!targetAlive(r.tmuxTarget)) return toolResult({ ok: false, error: `'${p.agentId}' tmux gone (${r.status}).` });
			const cmd = r.visibility === "background" ? `tmux switch-client -t ${r.tmuxSession}` : `tmux select-pane -t ${r.tmuxTarget}`;
			return toolResult({ ok: true, id: r.id, status: r.status, visibility: r.visibility, tmuxSession: r.tmuxSession, tmuxTarget: r.tmuxTarget, message: `Run: ${cmd}`, attachCommand: cmd });
		}, "supervisor-attach"); } catch (e) { return toolResult({ ok: false, error: stringifyError(e) }); } },
	});

	pi.on("session_start", (_ev, ctx) => { ensureLoop(pi, ctx); void tick().catch(() => {}); });
	pi.on("turn_end", (_ev, ctx) => { ensureLoop(pi, ctx); });
	pi.on("session_shutdown", () => { if (widgetTimer) { clearInterval(widgetTimer); widgetTimer = null; } });
}
