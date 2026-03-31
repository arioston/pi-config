#!/usr/bin/env bash

set -euo pipefail

normalize_path() {
  local path="$1"
  (cd "$path" && pwd -P)
}

resolve_git_top_level() {
  local cwd="$1"
  git -C "$cwd" rev-parse --show-toplevel 2>/dev/null || true
}

resolve_execution_context() {
  local input_cwd="${1:-$PWD}"
  local cwd
  cwd="$(normalize_path "$input_cwd")"

  local env_worktree_root="${PI_WORKTREE_ROOT:-}"
  local env_project_root="${PI_PROJECT_ROOT:-}"
  local git_top_level
  git_top_level="$(resolve_git_top_level "$cwd")"

  if [ -n "$env_worktree_root" ]; then
    env_worktree_root="$(normalize_path "$env_worktree_root")"
  fi
  if [ -n "$env_project_root" ]; then
    env_project_root="$(normalize_path "$env_project_root")"
  fi
  if [ -n "$git_top_level" ]; then
    git_top_level="$(normalize_path "$git_top_level")"
  fi

  if [ -n "$env_worktree_root" ] && [ -n "$git_top_level" ] && [ "$env_worktree_root" != "$git_top_level" ] && [[ "$cwd" == "$env_worktree_root"/* || "$cwd" == "$env_worktree_root" ]]; then
    echo "Ambiguous execution context: PI_WORKTREE_ROOT=$env_worktree_root but git resolved $git_top_level" >&2
    return 1
  fi

  if [ -n "$env_worktree_root" ]; then
    export PI_RESOLVED_CWD="$cwd"
    export PI_RESOLVED_PROJECT_ROOT="${env_project_root:-${git_top_level:-$env_worktree_root}}"
    export PI_RESOLVED_WORKTREE_ROOT="$env_worktree_root"
    export PI_RESOLVED_GIT_TOPLEVEL="$git_top_level"
    export PI_RESOLVED_SOURCE="env:worktree"
    return 0
  fi

  if [ -n "$env_project_root" ]; then
    export PI_RESOLVED_CWD="$cwd"
    export PI_RESOLVED_PROJECT_ROOT="$env_project_root"
    export PI_RESOLVED_WORKTREE_ROOT="${git_top_level:-$env_project_root}"
    export PI_RESOLVED_GIT_TOPLEVEL="$git_top_level"
    export PI_RESOLVED_SOURCE="env:project"
    return 0
  fi

  if [ -n "$git_top_level" ]; then
    export PI_RESOLVED_CWD="$cwd"
    export PI_RESOLVED_PROJECT_ROOT="$git_top_level"
    export PI_RESOLVED_WORKTREE_ROOT="$git_top_level"
    export PI_RESOLVED_GIT_TOPLEVEL="$git_top_level"
    export PI_RESOLVED_SOURCE="git"
    return 0
  fi

  export PI_RESOLVED_CWD="$cwd"
  export PI_RESOLVED_PROJECT_ROOT="$cwd"
  export PI_RESOLVED_WORKTREE_ROOT="$cwd"
  export PI_RESOLVED_GIT_TOPLEVEL=""
  export PI_RESOLVED_SOURCE="cwd"
}
