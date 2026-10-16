#!/bin/sh
set -eu
if [ "$#" -gt 1 ]; then
  echo 'Usage: sh start.sh [PORT]' >&2
  exit 1
fi
DEPLOY_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js is required. Install Node.js 22.12+ (24 LTS recommended).' >&2
  exit 1
fi
if [ "$#" -eq 1 ]; then
  exec node "$DEPLOY_DIR/server.mjs" --port "$1"
fi
exec node "$DEPLOY_DIR/server.mjs"
