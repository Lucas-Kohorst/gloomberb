# Plan 016: Add plugin discovery via GitHub search

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 7065caf..HEAD -- src/cli/commands/plugins.ts src/cli/index.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `7065caf`, 2026-08-16

## Why this matters

Gloomberb has a mature plugin system (10+ registration methods, CLI install,
update, remove) but no discovery mechanism. Users must know the exact GitHub
`user/repo` to install a plugin — there's no search, browse, or featured list.
This limits the plugin ecosystem to users who already know what they're looking
for. Adding `gloomberb search <query>` that queries the GitHub API for repos
with a `gloomberb-plugin` topic or `gloomberb` keyword provides a zero-infrastructure
discovery path that validates demand before investing in a hosted registry.

This is a **design/spike plan** — it defines the API and implements a minimal
version, but leaves a full hosted registry as a future decision.

## Current state

**`src/cli/commands/plugins.ts`** — the plugin CLI module. Key functions:

- `installPlugin(ref: string)` — parses `user/repo` or GitHub URL, runs
  `git clone --depth 1`, optionally `bun install`, validates the plugin export.
- `removePlugin(name: string)` — deletes the plugin directory.
- `updatePlugins(name?: string)` — runs `git pull --ff-only` on installed plugins.
- `listPlugins()` — lists installed plugins from `~/.gloomberb/plugins/`.

The module uses `execFileSync` for git operations and `cliStyles`, `renderSection`,
`renderTable` for CLI output.

**`src/cli/index.ts`** — the CLI entry point. Plugin commands are registered
around line 140:
```
gloomberb install <user/repo>   → installPlugin
gloomberb plugins               → listPlugins
gloomberb update [name]         → updatePlugins
gloomberb remove <name>         → removePlugin
```

**Convention**: CLI commands use `cliStyles` for colored output, `renderTable`
for tabular data, and `renderSection` for headers. See `src/utils/cli-output.ts`
for the full API. Errors use `fail()` from `src/cli/errors.ts`.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Install   | `bun install`            | exit 0              |
| Typecheck | `bun run typecheck`      | exit 0, no errors   |
| Tests     | `bun test`               | all pass            |

## Scope

**In scope** (the only files you should modify):
- `src/cli/commands/plugins.ts` — add `searchPlugins` function
- `src/cli/index.ts` — register the `search` subcommand
- `src/cli/commands/plugins.test.ts` (create if not exists, or add to existing test file)

**Out of scope** (do NOT touch):
- `installPlugin`, `removePlugin`, `updatePlugins`, `listPlugins` — existing
  functions are not modified
- The plugin loader (`src/plugins/loader.ts`)
- PLUGINS.md — documentation update is a follow-up after the feature works
- A hosted registry or submission system — this is the lightweight GitHub
  search approach only

## Git workflow

- Branch: `advisor/016-plugin-discovery`
- Commit message: `Add plugin search via GitHub API`

## Steps

### Step 1: Implement `searchPlugins` function

In `src/cli/commands/plugins.ts`, add a new exported function:

```typescript
export async function searchPlugins(query: string) {
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", `${query} topic:gloomberb-plugin`);
  url.searchParams.set("sort", "stars");
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", "20");

  const res = await fetch(url.toString(), {
    headers: {
      "Accept": "application/vnd.github+json",
      "User-Agent": "gloomberb",
    },
  });

  if (!res.ok) {
    fail(`GitHub search failed: ${res.status}`);
  }

  const data = await res.json() as {
    items: Array<{
      full_name: string;
      description: string | null;
      stargazers_count: number;
      html_url: string;
    }>;
  };

  if (data.items.length === 0) {
    console.log(cliStyles.muted(`No plugins found for "${query}".`));
    console.log(cliStyles.muted("Try a different keyword, or install directly with: gloomberb install <user/repo>"));
    return;
  }

  console.log(renderSection("Plugin Search Results"));
  const rows = data.items.map((item) => [
    item.full_name,
    String(item.stargazers_count),
    item.description ?? "—",
  ]);
  console.log(renderTable(
    [
      { header: "Plugin" },
      { header: "Stars" },
      { header: "Description" },
    ],
    rows,
  ));
  console.log("");
  console.log(cliStyles.muted(`Install with: gloomberb install <user/repo>`));
}
```

Also try a fallback search without the topic filter if the topic-specific
search returns no results:

```typescript
  // Fallback: search by keyword if topic search returns nothing
  if (data.items.length === 0) {
    url.searchParams.set("q", `${query} gloomberb in:name,description`);
    // ... re-fetch and display
  }
```

**Verify**: `bun run typecheck` → exit 0, no errors

### Step 2: Register the search command in the CLI

In `src/cli/index.ts`, add the `search` subcommand near the existing plugin
commands:

```typescript
  // Near the existing plugin commands:
  if (command === "search" || command === "plugin-search") {
    const query = args.join(" ").trim();
    if (!query) {
      fail("Usage: gloomberb search <query>");
    }
    await searchPlugins(query);
    return;
  }
```

Follow the existing pattern for how commands are parsed and dispatched in
`src/cli/index.ts`. Read the file to understand the command routing structure.

**Verify**: `bun run typecheck` → exit 0, no errors

### Step 3: Test the search function

Test manually:
```
bun src/cli/index.ts search portfolio
```

Verify that results are displayed in a table format with plugin name, stars,
and description.

**Verify**: Command runs and displays results (or a "no results" message)

### Step 4: Add unit tests

Create or add to `src/cli/commands/plugins.test.ts`:

- Mock `fetch` to return a controlled GitHub API response
- Verify `searchPlugins` renders the results table
- Verify `searchPlugins` shows a "no results" message when the API returns empty
- Verify `searchPlugins` calls `fail` when the API returns an error

Pattern after `src/cli.test.ts` for CLI testing structure.

**Verify**: `bun test src/cli/commands/plugins.test.ts` → all pass

### Step 5: Update README

Add `gloomberb search <query>` to the CLI command table in `README.md`:

```
| `gloomberb search <query>` | Search for plugins on GitHub |
```

Add to the "Installing plugins" section in `PLUGINS.md`:

```
Search for plugins:
```bash
gloomberb search portfolio    # search by keyword
```

**Verify**: `grep "search" README.md` shows the new command in the CLI table

## Test plan

- Tests in `src/cli/commands/plugins.test.ts`
- Cases: results displayed, no results message, API error handling
- Pattern: `src/cli.test.ts`

## Done criteria

- [ ] `bun run typecheck` exits 0
- [ ] `bun test` exits 0; new tests pass
- [ ] `bun src/cli/index.ts search <query>` displays results for a real query
- [ ] `grep "searchPlugins" src/cli/commands/plugins.ts` returns a match
- [ ] `grep "search" src/cli/index.ts` returns a match in the command routing
- [ ] `grep "search" README.md` shows the new command in the CLI table
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts.
- The GitHub API search endpoint requires authentication for the query volume
  expected — report so an unauthenticated fallback or a token-based approach
  can be designed.
- The CLI command routing in `src/cli/index.ts` uses a different pattern than
  the one described (e.g., a command registry or subcommand parser) — report
  the actual pattern so the registration can be adjusted.
- No repos currently use the `gloomberb-plugin` topic — the search will return
  empty results. This is expected for a new ecosystem; the keyword fallback
  should handle it. Report if the fallback also returns nothing.

## Maintenance notes

- The GitHub API has rate limits for unauthenticated requests (60/hour). If
  search usage grows, consider adding optional GitHub token support via an
  environment variable.
- When a hosted registry is eventually built, `searchPlugins` can be updated
  to query it instead of (or in addition to) the GitHub API.
- A reviewer should test with a few different queries and verify the output
  is useful and the install flow works from search results.
