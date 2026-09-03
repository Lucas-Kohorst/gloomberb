#!/usr/bin/env bash
# Spawn an isolated TUI, then open every registered pane via remote control.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SESSION="${GLOOM_QA_SESSION:-gloom-qa}"
HOME_DIR="${GLOOM_QA_HOME:-}"
WAIT_MS="${GLOOM_QA_WAIT_MS:-25000}"

if ! command -v pilotty >/dev/null 2>&1; then
  echo "qa-panes: install pilotty (npm i -g pilotty)" >&2
  exit 127
fi

cleanup() {
  pilotty kill -s "$SESSION" >/dev/null 2>&1 || true
}
trap cleanup EXIT
pilotty kill -s "$SESSION" >/dev/null 2>&1 || true

if [ -z "$HOME_DIR" ]; then
  HOME_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gloom-qa-home.XXXXXX")"
fi
mkdir -p "$HOME_DIR/.gloomberb"

cd "$ROOT"
if [ ! -f "$HOME_DIR/.gloomberb/config.json" ]; then
  HOME="$HOME_DIR" bun -e '
    import { mkdirSync, writeFileSync } from "fs";
    import { join } from "path";
    import { createDefaultConfig } from "./src/types/config";
    const dir = join(process.env.HOME, ".gloomberb");
    mkdirSync(dir, { recursive: true });
    const config = createDefaultConfig(dir);
    config.onboardingComplete = true;
    writeFileSync(join(dir, "config.json"), JSON.stringify(config));
  '
fi

pilotty spawn --name "$SESSION" --cwd "$ROOT" env HOME="$HOME_DIR" bun src/index.tsx >/dev/null
pilotty resize -s "$SESSION" 120 40 >/dev/null
BOOT_TEXT="${GLOOM_QA_BOOT_TEXT:-Search or run a command}"
if ! pilotty wait-for -s "$SESSION" -t "$WAIT_MS" "$BOOT_TEXT" >/dev/null; then
  echo "qa-panes: TUI did not boot" >&2
  pilotty snapshot -s "$SESSION" --format text --settle 400 >&2 || true
  exit 1
fi

DATA_DIR="$HOME_DIR/.gloomberb"
for _ in $(seq 1 50); do
  if [ -f "$DATA_DIR/remote-control.tui.json" ]; then
    break
  fi
  sleep 0.1
done
if [ ! -f "$DATA_DIR/remote-control.tui.json" ]; then
  echo "qa-panes: remote-control.tui.json never appeared" >&2
  exit 1
fi

GLOOM_QA_SESSION="$SESSION" bun "$ROOT/scripts/qa-panes.ts" --data-dir "$DATA_DIR" "$@"
