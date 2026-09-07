import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { PaneFooterBar, PaneFooterProvider } from "../../../components/layout/pane/footer";
import { testRender } from "../../../renderers/opentui/test-utils";
import { AppContext, PaneInstanceProvider, createInitialState } from "../../../state/app/context";
import { createDefaultConfig } from "../../../types/config";
import { createStatefulTestPluginRuntime } from "../../../test-support/plugin-runtime";
import { PluginRenderProvider } from "../../runtime";
import { Box } from "../../../ui";
import { ByokSettingsPane } from "./pane";
import { BYOK_API_KEYS_CONFIG_KEY, type ByokApiKeyEntry } from "./types";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(async () => {
  if (!testSetup) return;
  await act(async () => {
    testSetup!.renderer.destroy();
  });
  testSetup = undefined;
});

function Harness({ runtime }: { runtime: ReturnType<typeof createStatefulTestPluginRuntime> }) {
  const state = createInitialState(createDefaultConfig("/tmp/gloomberb-byok-pane-test"));
  return (
    <AppContext value={{ state, dispatch: () => {} }}>
      <PaneInstanceProvider paneId="byok:test">
        <PluginRenderProvider pluginId="byok" runtime={runtime}>
          <PaneFooterProvider>
            {(footer) => (
              <Box flexDirection="column" width={88} height={22}>
                <ByokSettingsPane paneId="byok:test" paneType="byok" focused width={88} height={21} />
                <PaneFooterBar footer={footer} focused width={88} />
              </Box>
            )}
          </PaneFooterProvider>
        </PluginRenderProvider>
      </PaneInstanceProvider>
    </AppContext>
  );
}

async function renderSettled() {
  await act(async () => {
    await testSetup!.renderOnce();
    await testSetup!.renderOnce();
  });
}

async function emitKeypress(event: { name?: string; sequence?: string }) {
  await act(async () => {
    testSetup!.renderer.keyInput.emit("keypress", {
      ctrl: false,
      meta: false,
      option: false,
      shift: false,
      eventType: "press",
      repeated: false,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault: () => {},
      stopPropagation: () => {},
      ...event,
    } as never);
    await testSetup!.renderOnce();
  });
}

function storedKeys(runtime: ReturnType<typeof createStatefulTestPluginRuntime>): ByokApiKeyEntry[] {
  const stored = runtime.getConfigState("byok", BYOK_API_KEYS_CONFIG_KEY) as { keys: ByokApiKeyEntry[] } | null;
  return stored?.keys ?? [];
}

describe("ByokSettingsPane editing", () => {
  test("Escape cancels an in-progress add without persisting", async () => {
    const runtime = createStatefulTestPluginRuntime();
    testSetup = await testRender(<Harness runtime={runtime} />, { width: 88, height: 22 });
    await renderSettled();

    expect(testSetup.captureCharFrame()).toContain("No API keys configured.");

    await emitKeypress({ name: "a", sequence: "a" });
    await renderSettled();
    expect(testSetup.captureCharFrame()).toContain("Add API Key");

    await emitKeypress({ name: "escape", sequence: "\u001b" });
    await renderSettled();
    expect(testSetup.captureCharFrame()).toContain("No API keys configured.");
    expect(storedKeys(runtime)).toEqual([]);
  });

  test("Enter saves the typed draft through config state", async () => {
    const runtime = createStatefulTestPluginRuntime();
    testSetup = await testRender(<Harness runtime={runtime} />, { width: 88, height: 22 });
    await renderSettled();

    await emitKeypress({ name: "a", sequence: "a" });
    await renderSettled();
    expect(testSetup.captureCharFrame()).toContain("Add API Key");

    // Name field is focused first; Tab moves to the API Key field.
    for (const character of "testkey") {
      await emitKeypress({ name: character, sequence: character });
    }
    await emitKeypress({ name: "tab", sequence: "\t" });
    for (const character of "sktest123") {
      await emitKeypress({ name: character, sequence: character });
    }
    await emitKeypress({ name: "enter", sequence: "\r" });
    await renderSettled();

    const keys = storedKeys(runtime);
    expect(keys).toHaveLength(1);
    expect(keys[0]!.name).toBe("testkey");
    expect(keys[0]!.apiKey).toBe("sktest123");
  });

  test("footer shows the add hint when idle and drops hints while the form is open", async () => {
    const runtime = createStatefulTestPluginRuntime();
    testSetup = await testRender(<Harness runtime={runtime} />, { width: 88, height: 22 });
    await renderSettled();

    expect(testSetup.captureCharFrame()).toContain("[a]dd");

    await emitKeypress({ name: "a", sequence: "a" });
    await renderSettled();
    const editingFrame = testSetup.captureCharFrame();
    expect(editingFrame).toContain("Add API Key");
    expect(editingFrame).not.toContain("[a]dd");
  });
});
