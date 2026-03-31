import { join, resolve } from "node:path";

export type SessionEndPayload = {
  session_id?: string;
  cwd?: string;
  transcript_path?: string;
};

export type SessionEndAction =
  | { type: "skip"; reason: string }
  | {
      type: "run-inline" | "queue-background";
      sessionId: string;
      projectRoot: string;
      statusPath: string;
      payloadSnapshotPath: string;
    };

export function sessionEndStatusPath(
  projectRoot: string,
  sessionId: string,
): string {
  return join(
    resolve(projectRoot),
    ".pi",
    "hooks",
    "status",
    "session-end",
    `${sessionId}.json`,
  );
}

export function sessionEndPayloadSnapshotPath(
  projectRoot: string,
  sessionId: string,
): string {
  return join(
    resolve(projectRoot),
    ".pi",
    "hooks",
    "session-end",
    `${sessionId}.payload.json`,
  );
}

export function decideSessionEndAction(input: {
  payload: SessionEndPayload;
  projectRoot?: string;
  existingState?: "queued" | "running" | "done" | "failed" | "skipped";
}): SessionEndAction {
  const sessionId = input.payload.session_id?.trim();
  if (!sessionId) return { type: "skip", reason: "missing-session-id" };

  const projectRoot = input.projectRoot?.trim();
  if (!projectRoot) return { type: "skip", reason: "missing-project-root" };

  if (input.existingState === "done") {
    return { type: "skip", reason: "already-done" };
  }

  if (input.existingState === "queued" || input.existingState === "running") {
    return { type: "skip", reason: "already-running" };
  }

  const statusPath = sessionEndStatusPath(projectRoot, sessionId);
  const payloadSnapshotPath = sessionEndPayloadSnapshotPath(projectRoot, sessionId);
  const expensive = Boolean(input.payload.transcript_path?.trim());

  return {
    type: expensive ? "queue-background" : "run-inline",
    sessionId,
    projectRoot: resolve(projectRoot),
    statusPath,
    payloadSnapshotPath,
  };
}

export function shouldSkipForProject(input: {
  hookCwd?: string;
  expectedProjectRoot?: string;
}): { ok: true; projectRoot: string } | { ok: false; reason: string } {
  const hookCwd = input.hookCwd?.trim();
  if (!hookCwd) return { ok: false, reason: "missing-cwd" };

  const expectedProjectRoot = input.expectedProjectRoot?.trim();
  if (!expectedProjectRoot) {
    return { ok: true, projectRoot: resolve(hookCwd) };
  }

  const cwd = resolve(hookCwd);
  const projectRoot = resolve(expectedProjectRoot);
  if (cwd === projectRoot || cwd.startsWith(`${projectRoot}/`)) {
    return { ok: true, projectRoot };
  }

  return { ok: false, reason: "cwd-outside-project-root" };
}
