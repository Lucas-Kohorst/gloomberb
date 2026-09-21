import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "../../../renderers/opentui/test-utils";
import {
  AppContext,
  PaneInstanceProvider,
  createInitialState,
} from "../../../state/app/context";
import { createDefaultConfig } from "../../../types/config";
import { PaneFooterBar, PaneFooterProvider } from "../../../components/layout/pane/footer";
import { PluginRenderProvider } from "../../runtime";
import { createTestPluginRuntime } from "../../../test-support/plugin-runtime";
import { Box } from "../../../ui";
import {
  appendNotificationLog,
  configureNotificationLog,
  flushNotificationLog,
  getNotificationLog,
  resetNotificationLogForTest,
  type NotificationLogEntry,
} from "../../../notifications/notification-log";
import { NotificationCenterPane } from "./index";

const WIDTH = 96;
const HEIGHT = 14;

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

function Harness() {
  const state = createInitialState(createDefaultConfig("/tmp/gloomberb-notifications"));
  return (
    <AppContext value={{ state, dispatch: () => {} }}>
      <PaneInstanceProvider paneId="notification-center:test">
        <PluginRenderProvider pluginId="notification-center" runtime={createTestPluginRuntime()}>
          <PaneFooterProvider>
            {(footer) => (
              <Box flexDirection="column" width={WIDTH} height={HEIGHT}>
                <NotificationCenterPane
                  paneId="notification-center:test"
                  paneType="notification-center"
                  focused
                  width={WIDTH}
                  height={HEIGHT - 1}
                />
                <PaneFooterBar footer={footer} focused width={WIDTH} />
              </Box>
            )}
          </PaneFooterProvider>
        </PluginRenderProvider>
      </PaneInstanceProvider>
    </AppContext>
  );
}

async function renderSettled(): Promise<void> {
  await act(async () => {
    await testSetup!.renderOnce();
    await testSetup!.renderOnce();
  });
}

afterEach(async () => {
  resetNotificationLogForTest();
  if (!testSetup) return;
  await act(async () => {
    testSetup!.renderer.destroy();
  });
  testSetup = undefined;
});

describe("NotificationCenterPane mark all read", () => {
  test("keeps unread rows unread until the footer action marks every notification read", async () => {
    const saved: NotificationLogEntry[][] = [];
    configureNotificationLog({
      get: () => [],
      set: (entries) => { saved.push(entries.map((entry) => ({ ...entry }))); },
    });
    appendNotificationLog({ title: "AAPL", body: "Broke out of the range" }, "alerts", Date.now());
    await flushNotificationLog();

    testSetup = await testRender(<Harness />, { width: WIDTH, height: HEIGHT });
    await renderSettled();

    let frame = testSetup.captureCharFrame();
    expect(frame).toContain("[m]ark all read");
    expect(frame).toContain("New");
    expect(frame).not.toContain("Read");
    expect(getNotificationLog().every((entry) => entry.read)).toBe(false);

    await act(async () => {
      testSetup!.renderer.keyInput.emit("keypress", {
        name: "m",
        ctrl: false,
        meta: false,
        option: false,
        shift: false,
        eventType: "press",
        repeated: false,
        preventDefault: () => {},
        stopPropagation: () => {},
      });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });
    await flushNotificationLog();

    frame = testSetup.captureCharFrame();
    expect(frame).toContain("Read");
    expect(frame).not.toContain("New");
    expect(getNotificationLog().every((entry) => entry.read)).toBe(true);
    expect(saved.at(-1)?.every((entry) => entry.read)).toBe(true);

    await act(async () => {
      appendNotificationLog({ title: "MSFT", body: "Still unread" }, "alerts", Date.now());
    });
    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });
    frame = testSetup.captureCharFrame();
    expect(frame).toContain("New");

    const rows = frame.split("\n");
    const row = rows.findIndex((line) => line.includes("[m]ark all read"));
    const col = row >= 0 ? rows[row]!.indexOf("[m]") : -1;
    expect(row).toBeGreaterThanOrEqual(0);
    expect(col).toBeGreaterThanOrEqual(0);
    await act(async () => {
      await testSetup!.mockMouse.pressDown(col + 1, row);
      await testSetup!.mockMouse.release(col + 1, row);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });
    await flushNotificationLog();

    frame = testSetup.captureCharFrame();
    expect(frame).not.toContain("New");
    expect(frame).toContain("Read");
    expect(getNotificationLog()).toHaveLength(2);
    expect(getNotificationLog().every((entry) => entry.read)).toBe(true);
  });
});
