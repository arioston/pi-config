import { describe, expect, it } from "vitest";
import {
  decideSessionEndAction,
  sessionEndPayloadSnapshotPath,
  sessionEndStatusPath,
  shouldSkipForProject,
} from "../extensions/session-end-runtime";

describe("session-end paths", () => {
  it("builds status and payload snapshot paths", () => {
    expect(sessionEndStatusPath("/repo", "abc")).toBe(
      "/repo/.pi/hooks/status/session-end/abc.json",
    );
    expect(sessionEndPayloadSnapshotPath("/repo", "abc")).toBe(
      "/repo/.pi/hooks/session-end/abc.payload.json",
    );
  });
});

describe("shouldSkipForProject", () => {
  it("allows hook execution when cwd is inside expected project root", () => {
    expect(
      shouldSkipForProject({
        hookCwd: "/repo/subdir",
        expectedProjectRoot: "/repo",
      }),
    ).toEqual({ ok: true, projectRoot: "/repo" });
  });

  it("skips when cwd is outside expected project root", () => {
    expect(
      shouldSkipForProject({
        hookCwd: "/other",
        expectedProjectRoot: "/repo",
      }),
    ).toEqual({ ok: false, reason: "cwd-outside-project-root" });
  });
});

describe("decideSessionEndAction", () => {
  it("skips payloads without a session id", () => {
    expect(
      decideSessionEndAction({
        payload: { cwd: "/repo" },
        projectRoot: "/repo",
      }),
    ).toEqual({ type: "skip", reason: "missing-session-id" });
  });

  it("skips when project root is missing", () => {
    expect(
      decideSessionEndAction({
        payload: { session_id: "abc" },
      }),
    ).toEqual({ type: "skip", reason: "missing-project-root" });
  });

  it("runs inline for lightweight payloads", () => {
    const action = decideSessionEndAction({
      payload: { session_id: "abc", cwd: "/repo" },
      projectRoot: "/repo",
    });

    expect(action).toEqual({
      type: "run-inline",
      sessionId: "abc",
      projectRoot: "/repo",
      statusPath: "/repo/.pi/hooks/status/session-end/abc.json",
      payloadSnapshotPath: "/repo/.pi/hooks/session-end/abc.payload.json",
    });
  });

  it("queues background work when transcript processing is needed", () => {
    const action = decideSessionEndAction({
      payload: {
        session_id: "abc",
        cwd: "/repo",
        transcript_path: "/repo/.claude/transcript.jsonl",
      },
      projectRoot: "/repo",
    });

    expect(action).toEqual({
      type: "queue-background",
      sessionId: "abc",
      projectRoot: "/repo",
      statusPath: "/repo/.pi/hooks/status/session-end/abc.json",
      payloadSnapshotPath: "/repo/.pi/hooks/session-end/abc.payload.json",
    });
  });

  it("skips work that already completed", () => {
    expect(
      decideSessionEndAction({
        payload: { session_id: "abc", cwd: "/repo" },
        projectRoot: "/repo",
        existingState: "done",
      }),
    ).toEqual({ type: "skip", reason: "already-done" });
  });

  it("skips work that is already queued or running", () => {
    expect(
      decideSessionEndAction({
        payload: { session_id: "abc", cwd: "/repo" },
        projectRoot: "/repo",
        existingState: "running",
      }),
    ).toEqual({ type: "skip", reason: "already-running" });
  });
});
