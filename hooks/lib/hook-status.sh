#!/usr/bin/env bash

set -euo pipefail

now_iso() {
  date -Is
}

normalize_path() {
  local path="$1"
  if [ -d "$path" ]; then
    (cd "$path" && pwd -P)
  else
    local dir
    dir="$(dirname "$path")"
    local base
    base="$(basename "$path")"
    printf '%s/%s\n' "$(cd "$dir" 2>/dev/null && pwd -P || printf '%s' "$dir")" "$base"
  fi
}

hook_status_path() {
  local project_root="$1"
  local session_id="$2"
  printf '%s/.pi/hooks/status/session-end/%s.json\n' "$(normalize_path "$project_root")" "$session_id"
}

hook_payload_snapshot_path() {
  local project_root="$1"
  local session_id="$2"
  printf '%s/.pi/hooks/session-end/%s.payload.json\n' "$(normalize_path "$project_root")" "$session_id"
}

ensure_parent_dir() {
  mkdir -p "$(dirname "$1")"
}

read_hook_state() {
  local status_path="$1"
  if [ ! -f "$status_path" ]; then
    return 1
  fi

  jq -r '.state // empty' "$status_path" 2>/dev/null
}

write_hook_status() {
  local status_path="$1"
  local hook="$2"
  local session_id="$3"
  local project_root="$4"
  local state="$5"
  local reason="${6:-}"
  local error_message="${7:-}"

  ensure_parent_dir "$status_path"

  jq -n \
    --arg hook "$hook" \
    --arg session_id "$session_id" \
    --arg project_root "$(normalize_path "$project_root")" \
    --arg state "$state" \
    --arg reason "$reason" \
    --arg error "$error_message" \
    --arg ts "$(now_iso)" \
    --arg pid "$$" \
    '{
      hook: $hook,
      sessionId: $session_id,
      projectRoot: $project_root,
      state: $state,
      reason: (if ($reason | length) > 0 then $reason else null end),
      error: (if ($error | length) > 0 then $error else null end),
      timestamp: $ts,
      pid: ($pid | tonumber)
    }' > "$status_path"
}
