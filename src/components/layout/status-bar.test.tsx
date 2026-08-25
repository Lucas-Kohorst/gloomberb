import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "../../renderers/opentui/test-utils";
import { AppContext, createInitialState } from "../../state/app/context";
import { cloneLayout, createDefaultConfig, TICKER_RESEARCH_PANE_ID, type LayoutConfig } from "../../types/config";
import type { AppNotificationRequest } from "../../types/plugin";
import { StatusBar } from "./status-bar";
import { setSharedRegistryForTests } from "../../plugins/registry";
import { VERSION } from "../../version";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
  setSharedRegistryForTests(undefined);
});

describe("StatusBar", () => {
  test("opens the changelog pane from the version label", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-version-changelog-test");
    config.layouts = [{ name: "Home", layout: cloneLayout(config.layout) }];
    const state = {
      ...createInitialState(config),
      statusBarVisible: true,
    };
    const created: string[] = [];

    setSharedRegistryForTests({
      panes: new Map(),
      getLayoutFn: () => state.config.layout,
      getTermSizeFn: () => ({ width: 120, height: 40 }),
      updateLayoutFn: () => {},
      notify: () => {},
      createPaneFromTemplate: (templateId: string) => { created.push(templateId); },
      Slot: () => null,
    } as any);

    testSetup = await testRender(
      <AppContext value={{ state, dispatch: () => {} }}>
        <StatusBar />
      </AppContext>,
      { width: 120, height: 1 },
    );

    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    const versionX = frame.split("\n")[0]?.indexOf(`v${VERSION}`) ?? -1;
    expect(versionX).toBeGreaterThanOrEqual(0);

    await testSetup.mockMouse.click(versionX + 1, 0);
    await testSetup.renderOnce();

    expect(created).toEqual(["changelog-pane"]);
  });

  test("shows a gridlock tip after a corner snap and runs gridlock on click", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-test");
    const floatingLayout = cloneLayout(config.layout);
    floatingLayout.dockRoot = { kind: "pane", instanceId: "portfolio-list:main" };
    floatingLayout.floating = [{ instanceId: "ticker-detail:main", x: 8, y: 2, width: 36, height: 12 }];

    const state = {
      ...createInitialState({
        ...config,
        layout: floatingLayout,
        layouts: [
          { name: "Default", layout: cloneLayout(floatingLayout) },
          { name: "Research", layout: cloneLayout(floatingLayout) },
        ],
      }),
      statusBarVisible: true,
      gridlockTipVisible: true,
    };

    const actions: Array<{ type: string }> = [];
    let updatedLayout = null as ReturnType<typeof cloneLayout> | null;
    const notifications: AppNotificationRequest[] = [];

    setSharedRegistryForTests({
      panes: new Map([
        ["portfolio-list", {}],
        [TICKER_RESEARCH_PANE_ID, {}],
      ]),
      getLayoutFn: () => state.config.layout,
      getTermSizeFn: () => ({ width: 120, height: 40 }),
      updateLayoutFn: (layout: LayoutConfig) => { updatedLayout = layout; },
      notify: (notification: AppNotificationRequest) => { notifications.push(notification); },
      Slot: () => null,
    } as any);

    testSetup = await testRender(
      <AppContext value={{ state, dispatch: (action) => actions.push(action as { type: string }) }}>
        <StatusBar />
      </AppContext>,
      { width: 120, height: 1 },
    );

    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Snapped a window?");
    expect(frame).toContain("Gridlock All");

    const buttonX = frame.split("\n")[0]?.indexOf("Gridlock All") ?? -1;
    expect(buttonX).toBeGreaterThanOrEqual(0);

    await testSetup.mockMouse.click(buttonX + 1, 0);
    await testSetup.renderOnce();

    expect(updatedLayout?.floating).toHaveLength(0);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      body: "Retiled all panes",
      type: "success",
      action: { label: "Revert" },
    });
    expect(actions).toContainEqual({ type: "DISMISS_GRIDLOCK_TIP" });

    notifications[0]!.action!.onClick();
    expect(actions).toContainEqual({ type: "UNDO_LAYOUT" });
  });

  test("auto-dismisses the gridlock tip after its timeout", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-test");
    const state = {
      ...createInitialState(config),
      statusBarVisible: true,
      gridlockTipVisible: true,
      gridlockTipSequence: 1,
    };
    const actions: Array<{ type: string }> = [];
    const timers: Array<{ callback: (() => void) | null; delay: number | undefined }> = [];
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;

    globalThis.setTimeout = ((callback: Parameters<typeof setTimeout>[0], delay?: number) => {
      timers.push({ callback: typeof callback === "function" ? callback : null, delay });
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    globalThis.clearTimeout = (() => {}) as typeof clearTimeout;

    setSharedRegistryForTests({
      panes: new Map(),
      getLayoutFn: () => state.config.layout,
      getTermSizeFn: () => ({ width: 120, height: 40 }),
      updateLayoutFn: () => {},
      notify: () => {},
      Slot: () => null,
    } as any);

    try {
      testSetup = await testRender(
        <AppContext value={{ state, dispatch: (action) => actions.push(action as { type: string }) }}>
          <StatusBar />
        </AppContext>,
        { width: 120, height: 1 },
      );

      await testSetup.renderOnce();

      const gridlockTimer = timers.find((entry) => entry.delay === 60_000);
      expect(gridlockTimer?.callback).toBeDefined();
      gridlockTimer?.callback?.();

      expect(actions).toContainEqual({ type: "DISMISS_GRIDLOCK_TIP" });
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });
});
