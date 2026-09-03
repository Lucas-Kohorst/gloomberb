#!/usr/bin/env bash
# Live TUI smoke via pilotty. Isolated HOME. Exit 1 on crash banners or missing boot text.
# CI needs a PTY, bun, and pilotty on PATH. Do not open the TV pane.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SESSION="${GLOOM_QA_SESSION:-gloom-qa}"
HOME_DIR="${GLOOM_QA_HOME:-}"
ASSERTIONS="$ROOT/scripts/qa-assertions.txt"
COLS="${GLOOM_QA_COLS:-120}"
ROWS="${GLOOM_QA_ROWS:-40}"
WAIT_MS="${GLOOM_QA_WAIT_MS:-25000}"
SETTLE_MS="${GLOOM_QA_SETTLE_MS:-800}"

if ! command -v pilotty >/dev/null 2>&1; then
  echo "qa-tui: install pilotty (npm i -g pilotty) and put it on PATH" >&2
  exit 127
fi
if ! command -v bun >/dev/null 2>&1; then
  echo "qa-tui: bun is required" >&2
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
pilotty resize -s "$SESSION" "$COLS" "$ROWS" >/dev/null

dump_fail() {
  local snap
  snap="$(pilotty snapshot -s "$SESSION" --format text --settle "$SETTLE_MS" 2>/dev/null || true)"
  echo "$snap" >&2
  echo "$snap" | grep -aE -f "$ASSERTIONS" >&2 || true
}

BOOT_TEXT="${GLOOM_QA_BOOT_TEXT:-Search or run a command}"
if ! pilotty wait-for -s "$SESSION" -t "$WAIT_MS" "$BOOT_TEXT" >/dev/null; then
  if ! pilotty wait-for -s "$SESSION" -t 4000 "Search" >/dev/null; then
    echo "qa-tui: boot prompt did not appear" >&2
    dump_fail
    exit 1
  fi
fi

SNAP="$(pilotty snapshot -s "$SESSION" --format text --settle "$SETTLE_MS")"
echo "$SNAP"

if echo "$SNAP" | grep -aE -f "$ASSERTIONS" >/dev/null; then
  echo "qa-tui: crash banner or runtime error in snapshot" >&2
  echo "$SNAP" | grep -aE -f "$ASSERTIONS" >&2 || true
  exit 1
fi

if [ "${GLOOM_QA_STREAMS:-0}" = "1" ]; then
  if ! echo "$SNAP" | grep -aE 'OPEN|SPY |Ctrl\+P|Top News|#equities' >/dev/null; then
    echo "qa-tui: no data-stream tokens (OPEN/SPY/Top News/#equities/Ctrl+P)" >&2
    exit 1
  fi
fi

if [ "${GLOOM_QA_COMMAND_BAR:-0}" = "1" ]; then
  pilotty key -s "$SESSION" Ctrl+P >/dev/null
  sleep 0.6
  BAR="$(pilotty snapshot -s "$SESSION" --format text --settle 400)"
  if ! echo "$BAR" | grep -aE 'Commands|Command or plain English' >/dev/null; then
    echo "qa-tui: Ctrl+P did not open the command bar" >&2
    echo "$BAR" >&2
    exit 1
  fi
  if echo "$BAR" | grep -aE -f "$ASSERTIONS" >/dev/null; then
    echo "qa-tui: crash banner after Ctrl+P" >&2
    echo "$BAR" | grep -aE -f "$ASSERTIONS" >&2 || true
    exit 1
  fi
  pilotty key -s "$SESSION" Escape >/dev/null
fi

echo "qa-tui: pass"
