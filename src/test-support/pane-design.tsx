/**
 * Programmatic enforcement for the pane-design rules in AGENTS.md.
 *
 * OpenTUI renders real text, so design regressions are machine-checkable:
 * render a pane with `renderAuditedPane`, then run the frame/footer
 * assertions below. `pane-design-conformance.test.ts` gates every builtin
 * pane in the catalog; there is no exemption list.
 */
import { act, useReducer, type ReactNode } from "react";
import { expect } from "bun:test";
import { testRender } from "../renderers/opentui/test-utils";
import {
  AppContext,
  PaneInstanceProvider,
  appReducer,
  createInitialState,
} from "../state/app/context";
import { cloneLayout, createDefaultConfig } from "../types/config";
import { PluginRenderProvider } from "../plugins/runtime";
import {
  PaneFooterProvider,
  type CombinedPaneFooter,
} from "../components/layout/pane/footer/registration";
import {
  EMPTY_FOOTER,
  isBindableFooterHintKey,
  isPaneFooterLeftSegment,
  PANE_FOOTER_INFO_MAX_CHARS,
} from "../components/layout/pane/footer/model";
import { createTestPluginRuntime } from "./plugin-runtime";
import { normalizeShortcutHint } from "../components/ui/shortcut-hint-format";

export interface AuditedPaneRender {
  /** Full captured character frame. */
  frame: string;
  /** Combined footer registrations captured during render. */
  footer: CombinedPaneFooter;
  renderOnce: () => Promise<void>;
  destroy: () => Promise<void>;
  emitKeypress: (event: { name?: string; sequence?: string }) => Promise<void>;
}

function nextActionPattern(action: string): RegExp {
  return new RegExp(action.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

/**
 * Render a pane exactly like the pane unit tests do, while also capturing
 * its footer registrations. The pane starts with no ticker/data unless the
 * caller seeds `settings`, so empty states render deterministically.
 */
export async function renderAuditedPane(options: {
  paneId: string;
  pluginId: string;
  node: ReactNode;
  settings?: Record<string, unknown>;
  width?: number;
  height?: number;
  frames?: number;
}): Promise<AuditedPaneRender> {
  const width = options.width ?? 100;
  const height = options.height ?? 30;
  const instanceId = `${options.paneId}:design`;
  const layout = {
    dockRoot: { kind: "pane" as const, instanceId },
    instances: [{
      instanceId,
      paneId: options.paneId,
      settings: options.settings ?? {},
    }],
    floating: [],
    detached: [],
  };
  const initialState = createInitialState({
    ...createDefaultConfig("/tmp/gloomberb-pane-design-test"),
    layout,
    layouts: [{ name: "Default", layout: cloneLayout(layout) }],
  });
  initialState.focusedPaneId = instanceId;

  let captured: CombinedPaneFooter = EMPTY_FOOTER;

  function Harness() {
    const [state, dispatch] = useReducer(appReducer, initialState);
    return (
      <AppContext value={{ state, dispatch }}>
        <PaneInstanceProvider paneId={instanceId}>
          <PluginRenderProvider pluginId={options.pluginId} runtime={createTestPluginRuntime()}>
            <PaneFooterProvider>
              {(footer) => {
                captured = footer;
                return <>{options.node}</>;
              }}
            </PaneFooterProvider>
          </PluginRenderProvider>
        </PaneInstanceProvider>
      </AppContext>
    );
  }

  const setup = await testRender(<Harness />, { width, height });
  const renderOnce = async () => {
    await act(async () => {
      await setup.renderOnce();
    });
  };
  const frames = options.frames ?? 3;
  for (let index = 0; index < frames; index += 1) {
    await renderOnce();
  }

  return {
    get frame() {
      return setup.captureCharFrame();
    },
    get footer() {
      return captured;
    },
    renderOnce,
    destroy: async () => {
      await act(async () => {
        setup.renderer.destroy();
      });
    },
    emitKeypress: async (event) => {
      await act(async () => {
        setup.renderer.keyInput.emit("keypress", {
          ctrl: false,
          meta: false,
          option: false,
          shift: false,
          eventType: "press",
          repeated: false,
          preventDefault: () => {},
          stopPropagation: () => {},
          ...event,
        } as never);
        await setup.renderOnce();
      });
    },
  };
}

/**
 * Pump async work (fetches, debounced inputs) through the renderer the way
 * the pane unit tests do: a short sleep per frame so promises resolve.
 */
export async function settleFrames(render: AuditedPaneRender, count = 6): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    await render.renderOnce();
  }
}

/**
 * AGENTS.md: NEVER prefix a TIME / AGE / FILED column with a bullet
 * (`•`, `●`, `·`, or a CSS list marker). `•`/`●` have no legitimate use in
 * terminal frames at all; `·` is only flagged when it directly prefixes a
 * time-like token (metadata separators such as `a · b` still pass).
 */
export function assertNoBannedBullets(frame: string, paneId: string): void {
  const hard = frame.match(/[•●]/);
  expect(
    hard,
    `${paneId}: banned bullet glyph ${JSON.stringify(hard?.[0])} in rendered frame`,
  ).toBeNull();
  const timeBullet = frame.match(
    /·\s*(\d+\s*[hms]\b|\d{1,2}:\d{2}|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2})\b/,
  );
  expect(
    timeBullet,
    `${paneId}: bullet-prefixed time ${JSON.stringify(timeBullet?.[0])} in rendered frame`,
  ).toBeNull();
}

/**
 * AGENTS.md: "Bind the hinted key. A footer hint with no handler is a bug."
 */
export function assertFooterHintsBound(footer: CombinedPaneFooter, paneId: string): void {
  for (const hint of footer.hints) {
    if (hint.disabled) continue;
    expect(
      hint.onPress,
      `${paneId}: footer hint [${hint.key}] ${hint.id} has no handler`,
    ).toBeTypeOf("function");
  }
}

/**
 * Calendar-like data tables always advertise at least one action. An empty
 * hints array would pass `assertFooterHintsBound`.
 */
export function assertFooterHasBoundActionHints(footer: CombinedPaneFooter, paneId: string): void {
  const enabled = footer.hints.filter((hint) => !hint.disabled);
  expect(
    enabled.length > 0,
    `${paneId}: calendar-like table has no footer action hints`,
  ).toBe(true);
  assertFooterHintsBound(footer, paneId);
}

/**
 * AGENTS.md: `[s]`earch or `/` when the list is long enough to filter.
 */
export function assertHasSearchFooterHint(footer: CombinedPaneFooter, paneId: string): void {
  const search = footer.hints.find((hint) => (
    hint.id === "search"
    || hint.key === "/"
    || (hint.key.toLowerCase() === "s" && /earch/i.test(hint.label))
  ));
  expect(
    search,
    `${paneId}: data table missing [/] or [s]earch footer hint`,
  ).toBeDefined();
  if (search?.disabled) return;
  expect(
    search?.onPress,
    `${paneId}: search footer hint has no handler`,
  ).toBeTypeOf("function");
}

/** JSX that mounts a shared data table. */
export const DATA_TABLE_COMPONENT_RE =
  /<(?:DataTableView|DataTableStackView|FeedDataTableStackView)\b/;

const NOOP_HEADER_CLICK_RE =
  /\bonHeaderClick\s*=\s*\{\s*\(\s*\)\s*=>\s*(?:\{\s*\}|undefined)\s*\}/;

/**
 * Catalog list tables must wire clickable header sort, not a no-op.
 *
 * `FeedDataTableStackView` owns sort internally (SEC / filings-style stacks).
 * Statement layouts (cash flow, financials) opt out with `sortColumnId={null}`
 * so GAAP section grouping is not flattened.
 */
export function sourceHasClickableHeaderSort(source: string): boolean {
  if (!DATA_TABLE_COMPONENT_RE.test(source)) return false;

  const usesFeedTable = /<FeedDataTableStackView\b/.test(source);
  const usesListTable = /<(?:DataTableView|DataTableStackView)\b/.test(source);

  if (NOOP_HEADER_CLICK_RE.test(source)) {
    return usesListTable && /sortColumnId=\{null\}/.test(source);
  }

  if (usesListTable) return /\bonHeaderClick\s*=/.test(source);
  return usesFeedTable;
}

/**
 * Search is registered through `paneSearchHint(...)` or an explicit search
 * hint with `onPress`.
 */
export function sourceHasBoundTableFooterHints(source: string): boolean {
  if (/paneSearchHint\s*\(/.test(source)) return true;
  return /id:\s*["']search["']/.test(source) && /onPress\s*:/.test(source);
}

/**
 * AGENTS.md: footers carry changing status plus bound action hints —
 * no "N results" tallies.
 */
export function assertFooterHasNoResultCounts(footer: CombinedPaneFooter, paneId: string): void {
  const text = [...footer.info, ...footer.trailingInfo]
    .flatMap((segment) => segment.parts.map((part) => part.text))
    .join(" | ");
  expect(
    text.match(/\b\d+\s+(results|rows|items|matches)\b/i)?.[0] ?? null,
    `${paneId}: footer tallies results (${JSON.stringify(text)})`,
  ).toBeNull();
}

export { isBindableFooterHintKey };

export function assertFooterHintKeysBindable(footer: CombinedPaneFooter, paneId: string): void {
  for (const hint of footer.hints) {
    expect(
      isBindableFooterHintKey(hint.key),
      `${paneId}: footer hint key ${JSON.stringify(hint.key)} is not bindable`,
    ).toBe(true);
  }
}

const NAVIGATION_HINT_KEY = /^(esc|enter|return|tab|arrowup|arrowdown|arrowleft|arrowright|up|down|left|right|j\/k|h\/l|up\/down|left\/right)$/i;

/**
 * PLUGINS.md: do not register Esc, Enter, arrows, or tab-switch combos as
 * footer hints. Dedicated `useShortcut` handlers stay; the footer does not
 * advertise keys the binder cannot press.
 */
export function assertNoNavigationFooterHints(footer: CombinedPaneFooter, paneId: string): void {
  for (const hint of footer.hints) {
    expect(
      NAVIGATION_HINT_KEY.test(hint.key),
      `${paneId}: footer hint ${JSON.stringify(hint.key)} is navigation chrome`,
    ).toBe(false);
  }
}

/**
 * Two hints with the same key steal each other's binding.
 */
export function assertNoDuplicateFooterHintKeys(footer: CombinedPaneFooter, paneId: string): void {
  const seen = new Map<string, string>();
  for (const hint of footer.hints) {
    const key = hint.key.toLowerCase();
    const previous = seen.get(key);
    expect(
      previous,
      `${paneId}: footer hint key ${JSON.stringify(hint.key)} used by ${previous} and ${hint.id}`,
    ).toBeUndefined();
    seen.set(key, hint.id);
  }
}

/**
 * PR #589: `r` refreshes globally. A per-pane `[r]efresh` hint both
 * duplicates the chrome and steals the key from the binder's siblings.
 */
export function assertNoPerPaneRefreshHint(footer: CombinedPaneFooter, paneId: string): void {
  for (const hint of footer.hints) {
    const refresh = hint.key.toLowerCase() === "r"
      && (hint.id.toLowerCase().includes("refresh") || /efresh/i.test(hint.label));
    expect(
      refresh,
      `${paneId}: per-pane [r]efresh hint — r is global, omit it from the footer`,
    ).toBe(false);
  }
}

/**
 * Footer copy is a 24-char chip, never a JSON dump or a keyboard tutorial.
 */
export function assertFooterInfoFitsChrome(footer: CombinedPaneFooter, paneId: string): void {
  for (const segment of [...footer.info, ...footer.trailingInfo]) {
    for (const part of segment.parts) {
      expect(
        part.text.length <= PANE_FOOTER_INFO_MAX_CHARS,
        `${paneId}: footer ${segment.id} exceeds ${PANE_FOOTER_INFO_MAX_CHARS} chars (${JSON.stringify(part.text)})`,
      ).toBe(true);
      expect(
        /^\s*[{[]/.test(part.text),
        `${paneId}: footer ${segment.id} looks like dumped JSON`,
      ).toBe(false);
      expect(
        /\bpress\b|\bctrl\+|\bcmd\+|\bkeyboard\b/i.test(part.text),
        `${paneId}: footer ${segment.id} is a generic keyboard hint`,
      ).toBe(false);
    }
  }
  for (const hint of footer.hints) {
    expect(
      /\bpress\b|\bctrl\+|\bcmd\+/i.test(hint.label),
      `${paneId}: footer hint ${hint.id} label is a generic keyboard hint`,
    ).toBe(false);
  }
}

const CHIP_FILTER_LABEL = /(?:^|\s)(Range|Sort):\s*(All|7D|1M|3M|1Y|YTD|Relevance|Newest|Oldest|Match|Date)\b/i;

/**
 * Research-search chip row (`Types: All`, `Range: 7D`) is not shared pane
 * chrome. SelectButton reads `Type All` / `Range All`.
 */
export function assertNoChipFilterChrome(frame: string, paneId: string): void {
  expect(
    frame.includes("Types:"),
    `${paneId}: Types: chip chrome — use SelectButton`,
  ).toBe(false);
  expect(
    frame.includes("Sources:"),
    `${paneId}: Sources: chip chrome — use SelectButton`,
  ).toBe(false);
  const chip = frame.match(CHIP_FILTER_LABEL)?.[0] ?? null;
  expect(
    chip,
    `${paneId}: ${JSON.stringify(chip)} chip chrome — use SelectButton`,
  ).toBeNull();
}

/**
 * Loading belongs in the footer, not a table-body spinner row.
 */
export function assertNoBodySearchSpinner(frame: string, paneId: string): void {
  const match = frame.match(/\*\s*Searching\.\.\.|Searching\.\.\./)?.[0] ?? null;
  expect(
    match,
    `${paneId}: search spinner in the body (${JSON.stringify(match)}) — use the footer loading chip`,
  ).toBeNull();
}

/**
 * AGENTS.md: a letter in `[]` is the first letter of the action (`[o]pen`,
 * `[s]hare`). `[y] share` is the failure mode — the key is not a prefix.
 */
export function assertFooterHintKeyPrefixesAction(footer: CombinedPaneFooter, paneId: string): void {
  for (const hint of footer.hints) {
    if (!/^[a-z]$/i.test(hint.key)) continue;
    const normalized = normalizeShortcutHint(hint.key, hint.label);
    expect(
      normalized.glue,
      `${paneId}: [${hint.key}] ${JSON.stringify(normalized.label)} — letter hints prefix the action ([o]pen, not [y] share)`,
    ).toBe("");
    const action = `${hint.key}${normalized.label}`.toLowerCase();
    expect(
      action.startsWith(hint.key.toLowerCase()),
      `${paneId}: action ${JSON.stringify(action)} does not start with [${hint.key}]`,
    ).toBe(true);
  }
}

/**
 * Written-text / filings / company-record list panes. Generic
 * `ErrorState` / `dataErrorMessage` copy ("The data source is unavailable.")
 * is a dead empty window on these — they need empty vs transport-failure copy.
 */
export const WRITTEN_DATA_LIST_PANE_IDS = [
  "news-top",
  "news-feed",
  "news-industry",
  "news-rss",
  "news-breaking",
  "news-firehose",
  "sec",
  "comment-letters",
  "companies",
  "adjacent",
] as const;

/** News lists that must expose bound in-pane `/` search (AGENTS.md written-text). */
export const NEWS_IN_PANE_SEARCH_PANE_IDS = [
  "news-top",
  "news-feed",
  "news-industry",
  "news-breaking",
  "news-firehose",
  "news-rss",
  "news-saved",
] as const;

export type WrittenDataListPaneId = (typeof WRITTEN_DATA_LIST_PANE_IDS)[number];

export function isWrittenDataListPane(paneId: string): boolean {
  return (WRITTEN_DATA_LIST_PANE_IDS as readonly string[]).includes(paneId);
}

const GENERIC_DATA_ERROR_DUMP = /the data source is unavailable\.?/i;

/**
 * AGENTS.md: empty vs error. Written-data list panes must not dump
 * `ErrorState` / `dataErrorMessage`'s generic sentence. Empty results use
 * EmptyState; real failures name the source.
 */
export function assertNoGenericDataErrorDump(frame: string, paneId: string): void {
  expect(
    GENERIC_DATA_ERROR_DUMP.test(frame),
    `${paneId}: generic ErrorState/dataErrorMessage dump ${JSON.stringify("The data source is unavailable.")} — use EmptyState for no-data and name the source on transport failure`,
  ).toBe(false);
}

/**
 * Universal empty-state chrome every builtin pane must satisfy.
 */
export function assertUniversalPaneDesignGates(
  frame: string,
  footer: CombinedPaneFooter,
  paneId: string,
  paneName: string,
): void {
  assertNoBannedBullets(frame, paneId);
  assertNoChipFilterChrome(frame, paneId);
  assertNoBodySearchSpinner(frame, paneId);
  assertFooterHintsBound(footer, paneId);
  assertFooterHintKeysBindable(footer, paneId);
  assertNoNavigationFooterHints(footer, paneId);
  assertNoDuplicateFooterHintKeys(footer, paneId);
  assertNoPerPaneRefreshHint(footer, paneId);
  assertFooterHintKeyPrefixesAction(footer, paneId);
  assertFooterInfoIsStatusOnly(footer, paneId);
  assertFooterHasNoResultCounts(footer, paneId);
  assertFooterInfoFitsChrome(footer, paneId);
  assertBodyDoesNotRepeatPaneName(frame, paneId, paneName);
  if (isWrittenDataListPane(paneId)) {
    assertNoGenericDataErrorDump(frame, paneId);
  }
}

/**
 * AGENTS.md: footers show status that can change (loading, error,
 * live/delayed, stale, auth) — never fixed labels. The codebase's own
 * `isPaneFooterLeftSegment` classifier is the definition of allowed.
 */
export function assertFooterInfoIsStatusOnly(footer: CombinedPaneFooter, paneId: string): void {
  for (const segment of footer.info) {
    expect(
      isPaneFooterLeftSegment(segment),
      `${paneId}: footer info segment ${JSON.stringify(segment.id)} is not status`,
    ).toBe(true);
  }
  for (const segment of footer.trailingInfo) {
    const text = segment.parts.map((part) => part.text).join(" ");
    expect(
      /poll|live|delayed|stale|updated|loading|error|auto|refresh/i.test(text),
      `${paneId}: footer trailing segment ${JSON.stringify(text)} is not status`,
    ).toBe(true);
  }
}

/**
 * AGENTS.md: never repeat the pane title/header in the body. The shell owns
 * the title, so the body naming it more than once is duplication.
 */
export function assertBodyDoesNotRepeatPaneName(frame: string, paneId: string, paneName: string): void {
  const name = paneName.trim().toLowerCase();
  // Single generic words ("Chat", "Article") collide with natural copy, so
  // only distinctive multi-word names are checked for body duplication.
  if (!name.includes(" ")) return;
  const occurrences = frame.toLowerCase().split(name).length - 1;
  expect(
    occurrences <= 1,
    `${paneId}: body repeats pane name ${JSON.stringify(paneName)} ${occurrences}x`,
  ).toBe(true);
}

/**
 * AGENTS.md: empty states explain the next action. The caller names the
 * expected action phrase so the pane states its contract explicitly.
 */
export function assertEmptyStateHasNextAction(frame: string, paneId: string, action: string): void {
  expect(
    nextActionPattern(action).test(frame),
    `${paneId}: empty state missing next action ${JSON.stringify(action)}`,
  ).toBe(true);
}
