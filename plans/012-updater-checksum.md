# Plan 012: Add checksum verification to self-updater

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 7065caf..HEAD -- src/updater.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `7065caf`, 2026-08-16

## Why this matters

The self-updater downloads a binary from a GitHub release URL, writes it to
disk, makes it executable, and atomically renames it over the running binary.
No checksum or signature verification exists anywhere in the flow. A
compromised GitHub release, a malicious asset URL, or a TLS-stripping proxy
could deliver a malicious binary that replaces the local `gloomberb`
executable with full user privileges. Adding SHA-256 checksum verification
before the swap prevents installing a tampered binary.

## Current state

**`src/updater.ts`** — `performUpdate` function (lines 349-375+):

```typescript
    onProgress({ phase: "downloading", percent: 0 });

    const res = await fetch(release.downloadUrl);
    if (!res.ok || !res.body) {
      throw new Error(`Download failed: ${res.status}`);
    }

    const contentLength = Number(res.headers.get("content-length") || 0);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (contentLength > 0) {
        onProgress({
          phase: "downloading",
          percent: Math.round((received / contentLength) * 100),
        });
      }
    }

    const downloaded = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      downloaded.set(chunk, offset);
      offset += chunk.byteLength;
    }
```

After download, the binary is decompressed (if gzipped), written to
`execPath + ".update"`, `chmod 0o755`, and atomically renamed over the
running binary. No integrity check exists between download and install.

The release object is fetched from GitHub releases (line 255) and contains
`downloadUrl`, `version`, and other metadata. The GitHub API response also
includes a `digest` field for release assets — verify whether this is available
and populated.

**Convention**: The updater uses `onProgress` callbacks for status updates and
throws `Error` on failures. Match this pattern. The codebase uses `crypto`
from Node/Bun builtins (check existing imports in the file).

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Install   | `bun install`            | exit 0              |
| Typecheck | `bun run typecheck`      | exit 0, no errors   |
| Tests     | `bun test src/updater.test.ts` | all pass      |

## Scope

**In scope** (the only files you should modify):
- `src/updater.ts`
- `src/updater.test.ts` (add tests)

**Out of scope** (do NOT touch):
- The GitHub release fetching logic (line 255 area) — unless adding checksum
  metadata extraction from the API response
- The release script (`scripts/release.sh`) — unless it needs to publish
  checksums alongside the binary
- The binary build process

## Git workflow

- Branch: `advisor/012-updater-checksum`
- Commit message: `Verify SHA-256 checksum before installing update binary`

## Steps

### Step 1: Determine checksum source

Check the GitHub release API response structure used by the updater. The
updater fetches releases from GitHub (line ~255). GitHub's API returns asset
`digest` fields. Check whether:

1. The GitHub API response includes a `digest` field for assets (GitHub added
   SHA-256 digests to the API). If so, extract it from the release metadata.
2. A checksums file is published alongside the release (e.g.,
   `gloomberb-SHA256SUMS.txt`). Check `scripts/release.sh` for whether one is
   created.

If neither exists, the plan must include publishing a checksum file as part
of the release process. In that case, STOP and report — the release script
needs to be modified (out of current scope unless the user approves expanding
scope).

**Verify**: Read `scripts/release.sh` and the release-fetching code in
`src/updater.ts` to determine the checksum source. Document what you find.

### Step 2: Add checksum verification after download

After the `downloaded` Uint8Array is assembled (and before decompression if
applicable), compute the SHA-256 hash and compare it to the expected value:

```typescript
import { createHash } from "crypto";

// After downloaded is assembled:
const hash = createHash("sha256").update(downloaded).digest("hex");
if (expectedChecksum && hash !== expectedChecksum) {
  throw new Error(
    `Checksum mismatch: expected ${expectedChecksum}, got ${hash}. ` +
    "The downloaded binary may be corrupted or tampered with.",
  );
}
```

If the binary is gzipped, compute the checksum on the compressed data (before
decompression) and compare against the checksum of the compressed asset —
that's what GitHub's digest refers to.

**Verify**: `bun run typecheck` → exit 0, no errors

### Step 3: Add tests for checksum verification

Add tests to `src/updater.test.ts`:

- Download succeeds + checksum matches → install proceeds
- Download succeeds + checksum mismatch → throws with clear message
- Download succeeds + no checksum available (expectedChecksum is null/undefined)
  → install proceeds (backward compatibility with older releases)

Model after existing tests in `src/updater.test.ts`. Mock `fetch` to return
a controlled binary and set the expected checksum accordingly.

**Verify**: `bun test src/updater.test.ts` → all pass

### Step 4: Verify full test suite

**Verify**: `bun test` → all pass

## Test plan

- Tests in `src/updater.test.ts`
- Cases: checksum match (install proceeds), checksum mismatch (throws), no
  checksum available (backward compatible)
- Pattern: existing tests in `src/updater.test.ts`

## Done criteria

- [ ] `bun run typecheck` exits 0
- [ ] `bun test src/updater.test.ts` exits 0; new tests pass
- [ ] `bun test` exits 0 (no regressions)
- [ ] `grep -n "sha256\|createHash\|checksum" src/updater.ts` returns matches
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts.
- No checksum source is available from the GitHub API or release artifacts —
  the release script (`scripts/release.sh`) must be modified to publish
  checksums, which is out of scope. Report so scope can be expanded.
- The updater handles multiple platforms/architectures with different download
  URLs — report the structure so checksum mapping can be designed correctly.
- The binary is compressed with a format other than gzip — report so the
  checksum computation point can be adjusted.

## Maintenance notes

- The release script must publish checksums (SHA-256) alongside each release
  for this verification to work. If it doesn't yet, that's a follow-up task.
- If the update mechanism changes (e.g., delta updates, multi-file updates),
  the checksum verification must cover all downloaded files.
- A reviewer should test by manually corrupting a downloaded binary and
  verifying the updater rejects it with the checksum mismatch error.
