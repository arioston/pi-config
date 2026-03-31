#!/usr/bin/env bash

set -euo pipefail

normalize_path() {
  local path="$1"
  (cd "$path" && pwd -P)
}

guard_project_cwd() {
  local hook_cwd="${1:-}"
  local expected_project_root="${2:-}"

  if [ -z "$hook_cwd" ] || [ ! -d "$hook_cwd" ]; then
    return 1
  fi

  local normalized_cwd
  normalized_cwd="$(normalize_path "$hook_cwd")"

  if [ -z "$expected_project_root" ]; then
    printf '%s\n' "$normalized_cwd"
    return 0
  fi

  local normalized_project_root
  normalized_project_root="$(normalize_path "$expected_project_root")"

  if [ "$normalized_cwd" = "$normalized_project_root" ] || [[ "$normalized_cwd" == "$normalized_project_root"/* ]]; then
    printf '%s\n' "$normalized_project_root"
    return 0
  fi

  return 1
}
