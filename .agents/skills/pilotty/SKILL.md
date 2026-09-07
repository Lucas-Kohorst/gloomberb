---
name: pilotty
description: >-
  Live-app QA for Gloomberb data streams and panes using the pilotty CLI on TUI,
  bounded Accessibility on Electrobun desktop, and browser tools on web. Use when
  the user asks to smoke-test, QA, verify streams, check pane crashes, or run
  /pilotty after rapid or merge-smash changes. Prefer this over tmux for live TUI.
  Do not use it for OpenTUI harness tests or CLI-only data checks (see tui-testing).
---

# Pilotty QA

Live Gloomberb, not unit tests. Same fail contract on TUI, desktop, and web. The TUI runner is the CI seed.

CLI data checks and OpenTUI harness tests stay in `.agents/skills/tui-testing/SKILL.md`. OpenTUI component API stays in `.agents/skills/opentui/SKILL.md`.

## Driver

```
What to QA?
├─ Local CI / changed panes / data shape       → bun run qa
├─ Live TUI boot, panes, command bar, streams  → pilotty + bun run qa:tui
├─ Live Electrobun window                      → bun run desktop:build, open, bun run qa:desktop
├─ Live web / term.gloom.sh                    → browser tools, same crash strings
└─ Quotes/plugins without a renderer           → tui-testing CLI
```

Crash and error strings live in `scripts/qa-assertions.txt`. Scan that file. Do not invent a second regex. A painted `undefined` token is a fail. Missing column labels stringify that way without throwing.

## TUI

Install: `npm i -g pilotty` (0.0.11+). Binary: `pilotty`.

```bash
bun run qa                                 # local CI: changed tests + CLI data shape + TUI boot
bun run qa --fast                          # skip live TUI
bun run qa --live --all-panes              # open every pane (skips TV)
bun run qa --hook                          # default pre-push (tests + CLI). GLOOM_QA_LIVE=1 adds TUI
bun run qa:tui
bun run qa:panes                           # every registered pane via remote control
GLOOM_QA_STREAMS=1 bun run qa:tui          # also require OPEN/SPY/news/chat tokens
GLOOM_QA_COMMAND_BAR=1 bun run qa:tui      # Ctrl+P
GLOOM_QA_HOME=/tmp/gloom-qa-home bun run qa:tui   # isolated copy of a real data dir
```

`scripts/qa-tui.sh` boots the TUI and greps `scripts/qa-assertions.txt`. `scripts/qa-panes.sh` then `pane.show`s every registered pane (skips `macro-tv`), snapshots after each, and probes quote/news/markets over remote control. Use `qa:panes` when the question is "which panes still smash," not a single layout screenshot.

Manual loop when the script is not enough:

```bash
pilotty kill -s gloom-qa 2>/dev/null
pilotty spawn --name gloom-qa --cwd "$PWD" env HOME="$GLOOM_QA_HOME" bun src/index.tsx
pilotty resize -s gloom-qa 120 40
pilotty wait-for -s gloom-qa -t 25000 'Search or run a command'
pilotty snapshot -s gloom-qa --format text --settle 800
pilotty key -s gloom-qa Ctrl+P
pilotty type -s gloom-qa 'PL'
pilotty key -s gloom-qa Enter
pilotty kill -s gloom-qa
```

Empty `HOME` is the CI default. For stream QA locally, copy `~/.gloomberb` into a temp dir and set `GLOOM_QA_HOME`. Do not point `HOME` at the real `~/.gloomberb`.

## Desktop

`open` plus a live process is not a pass. The host can sit on port 50000 while the view is a fatal overlay or a pane crash banner.

```bash
bun run desktop:build
# kill leftover launcher/bun by explicit PID, not pkill -f
open build/dev-macos-arm64/Gloomberb-dev.app
bun run qa:desktop
```

`scripts/qa-desktop-ax.sh` requires macOS. It checks port 50000 (not 50001) and `UI elements whose name contains "crashed"`. Do not walk `entire contents`. A leftover bun on 50000 makes the next instance bind 50001 and the view talks to the old socket.

## Web

pilotty does not drive the browser renderer. Use browser tools (or curl for `/health`). Fail on the same strings in `scripts/qa-assertions.txt` in page text. Hosted smoke already lives in `.github/workflows/verify.yml` (`term.gloom.sh/health`).

## Never

- Open `macro-tv` / shortcut `TV` in a live app. It shells out to `mpv` and outlives the session.
- Unbounded log scans or `strings` on a live log.
- `pkill -f Gloomberb-dev.app` (matches the agent wrapper).
- Leave `pilotty` sessions, desktop bun workers, or `bun src/index.tsx` running.

Leak sweep after every run:

```bash
pilotty list-sessions
ps -Ao pid,command | awk '/bun src\/index.tsx/ || /Gloomberb-dev.app\/Contents/'
```

## Data streams

A boot that only shows the header prompt is not a stream pass. With a seeded `GLOOM_QA_HOME`, require at least one of:

- Header quote (`OPEN` / `SPY`)
- News table (`TIME` / `HEADLINE` or a real headline)
- Chat (`#equities` or `Type a message`)
- Command bar (`Commands` after Ctrl+P)

`bun run qa:panes` is the all-panes pass. Layout tabs are not a catalog. One pane error boundary is a fail even if the host stays up. A header of `undefined` is also a fail. The pane did not crash. The column map dropped a label.

## CI

`bun run qa` is the local CI. `bun install` installs a default pre-push hook that runs `bun run qa --hook` (changed tests + CLI data shape). `bun run qa:tui` is the live boot check. `bun run qa:panes` is the catalog check. Both need a PTY, bun, and pilotty. Do not add a GitHub job until `qa:tui` is green locally. Desktop AX stays macOS-agent for now. Keep TV out of the fixture. The header no longer paints a "Gloomberb" wordmark; wait for the command prompt instead.

To add a check, edit `scripts/qa-assertions.txt`, `scripts/qa-tui.sh`, or `scripts/qa-panes.ts`. Do not only write it in this file.
