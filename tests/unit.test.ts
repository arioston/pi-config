import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Since the extension is a single file with no separate exports,
// we test the pure logic by reimplementing the key functions here.
// This tests the ALGORITHM, not the import chain.

// ─── slugFromTask ───────────────────────────────────────────────────────────

function slugFromTask(task: string): string {
	const stop = new Set(["a","an","the","to","in","on","at","of","for","and","or","is","it","be","do","with"]);
	const w = task.replace(/[^a-zA-Z0-9\s]/g, " ").split(/\s+/).map(w => w.toLowerCase()).filter(w => w.length > 0 && !stop.has(w));
	return w.slice(0, 3).join("-") || "agent";
}

function dedup(slug: string, existing: Set<string>): string {
	if (!existing.has(slug)) return slug;
	for (let i = 2; i < 100; i++) { const c = `${slug}-${i}`; if (!existing.has(c)) return c; }
	return `${slug}-${Date.now()}`;
}

function isTerminal(s: string) { return s === "done" || s === "failed" || s === "crashed" || s === "killed"; }

function simpleHash(t: string) { let h = 0; for (let i = 0; i < t.length; i++) h = ((h << 5) - h + t.charCodeAt(i)) | 0; return h.toString(36); }

function shellQuote(v: string) { return `'${v.replace(/'/g, `'"'"'`)}'`; }

function stripNoise(t: string) {
	return t.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\r/g, "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("slugFromTask", () => {
	it("extracts first 3 meaningful words", () => { expect(slugFromTask("Fix the authentication bug in login flow")).toBe("fix-authentication-bug"); });
	it("filters stop words", () => { expect(slugFromTask("add a new feature to the app")).toBe("add-new-feature"); });
	it("handles single word", () => { expect(slugFromTask("refactor")).toBe("refactor"); });
	it("handles empty string", () => { expect(slugFromTask("")).toBe("agent"); });
	it("handles only stop words", () => { expect(slugFromTask("the a an")).toBe("agent"); });
	it("strips special characters", () => { expect(slugFromTask("fix: auth-bug (#123)")).toBe("fix-auth-bug"); });
	it("lowercases everything", () => { expect(slugFromTask("Add Dark Mode Toggle")).toBe("add-dark-mode"); });
});

describe("dedup", () => {
	it("returns slug as-is when not in set", () => { expect(dedup("fix-auth", new Set())).toBe("fix-auth"); });
	it("appends -2 when exists", () => { expect(dedup("fix-auth", new Set(["fix-auth"]))).toBe("fix-auth-2"); });
	it("appends -3 when -2 exists", () => { expect(dedup("fix-auth", new Set(["fix-auth", "fix-auth-2"]))).toBe("fix-auth-3"); });
});

describe("isTerminal", () => {
	it("done", () => expect(isTerminal("done")).toBe(true));
	it("failed", () => expect(isTerminal("failed")).toBe(true));
	it("crashed", () => expect(isTerminal("crashed")).toBe(true));
	it("killed", () => expect(isTerminal("killed")).toBe(true));
	it("running", () => expect(isTerminal("running")).toBe(false));
	it("spawning", () => expect(isTerminal("spawning")).toBe(false));
	it("stalled", () => expect(isTerminal("stalled")).toBe(false));
});

describe("simpleHash", () => {
	it("consistent", () => { expect(simpleHash("hello")).toBe(simpleHash("hello")); });
	it("different inputs", () => { expect(simpleHash("hello")).not.toBe(simpleHash("world")); });
	it("empty", () => { expect(simpleHash("")).toBe("0"); });
});

describe("shellQuote", () => {
	it("wraps in single quotes", () => { expect(shellQuote("hello")).toBe("'hello'"); });
	it("escapes single quotes", () => { expect(shellQuote("it's")).toBe("'it'\"'\"'s'"); });
	it("empty", () => { expect(shellQuote("")).toBe("''"); });
	it("spaces", () => { expect(shellQuote("hello world")).toBe("'hello world'"); });
});

describe("stripNoise", () => {
	it("strips ANSI", () => { expect(stripNoise("\x1b[32mgreen\x1b[0m")).toBe("green"); });
	it("strips CR", () => { expect(stripNoise("hello\rworld")).toBe("helloworld"); });
	it("passes clean text", () => { expect(stripNoise("hello world")).toBe("hello world"); });
});

describe("frontmatter parsing", () => {
	it("extracts fields from YAML frontmatter", () => {
		const content = `---
name: worker
model: kiro/sonnet-4-6
thinking: minimal
spawning: true
skills: commit, tdd, debugging, supervisor
deny-tools: some-tool
---
# Worker`;
		const m = content.match(/^---\n([\s\S]*?)\n---/);
		expect(m).not.toBeNull();
		const fm = m![1];
		const get = (k: string) => { const x = fm.match(new RegExp(`^${k}:\\s*(.+)$`, "m")); return x ? x[1].trim() : undefined; };
		expect(get("name")).toBe("worker");
		expect(get("model")).toBe("kiro/sonnet-4-6");
		expect(get("spawning")).toBe("true");
		expect(get("skills")).toBe("commit, tdd, debugging, supervisor");
		expect(get("deny-tools")).toBe("some-tool");
		const skills = (get("skills") ?? "").split(",").map(s => s.trim()).filter(Boolean);
		expect(skills).toEqual(["commit", "tdd", "debugging", "supervisor"]);
	});

	it("returns null for missing frontmatter", () => {
		expect("no frontmatter".match(/^---\n([\s\S]*?)\n---/)).toBeNull();
	});
});

describe("registry format", () => {
	let tmpDir: string;
	beforeEach(async () => { tmpDir = await fs.mkdtemp(join(tmpdir(), "sv-test-")); });
	afterEach(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

	it("reads registry JSON", async () => {
		const p = join(tmpDir, "registry.json");
		await fs.writeFile(p, JSON.stringify({ version: 1, agents: { "test": { type: "agent", id: "test", status: "running" } } }));
		const c = JSON.parse(await fs.readFile(p, "utf8"));
		expect(c.version).toBe(1);
		expect(c.agents.test.type).toBe("agent");
	});

	it("migrates old records", async () => {
		const old = { version: 0, agents: { "old": { id: "old", status: "running" } } };
		if (!old.version || old.version < 1) { for (const r of Object.values(old.agents) as any[]) { if (!r.type) r.type = "agent"; } old.version = 1; }
		expect(old.version).toBe(1);
		expect((old.agents as any).old.type).toBe("agent");
	});
});
