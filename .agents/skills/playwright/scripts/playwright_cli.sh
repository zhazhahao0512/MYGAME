#!/usr/bin/env bash
set -euo pipefail

# MYGAME adaptation, 2026-10-19: pin CLI and keep npm cache writable.
export npm_config_cache="${npm_config_cache:-${TMPDIR:-/tmp}/mygame-skill-npm-cache}"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-${TMPDIR:-/tmp}/mygame-skill-cache}"

if ! command -v npx >/dev/null 2>&1; then
  echo "Error: npx is required but not found on PATH." >&2
  exit 1
fi

has_session_flag="false"
for arg in "$@"; do
  case "$arg" in
    --session|--session=*)
      has_session_flag="true"
      break
      ;;
  esac
done

cmd=(npx --yes --package @playwright/cli@0.1.22 playwright-cli)
if [[ "${has_session_flag}" != "true" && -n "${PLAYWRIGHT_CLI_SESSION:-}" ]]; then
  cmd+=(--session "${PLAYWRIGHT_CLI_SESSION}")
fi
cmd+=("$@")

exec "${cmd[@]}"
