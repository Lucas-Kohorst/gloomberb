# 056 — DuckDB vs SQLite (research only, do not implement)

> Analysis for the question: should Gloomberb sit DuckDB on top of our
> SQLite file ([DuckDB SQLite extension](https://duckdb.org/docs/lts/core_extensions/sqlite),
> [PostHog: DuckDB vs SQLite](https://posthog.com/blog/duckdb-vs-sqlite))?
> **Product decision already made for this PR: keep SQLite for the KV cache.
> Do not replace it with DuckDB.**

## Status

- **Priority**: research
- **Effort**: n/a (no code)
- **Risk**: n/a
- **Depends on**: none
- **Category**: storage / analytics
- **Planned at**: 2026-08-25

## What we have today

### Hosted / web (`desktopPlatform === "cloud"`)

There is **no SQLite** in the browser. Persistence is:

| Store | Where | Shape |
|---|---|---|
| Layout, plugin config, RSS, watchlists | `localStorage` via `writeHostedUserConfig()` | JSON blob, keyed by user id |
| Plugin KV (chat cursors, TWIT resume, Substack auth) | `localStorage` via `writeHostedPluginState()` | One JSON map of `pluginId → key → value` |
| Tickers | `localStorage` via hosted ticker persist | JSON array |
| Resource cache (quotes, catalogs, news, charts) | `DesktopMemoryResourceStore` | In-RAM `Map`. Dies on refresh |
| BYOK keys | `writeHostedByokKeys` | Local only, never synced |

Worker `config.save` is a no-op. Cloud sync overlays snapshots after first
paint. A stale cloud pull must not wipe a newer hosted local save.

### Desktop / TUI (Bun + `bun:sqlite`)

`AppPersistence` opens one SQLite file (`src/data/sqlite/database.ts`) with
four tables:

- `tickers` — `metadata TEXT` JSON blob per symbol
- `resource_cache` — namespaced KV: `(namespace, kind, entity_key, variant, source) → payload TEXT`
- `plugin_state` — `(plugin_id, key) → value TEXT`
- `session_snapshots` — one JSON blob per session id

`ResourceStore` (`src/data/resource-store.ts`) treats SQLite as a **JSON-blob
KV cache**: `serializeJson` / `safeParseJson` on every get/set, LRU eviction
at ~25k rows / 100MB, WAL + busy timeout. There are no relational columns for
prices, bars, headlines, or market rows. Point lookup by cache key is the
whole access pattern.

Bun's native SQLite is already in-process, tiny, and on the desktop hot path.

## Why DuckDB-over-SQLite (`ATTACH ... (TYPE sqlite)`) is interesting later

DuckDB's sqlite extension can `ATTACH 'gloomberb.sqlite' AS kv (TYPE sqlite)`
and run SQL over those tables without a dump. That is the *least* invasive
way to get OLAP on data we already persist.

It is interesting **later** if we grow a real warehouse next to the KV:

- Columnar scans, predicate pushdown, parallel hash joins
- `read_parquet` / `read_json` without a load job
- Cross-venue prediction-market joins (Kalshi × Polymarket × Adjacent)
- History rollups (bars, quote prints, news corpus TF-style filters)

PostHog's framing is right: they share "embedded, single-file, in-process"
and almost nothing else. SQLite is OLTP / row / tiny transactions. DuckDB is
OLAP / columnar / vectorized (~2048-wide) scans. One writer each. DuckDB is
~20MB native vs SQLite ~750KB.

## Why it is the wrong first move

1. **Our SQLite is not a warehouse.** `payload TEXT` JSON blobs cannot be
   scanned column-wise. DuckDB-over-SQLite would `json_extract` every row —
   worse than keeping the KV and parsing in JS for point reads.
2. **The snappy path is not SQL.** First paint, Command-K, chat, divider
   drag, and quote ticks are React + coordinator + fetch coalescing. #246
   and #248 already target that. DuckDB does not make `MERGE_QUOTE`, treemap
   relayout, or plugin-state stringify faster.
3. **Hosted has no SQLite to ATTACH.** A DuckDB-on-SQLite design is desktop-
   only unless we also ship DuckDB-WASM, which is a different (and heavier)
   product.
4. **KV semantics would regress.** Cache writes are small, frequent,
   last-write-wins JSON documents with stale/expire timestamps. DuckDB is
   weaker at that than SQLite WAL + `INSERT OR REPLACE`.
5. **Two engines on one file.** ATTACH is convenient, not free: SQLite
   locking vs DuckDB's own WAL, busy_timeout already in our schema, and a
   second native binary in Electrobun.

Keep SQLite as the desktop KV. If we want DuckDB, add it as a **sidecar
analytics store**, not a replacement.

## Where DuckDB WOULD help

| Dataset | Why DuckDB | First slice |
|---|---|---|
| Chart / quote **history** (bars, prints) | Wide time-range scans, resample, as-of join | Desktop Parquet or a real `bars` table; not `resource_cache.payload` |
| **News / RSS / Adjacent** corpus | Filter, search, group-by source/ticker/day across tens of thousands of articles | Export or dual-write headlines to columnar; keep KV for "latest query" |
| **Prediction markets cross-venue** | Join Kalshi + Polymarket + Adjacent on event/time/probability | Read-only ATTACH or Parquet dumps from catalog cache |
| **Parquet → WASM** research views | Query a published history file in the browser without a Worker warehouse | Optional hosted experiment; not default boot |

## Where it would not

- Resource cache get/set by key (current `ResourceStore`)
- Plugin state, session snapshots, ticker metadata
- Hosted first paint / layout / localStorage
- Live quote overlay (coordinator `Map`, not SQL)
- Replacing `bun:sqlite` "because DuckDB is faster"

## Size / WASM vs Bun native SQLite

| Runtime | Engine | Approx size | Fit |
|---|---|---|---|
| Desktop TUI / Electrobun bun | `bun:sqlite` | ~750KB, already linked | KV cache. Keep. |
| Desktop + DuckDB native | DuckDB C++ | ~20MB + sqlite extension | Sidecar analytics, optional |
| Hosted / web | none today | 0 | RAM + localStorage |
| Hosted + DuckDB-WASM | `@duckdb/duckdb-wasm` | tens of MB (MVP + threads/eh bundles), WASM compile on first use | Only if we ship a queryable history file the user opted into |

WASM DuckDB would compete with first-paint work we just spent PRs on. Do not
put it on the default hosted boot. If we try it, lazy-load after interactive,
behind a pane that actually needs `GROUP BY`.

Native desktop DuckDB is the cheaper experiment: one extra binary, ATTACH
read-only, no WASM compile tax, no hosted bundle hit.

## Recommendation

1. **Do not** replace the SQLite KV cache with DuckDB.
2. **Do not** ATTACH DuckDB to `resource_cache` until payloads are real
   columns or we dual-write a warehouse file.
3. **Do** treat DuckDB as a later analytics sidecar if we pick one dataset
   (history bars, news corpus, or PM cross-venue) and a runtime (desktop
   native first, WASM only if hosted must query Parquet in-tab).
4. Keep shipping snappy-UI work (row memo, store notify-once, catalog
   coalescing) — that is the current bottleneck, not SQL.

## Questions (need answers before any DuckDB PR)

1. **Client WASM vs server?** Is the first DuckDB process the Electrobun/Bun
   desktop app, a Cloudflare Worker/DO, or DuckDB-WASM in hosted? Default
   recommendation: **desktop native, read-only sidecar**.
2. **Which dataset first?** History bars, news corpus, or prediction-market
   cross-venue? Pick one; schema work does not generalize for free.
3. **Read-only vs replace cache?** Confirm we never write cache rows through
   DuckDB. SQLite remains the writer; DuckDB ATTACH or a separate `.duckdb` /
   Parquet tree is a reader.
4. **Retention / size cap?** Resource cache already self-limits. A warehouse
   needs an explicit budget (days of bars, article cap) or it will grow
   without bound on disk.
5. **Hosted story?** If the answer to (1) is WASM, are we willing to lazy-load
   tens of MB after first paint, and who publishes the Parquet?
