#!/usr/bin/env bash
# Bounded AX scan of the running Electrobun window. macOS only. Process-alive is not a pass.
# Kill leftovers by explicit PID. Never pkill -f Gloomberb-dev.app (it matches the wrapper).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${GLOOM_QA_APP:-$ROOT/build/dev-macos-arm64/Gloomberb-dev.app}"
ASSERTIONS="$ROOT/scripts/qa-assertions.txt"
WAIT_S="${GLOOM_QA_DESKTOP_WAIT:-8}"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "qa-desktop-ax: macOS only" >&2
  exit 2
fi

bun_pid() {
  ps -Ao pid=,command= | awk '/Gloomberb-dev.app\/Contents\/MacOS\/\.\.\/Resources\/main.js/ {print $1; exit}'
}

if [ -z "$(bun_pid)" ]; then
  if [ ! -d "$APP" ]; then
    echo "qa-desktop-ax: missing $APP (run bun run desktop:build)" >&2
    exit 1
  fi
  open "$APP"
  for _ in $(seq 1 "$WAIT_S"); do
    [ -n "$(bun_pid)" ] && break
    sleep 1
  done
fi

BUN_PID="$(bun_pid)"
if [ -z "$BUN_PID" ]; then
  echo "qa-desktop-ax: Gloomberb bun process not found" >&2
  exit 1
fi

if ! lsof -nP -iTCP:50000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "qa-desktop-ax: port 50000 is not listening (RPC may have bound 50001)" >&2
  lsof -nP -iTCP:50000 -sTCP:LISTEN 2>/dev/null || true
  lsof -nP -iTCP:50001 -sTCP:LISTEN 2>/dev/null || true
  exit 1
fi

sleep 2

REPORT="$(perl -e 'alarm 25; exec @ARGV' osascript - "$BUN_PID" <<'APPLESCRIPT'
on run argv
  set bunPid to item 1 of argv as integer
  tell application "System Events"
    set p to first process whose unix id is bunPid
    try
      set wname to name of window 1 of p
    on error
      return "NO_WINDOW"
    end try
    set inner to UI element 1 of UI element 1 of scroll area 1 of group 1 of group 1 of window 1 of p
    set crashed to (UI elements of inner whose name contains "crashed")
    set report to "window=" & wname & linefeed & "crashedCount=" & (count of crashed) & linefeed
    repeat with e in crashed
      set report to report & (name of e as text) & linefeed
    end repeat
    return report
  end tell
end run
APPLESCRIPT
)"

echo "$REPORT"

if echo "$REPORT" | grep -q '^NO_WINDOW'; then
  echo "qa-desktop-ax: no Gloomberb window" >&2
  exit 1
fi

if echo "$REPORT" | grep -aE -f "$ASSERTIONS" >/dev/null; then
  echo "qa-desktop-ax: crash banner in AX tree" >&2
  exit 1
fi

echo "qa-desktop-ax: pass"
