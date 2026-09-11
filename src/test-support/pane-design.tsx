/**
 * Programmatic enforcement for the pane-design rules in AGENTS.md.
 *
 * OpenTUI renders real text, so design regressions are machine-checkable:
 * render a pane with `renderAuditedPane`, then run the frame/footer
 * assertions below. New builtin panes must be added to
 * `src/plugins/pane-design-conformance.test.ts` (audited or explicitly
 * exempt) or the coverage gate fails CI.
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
import { EMPTY_FOOTER, isPaneFooterLeftSegment } from "../components/layout/pane/footer/model";
import { createTestPluginRuntime } from "./plugin-runtime";

export interface AuditedPaneRender {
  /** Full captured character frame. */
  frame: string;
  /** Combined footer registrations captured during render. */
  footer: CombinedPaneFooter;
  renderOnce: () => Promise<void>;
  destroy: () => Promise<void>;
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

/**
 * AGENTS.md footers: hints are single-key (`/`, `r`, `o`, …). A multi-key
 * hint such as Ctrl+S can never bind through `usePaneFooterHintBindings`,
 * so it is a bug by construction.
 */
/**
 * A hint key must be pressable: a single key, `/`, a digit range (`1-8`),
 * or Shift+key. Combos like Ctrl+S can never bind, so they fail.
 */
export function isBindableFooterHintKey(key: string): boolean {
  return key === "/" || key.length === 1 || /^\d-\d$/.test(key) || /^Shift\+.$/.test(key);
}

export function assertFooterHintKeysBindable(footer: CombinedPaneFooter, paneId: string): void {
  for (const hint of footer.hints) {
    if (hint.disabled) continue;
    expect(
      isBindableFooterHintKey(hint.key),
      `${paneId}: footer hint key ${JSON.stringify(hint.key)} is not bindable`,
    ).toBe(true);
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
