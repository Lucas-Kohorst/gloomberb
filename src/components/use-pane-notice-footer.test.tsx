import { afterEach, expect, test } from "bun:test";
import { act, useState } from "react";
import { Box } from "../ui";
import { testRender } from "../renderers/opentui/test-utils";
import { PaneFooterBar, PaneFooterProvider, PaneFooterScope, usePaneFooter, type CombinedPaneFooter } from "./layout/pane/footer";
import { usePaneNoticeFooter, type UsePaneNoticeFooterOptions } from "./use-pane-notice-footer";

let setup: Awaited<ReturnType<typeof testRender>> | undefined;
let update!: (next: Partial<Options>) => void;
let footer: CombinedPaneFooter;
type Options = UsePaneNoticeFooterOptions & { active: boolean };

function Registration({ options }: { options: Options }) {
  usePaneNoticeFooter(options);
  usePaneFooter("existing", () => ({ hints: [{ id: "series", key: "s", label: "eries" }] }), []);
  return null;
}

function Harness({ notices = ["  AMD: publication dates unavailable.  ", "AMD: publication dates unavailable.", "  "] }: { notices?: string[] }) {
  const [options, setOptions] = useState<Options>({ registrationId: "notice-test", notices, focused: true, active: true });
  update = (next) => setOptions((current) => ({ ...current, ...next }));
  return <PaneFooterProvider>{(current) => {
    footer = current;
    return <Box width={72} height={1}>
      <PaneFooterScope active={options.active}><Registration options={options} /></PaneFooterScope>
      <PaneFooterBar footer={current} focused={options.focused} width={72} />
    </Box>;
  }}</PaneFooterProvider>;
}

async function renderFrames(count = 3) {
  for (let index = 0; index < count; index += 1) {
    await act(async () => { await setup!.renderOnce(); });
  }
}

async function change(next: Partial<Options>) {
  await act(async () => update(next));
  await renderFrames(3);
}

async function key(name: string, modifiers: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {}) {
  await act(async () => {
    setup!.renderer.keyInput.emit("keypress", {
      name,
      sequence: name.length === 1 ? name : undefined,
      ctrl: false,
      meta: false,
      option: false,
      shift: false,
      eventType: "press",
      repeated: false,
      preventDefault: () => {},
      stopPropagation: () => {},
      ...modifiers,
    } as never);
    await setup!.renderOnce();
  });
  await renderFrames(2);
}

async function clickFrameText(text: string) {
  const lines = setup!.captureCharFrame().split("\n");
  for (let row = 0; row < lines.length; row += 1) {
    const col = lines[row]!.indexOf(text);
    if (col < 0) continue;
    await act(async () => { await setup!.mockMouse.click(col, row); });
    await renderFrames(3);
    return;
  }
  throw new Error(`Frame does not contain ${JSON.stringify(text)}`);
}

afterEach(async () => {
  if (setup) await act(async () => setup!.renderer.destroy());
  setup = undefined;
});

test("compact warnings disclose by mouse, follow the current data and vanish without disabling existing actions", async () => {
  await act(async () => { setup = await testRender(<Harness />, { width: 80, height: 28 }); });
  await renderFrames(3);
  expect(setup!.captureCharFrame()).toContain("⚠");
  expect(setup!.captureCharFrame()).toContain("[w]arnings");
  expect(setup!.captureCharFrame()).toContain("[s]eries");
  expect(setup!.captureCharFrame()).not.toContain("publication");
  const retained = footer.info[0]!.onPress!;
  await clickFrameText("⚠");
  expect(setup!.captureCharFrame()).toContain("publication dates unavailable");
  expect(setup!.captureCharFrame().match(/publication dates unavailable/g)?.length).toBe(1);
  const dialogLines = setup!.captureCharFrame().split("\n");
  expect(dialogLines.findIndex((line) => line.includes("Close")) - dialogLines.findIndex((line) => line.includes("Data warnings"))).toBeLessThanOrEqual(5);
  await change({ notices: ["MSFT: stale provider observation."] });
  expect(setup!.captureCharFrame()).not.toContain("publication");
  await act(async () => retained());
  await renderFrames(4);
  expect(setup!.captureCharFrame()).toContain("MSFT: stale provider observation.");
  await clickFrameText("Close");
  expect(setup!.captureCharFrame()).not.toContain("stale provider");
  await change({ notices: [" "] });
  await act(async () => retained());
  await key("w");
  expect(setup!.captureCharFrame()).not.toContain("⚠");
  expect(setup!.captureCharFrame()).not.toContain("[w]arnings");
  expect(setup!.captureCharFrame()).toContain("[s]eries");
  expect(footer.info).toEqual([]);
});

test("notice shortcut respects focus, inactive scopes, enabled state and an already open dialog", async () => {
  await act(async () => { setup = await testRender(<Harness />, { width: 80, height: 28 }); });
  await renderFrames(3);
  for (const disabled of [{ focused: false }, { focused: true, active: false }, { active: true, enabled: false }]) {
    await change(disabled);
    await key("w");
    expect(setup!.captureCharFrame()).not.toContain("publication");
  }
  await change({ enabled: true });
  await key("w", { ctrl: true });
  expect(setup!.captureCharFrame()).not.toContain("publication");
  await key("w");
  expect(setup!.captureCharFrame()).toContain("publication dates unavailable");
  await key("w");
  await key("escape");
  expect(setup!.captureCharFrame()).not.toContain("publication");
  await key("w");
  expect(setup!.captureCharFrame()).toContain("publication dates unavailable");
  await change({ active: false });
  expect(setup!.captureCharFrame()).not.toContain("publication");
});

test("long warning details remain scrollable to their final observation", async () => {
  const notices = Array.from({ length: 40 }, (_, index) => `Observation ${index + 1}: provider timestamp unavailable.`);
  await act(async () => { setup = await testRender(<Harness notices={notices} />, { width: 48, height: 20 }); });
  await renderFrames(3);
  await key("w");
  expect(setup!.captureCharFrame()).toContain("Observation 1:");
  expect(setup!.captureCharFrame()).not.toContain("Observation 40:");
  await key("end");
  expect(setup!.captureCharFrame()).toContain("Observation 40:");
  await key("home");
  expect(setup!.captureCharFrame()).toContain("Observation 1:");
  await key("enter");
  expect(setup!.captureCharFrame()).not.toContain("Observation 1:");
});

test("narrow panes keep warning disclosure visible beside overflowing action hints", async () => {
  await act(async () => {
    setup = await testRender(<PaneFooterBar focused width={18} footer={{
      info: [{ id: "data-warnings", parts: [{ text: "⚠", tone: "warning" }], onPress: () => {} }],
      trailingInfo: [],
      hints: [{ id: "series", key: "s", label: "eries" }, { id: "indicators", key: "i", label: "ndicators" }, { id: "share", key: "x", label: " share" }],
    }} />, { width: 18, height: 2 });
  });
  await renderFrames(3);
  expect(setup!.captureCharFrame()).toContain("⚠");
});
