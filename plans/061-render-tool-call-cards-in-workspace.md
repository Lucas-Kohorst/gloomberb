# 061 — Render tool-call cards in the AI workspace pane

> The agent runs in `structured` mode and calls tools (remote control, CLI,
> show, plugin files) as it works. The user sees only the final text reply
> and the thinking disclosure. There is no visibility into *what* the agent
> called, *what arguments* it passed, or *what it got back*. This plan wires
> the existing tool-call / tool-result data — already delivered by
> `onAgentMessages` — into inline cards between the user message and the
> assistant response.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (render-only; no protocol or host change)
- **Depends on**: existing AI Agent pane + `runAgent` structured path (already on `main`)
- **Category**: agents / UX
- **Planned at**: 2026-08-26, `origin/main` @ `c01396c5`

## What is already true (do not rebuild)

| Piece | Where | Use it |
|---|---|---|
| Structured agent run | `host.ts` `runAgent` for `outputMode: "structured"` | already wired in `pane.tsx` `sendMessage` |
| `onAgentMessages` callback | `runner.ts` → `host.ts:641` calls `runOptions.onAgentMessages?.(normalizeAiAgentHistory(result.messages))` | pane already captures it into `completedAgentMessages` |
| Tool-call content type | `AiAgentToolCallContent` in `agent-history.ts` (`type: "toolCall"`, `id`, `name`, `arguments`) | appears inside assistant `content[]` |
| Tool-result message | `AiAgentHistoryMessage` variant `role: "toolResult"` (`toolCallId`, `toolName`, `content: AiAgentTextContent[]`, `isError`) | paired by `toolCallId` |
| Custom message types | `model.ts` declares `toolCard`, `buildProgress`, `notification` in `CustomAgentMessages` | **declared but unused** — this plan consumes `toolCard` |
| Thinking disclosure pattern | `AgentThinkingDisclosure` in `pane.tsx` | same expand/collapse idiom for cards |
| Transcript persistence | `appendLocalAgentTranscript` stores `agentMessages` on the thread | cards derive from this on reload too |

Verified against the runtime: `runtime.runAgent` returns
`{ text, messages: [userMessage, ...resultMessages] }` where `resultMessages`
includes assistant messages carrying `toolCall` content blocks **and** the
`toolResult` messages the agent core produced. `host.ts` normalizes them through
`normalizeAiAgentHistory`, which preserves both. The host test
`returns and replays native tool-call and tool-result history`
(`pi/host.test.ts:533`) asserts the exact shape `onAgentMessages` delivers:

```
["user", "assistant" (toolCall), "toolResult", "assistant"]
```

So the data is already in `completedAgentMessages` inside `sendMessage`. The
pane just doesn't render it.

## The problem

`sendMessage` in `pane.tsx`:

1. Captures `completedAgentMessages` via `onAgentMessages`.
2. After the run resolves, appends **one** assistant `LocalAgentMessage`
   (text + optional thinking) and the transcript delta.
3. Renders only `activeThread.messages` — user bubbles and assistant bubbles.

Tool calls and results live only in `thread.agentMessages`, which is used to
rebuild the next prompt but never shown. A user who asks "open my watchlist
pane" sees the watchlist open but the chat shows only the assistant's prose
summary, with no record of the `gloomberb_show` call, its arguments, or
whether it succeeded.

## The plan

### 1. Derive tool cards from the transcript

Add a pure helper that walks an `AiAgentHistoryMessage[]` slice and emits
ordered tool-card records. One card per `toolCall` content block, matched
to its `toolResult` by `toolCallId`.

```ts
export interface AgentToolCard {
  id: string;          // the toolCall id — stable across reloads
  toolName: string;
  arguments: Record<string, unknown>;
  status: "running" | "success" | "error";
  result?: string;     // joined toolResult text, truncated at render time
  isError: boolean;
}

export function extractToolCards(
  messages: readonly AiAgentHistoryMessage[],
): AgentToolCard[];
```

Rules:
- Walk in order. For each assistant message, emit a card with `status:
  "running"` for every `toolCall` content block.
- For each `toolResult` message, find the card with matching `id ===
  toolCallId` and set `status` to `isError ? "error" : "success"`, joining
  its `content[].text` into `result`.
- A card with no matching result stays `"running"` (the run was cancelled or
  is mid-flight). Render it as such; do not invent a result.
- Place this in `agent-history.ts` next to `extractThinkingTurns` — it is a
  pure function over the same types and is independently testable.

Why a new helper and not inline in the pane: the pane render is already
large (~1000 lines), the pairing logic is non-trivial (id match, error
status, missing result), and it must produce the same output on reload from
the persisted `agentMessages` as it did live. A pure function with unit
tests is the leverage point.

### 2. Carry tool cards on the assistant message

Extend `LocalAgentMessage` in `model.ts` with an optional `toolCards?:
  AgentToolCard[]` field. This keeps cards tied to the assistant turn they
belong to and survives `normalizeMessage` round-trips.

- Add `toolCards` to `normalizeMessage`: validate it as an array of
  `AgentToolCard` (id, toolName, arguments record, status enum, isError
  boolean, optional result string). Drop entries that fail the guard.
  This matches the existing defensive normalization for `attachments`
  and `thinking`.
- Do **not** use the `toolCard` `CustomAgentMessages` role for this. That
  declaration is for pi-agent-core messages that flow through the agent
  protocol; our cards are a UI projection of `toolCall` + `toolResult`
  content that already exists. Reusing it would imply we inject synthetic
  messages into the transcript, which we do not. Leave the declaration in
  place (it is harmless and a future plan may use it for build progress),
  but this plan renders from `LocalAgentMessage.toolCards`.

### 3. Compute cards in `sendMessage` and persist them

In `sendMessage`, after the run resolves (success, cancel, and error
branches), compute the cards for this turn from `completedAgentMessages`
and attach them to the assistant `LocalAgentMessage`:

```ts
const toolCards = extractToolCards(
  completedAgentMessages.length
    ? completedAgentMessages
    : [{ role: "user", content: prompt }, { role: "assistant", content: [...] }],
);
```

Then pass `...(toolCards.length ? { toolCards } : {})` into the assistant
message object in all three `appendLocalAgentMessages` calls (success,
cancelled, error). The fallback path (no `completedAgentMessages`) yields
no cards, which is correct — a non-agent run has no tool calls.

For the **streaming** view (while `runningMessageId` is set and the run is
in flight), we do not yet have `completedAgentMessages`, so we cannot show
live cards during the run. That is acceptable for v0: cards appear when the
turn completes. A future plan can stream cards from `onEvent`'s
`message_update` events; do not build that here.

### 4. Render the cards inline

In the message render loop in `pane.tsx`, after the assistant label and
thinking disclosure and before the `MarkdownText` body, render the cards
for assistant messages that carry `toolCards`:

```tsx
{message.toolCards?.map((card) => (
  <AgentToolCardView
    key={card.id}
    card={card}
    lineWidth={contentWidth}
    expanded={expandedToolCardIds.has(card.id)}
    onToggle={() => setExpandedToolCardIds((current) => toggleExpanded(current, card.id))}
  />
))}
```

`AgentToolCardView` (new component in `pane.tsx`, next to
`AgentThinkingDisclosure`):

- A one-line header: `▸ toolName · status` with status color
  (`success` = `colors.positive`, `error` = `colors.warning`, `running` =
  `colors.textMuted`). Click toggles expand.
- Expanded view shows:
  - **Arguments**: `JSON.stringify(card.arguments)` truncated to one line
    (use `truncateWithEllipsis`), or a short key=value list if small.
  - **Result** (when present): the joined `card.result`, truncated to a
    bounded height `ScrollBox` (same pattern as the attachment preview —
    `Math.min(8, ...)` rows). Use `colors.textDim`.
- Reuse the `AgentThinkingDisclosure` expand/collapse idiom: a `Box` with
  `onMouseDown` toggle, `▸`/`▾` marker, `TextAttributes` for the header.
- Do not render a card with `status: "running"` as expanded-by-default; it
  has no result yet. Render its header only.

Information density (AGENTS.md): the header already names the tool and
status, so the expanded body starts with **Arguments:** / **Result:** labels,
not a repeat of the tool name. Do not add a fixed footer hint for tool cards
— they are not the selected detail item, and `[o]`pen does not apply to a
tool result.

### 5. Expanded-card state

Add `expandedToolCardIds` state alongside `expandedThinkingIds`, using the
same `toggleExpanded` helper (rename to a generic `toggleExpandedId` or add
a sibling `toggleExpandedToolCard`). Card ids are the `toolCall` ids, which
are stable across reloads, so expansion state survives a thread switch
within the session (it is in-memory state, not persisted — same as
thinking).

## Files in scope

- `src/plugins/builtin/ai/agent-history.ts` — add `AgentToolCard` type and
  `extractToolCards` pure helper.
- `src/plugins/builtin/ai/workspace/model.ts` — add optional `toolCards` to
  `LocalAgentMessage`; validate in `normalizeMessage`.
- `src/plugins/builtin/ai/workspace/pane.tsx` — compute cards in
  `sendMessage`, render `AgentToolCardView`, add expand state.

## Files out of scope

- `src/plugins/builtin/ai/pi/host.ts` — already delivers
  `onAgentMessages` with tool-call content. Do not touch.
- `src/plugins/builtin/ai/pi/runtime.ts` — already returns
  `resultMessages` with tool calls/results. Do not touch.
- `src/plugins/builtin/ai/runner.ts` — `onAgentMessages` plumbing is
  complete. Do not touch.
- `src/plugins/builtin/ai/tools.ts` — the in-pane `parseToolCalls` /
  `executeToolCall` path is a separate legacy fallback for plain-mode
  runs; this plan does not change it. The structured agent path handles
  tools inside the agent core.

## Tests worth keeping

Per AGENTS.md: keep tests only for non-obvious behavior with a real
regression risk.

- **`agent-history.test.ts` — `extractToolCards`**: pair a `toolCall` with
  its `toolResult` by id; mark `error` status from `isError`; leave a card
  `running` when no result follows (cancelled mid-flight); handle multiple
  tool calls in one assistant turn; handle a tool result whose id matches
  no call (defensive — drop it). This is the leverage test: the pairing
  logic is the part that breaks silently.
- **`workspace/pane.test.tsx` — card rendering**: a thread with an
  assistant message carrying `toolCards` renders the tool name and status
  in the collapsed header; expanding shows the truncated arguments and
  result. Mirror the existing `keeps assistant thinking collapsed` test
  shape. One test for success, one for error status coloring.
- **`workspace/model.test.ts` — `normalizeMessage` round-trip**: a
  `LocalAgentMessage` with `toolCards` survives `normalizeLocalAgentWorkspace`
  (cards preserved) and a malformed card entry is dropped without nuking
  the message. Defensive-normalization guard.

Skip: a test that only asserts a copied header string, or that
`extractToolCards([])` returns `[]` (obvious from the implementation).

## STOP conditions

- If `onAgentMessages` does not actually include `toolCall` content blocks
  or `toolResult` messages — **verified false**: the host test at
  `pi/host.test.ts:533` asserts the exact `["user", "assistant" (toolCall),
  "toolResult", "assistant"]` shape. Do not stop.
- If the pi-agent-core `AgentMessage` type does not support the custom
  message types — **not relevant**: this plan does not use
  `CustomAgentMessages.toolCard` as a protocol message. It projects from
  existing `toolCall` / `toolResult` content. Do not stop.
- If `extractToolCards` cannot pair results reliably because `toolCallId`
  is not stable — verify against the `fauxToolCall` helper used in
  `pi/host.test.ts`; if ids are generated per-call and not echoed in the
  result, stop and report. (The `AiAgentToolCallContent.id` and
  `toolResult.toolCallId` fields exist precisely for this pairing, so this
  is expected to hold.)
- If rendering cards inline blows the pane height budget for threads with
  many tool calls (e.g. a 20-step agent run) — gate the render to the most
  recent N cards per turn (e.g. last 5) with a `+N more` affordance, rather
  than abandoning the feature. Decide the cutoff during implementation by
  loading a long-run fixture.

## Verification

- `npx tsc --noEmit` → exit 0
- `bun test src/plugins/builtin/ai/agent-history.test.ts` → all pass
- `bun test src/plugins/builtin/ai/workspace/pane.test.tsx` → all pass
- `bun test src/plugins/builtin/ai/workspace/model.test.ts` → all pass
- Manual (tmux, per the `tui-testing` skill): run the agent with a
  tool-using prompt (e.g. "open my watchlist pane") and verify:
  - A tool card appears between the user message and the assistant reply.
  - The collapsed header shows the tool name and `success`/`error` status.
  - Expanding shows the arguments and result, truncated.
  - Reloading the thread (switch away and back) preserves the cards.
  - A cancelled run leaves the in-flight card as `running`.
