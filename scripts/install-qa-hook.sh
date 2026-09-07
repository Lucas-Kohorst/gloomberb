#!/usr/bin/env bash
# Install the default pre-push hook into the repo's .git/hooks.
# Do not write to core.hooksPath: a global dispatcher (bb) already lives there
# and execs $GIT_DIR/hooks/<name> after its own work.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if ! git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  echo "qa: skip hook install (not a git checkout)"
  exit 0
fi
HOOK_DIR="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)/hooks"
mkdir -p "$HOOK_DIR"
install -m 0755 "$ROOT/scripts/githooks/pre-push" "$HOOK_DIR/pre-push"
echo "qa: installed $HOOK_DIR/pre-push"
echo "qa: pre-push runs bun run qa --hook (tests + CLI data shape)."
echo "qa: set GLOOM_QA_LIVE=1 to also boot the TUI via pilotty."
