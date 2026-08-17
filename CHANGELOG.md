# Changelog

## v0.11.0 — Web terminal: panes, shares, charts, and a hosted client that loads

One release note for the hosted web terminal ship.

### Panes

- **Futures** (`FUT`), **AI benchmarks** (`AIBENCH`), **Plugins**, **SEC filings**, **Connections**, **API Keys**, **Polls**, Adjacent indices/rates, and **RSS**.
- TradingView charts with universal series expressions, plus prediction-market series (`G KALSHI:…` / `G POLY:…` / `G ADJ:…`).
- News/article reader with command-bar article lookup; TV live and labelled replays.
- Slim public share pages for articles, charts, and tables (`/article`, `/s/…`) instead of booting the full terminal.

### Features

- Hosted client boots reliably; layouts and plugin config persist per user and sync via Gloom Cloud (BYOK keys stay local). On-device AI when Chrome’s model is available.
- Share charts, articles, and changelog entries with `y`. Open in terminal; logged-out visitors must sign up (Skip hidden). Share chrome matches the terminal pane (grip, title, `[o]`pen).
- Chart quick-add understands Ask-AI-style natural language into series expressions. Faster Jina article fetches that strip nav, cookie, and JS chrome.
- `FONT+` / `FONT-` scale the whole grid. Pane suggestions in the header; version lives in the status bar.

### Fixes

- Loading hang and terminal startup crashes; TradingView pan stutter; Mac trackpad pinch/scroll zoom on charts.
- Status bar version / @user / delayed chip no longer clips; click the version to open Changelog. Suggestions strip spacing cleaned up.
- Share link hangs and 502s; local AI status no longer stuck on checking; Tab, Ctrl+N, and arrow navigation on web.
- EDGAR/CORS on hosted, broken Adjacent Indices search, IBKR GBX P&L, and non-`http(s)` URL schemes rejected at open.
