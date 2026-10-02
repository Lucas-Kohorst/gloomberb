import { afterEach, describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { Box } from "../../../../ui";
import { testRender } from "../../../../renderers/opentui/test-utils";
import {
  clipPaneFooterInfo,
  PaneFooterBar,
  PaneFooterProvider,
  usePaneFooter,
} from "./index";
import { useExternalLinkFooter } from "../../../use-external-link-footer";
import { setLanguage, t } from "../../../../i18n";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(async () => {
  if (testSetup) {
    await act(async () => testSetup?.renderer.destroy());
    testSetup = undefined;
  }
  setLanguage("en");
});

function Registration({
  onOpen,
  openDisabled = false,
}: {
  onOpen?: () => void;
  openDisabled?: boolean;
}) {
  usePaneFooter("test", () => {
    return {
      info: [
        {
          id: "updated",
          parts: [{ text: "Updated 2m", tone: "muted" }],
        },
      ],
      hints: [
        { id: "open", key: "o", label: "pen", onPress: onOpen, disabled: openDisabled },
      ],
    };
  }, [onOpen, openDisabled]);
  return null;
}

function PollTrailingRegistration({ onGraph }: { onGraph?: () => void }) {
  usePaneFooter("poll-trailing", () => ({
    info: [{ id: "updated", parts: [{ text: "Updated just now", tone: "muted" }] }],
    trailingInfo: [{ id: "poll-interval", parts: [{ text: "poll 1m", tone: "muted" }] }],
    hints: [
      { id: "graph", key: "g", label: "raph", onPress: onGraph },
      { id: "refresh", key: "r", label: "efresh" },
    ],
  }), [onGraph]);
  return null;
}

function ExternalLinkRegistration({ onOpen }: { onOpen?: () => void }) {
  useExternalLinkFooter({
    registrationId: "external-link",
    onOpen,
    focused: true,
    url: "https://example.com/story?utm=raw",
    source: "Reuters",
  });
  return null;
}

function TranslatedRegistration() {
  usePaneFooter("translated", () => ({
    info: [{ id: "updated", parts: [{ text: t("Open"), tone: "value" }] }],
  }), []);
  return null;
}

function TranslatedFooterHarness() {
  return (
    <PaneFooterProvider>
      {(footer) => (
        <Box width={40} height={1}>
          <TranslatedRegistration />
          <PaneFooterBar footer={footer} focused width={40} />
        </Box>
      )}
    </PaneFooterProvider>
  );
}

function FooterHarness({
  focused = false,
  onOpen,
  openDisabled = false,
}: {
  focused?: boolean;
  onOpen?: () => void;
  openDisabled?: boolean;
}) {
  return (
    <PaneFooterProvider>
      {(footer) => (
        <Box width={64} height={1}>
          <Registration onOpen={onOpen} openDisabled={openDisabled} />
          <PaneFooterBar footer={footer} focused={focused} width={64} />
        </Box>
      )}
    </PaneFooterProvider>
  );
}

function PollTrailingFooterHarness({
  focused = true,
  onGraph,
}: {
  focused?: boolean;
  onGraph?: () => void;
}) {
  return (
    <PaneFooterProvider>
      {(footer) => (
        <Box width={64} height={1}>
          <PollTrailingRegistration onGraph={onGraph} />
          <PaneFooterBar footer={footer} focused={focused} width={64} />
        </Box>
      )}
    </PaneFooterProvider>
  );
}

function PollMenuRegistration({
  onSelect,
}: {
  onSelect: (value: string) => void;
}) {
  usePaneFooter("poll-menu", () => ({
    trailingInfo: [{
      id: "poll-interval",
      parts: [{ text: "poll 1m", tone: "muted" as const }],
      menu: {
        value: "1",
        options: [
          { value: "1", label: "1 minute" },
          { value: "5", label: "5 minutes" },
          { value: "15", label: "15 minutes" },
          { value: "30", label: "30 minutes" },
        ],
        onSelect,
      },
    }],
  }), [onSelect]);
  return null;
}

function PollMenuFooterHarness({ onSelect }: { onSelect: (value: string) => void }) {
  return (
    <PaneFooterProvider>
      {(footer) => (
        <Box width={64} height={16} flexDirection="column">
          <Box flexGrow={1} />
          <PollMenuRegistration onSelect={onSelect} />
          <PaneFooterBar footer={footer} focused width={64} />
        </Box>
      )}
    </PaneFooterProvider>
  );
}

function ExternalLinkFooterHarness({ onOpen }: { onOpen?: () => void }) {
  return (
    <PaneFooterProvider>
      {(footer) => (
        <Box width={80} height={1}>
          <ExternalLinkRegistration onOpen={onOpen} />
          <PaneFooterBar footer={footer} focused width={80} />
        </Box>
      )}
    </PaneFooterProvider>
  );
}

function CrowdedHintsRegistration({ onAction }: { onAction: (id: string) => void }) {
  usePaneFooter("crowded", () => ({
    info: [{ id: "loading", parts: [{ text: "loading" }] }],
    trailingInfo: [{ id: "poll", parts: [{ text: "poll 1m" }] }],
    hints: [
      { id: "search", key: "/", label: "search" },
      { id: "open", key: "o", label: "pen" },
      { id: "pop-out", key: "p", label: "op out" },
      { id: "share", key: "s", label: "hare" },
      { id: "archive", key: "a", label: "rchive" },
      { id: "bookmark", key: "b", label: "ookmark" },
      { id: "copy", key: "c", label: "opy" },
      { id: "yank", key: "y", label: "ank" },
    ].map((hint) => ({ ...hint, onPress: () => onAction(hint.id) })),
  }), [onAction]);
  return null;
}

function CrowdedFooterHarness({ onAction }: { onAction: (id: string) => void }) {
  return (
    <PaneFooterProvider>
      {(footer) => (
        <Box width={34} height={18} flexDirection="column">
          <CrowdedHintsRegistration onAction={onAction} />
          <Box flexGrow={1} />
          <PaneFooterBar footer={footer} focused width={34} />
        </Box>
      )}
    </PaneFooterProvider>
  );
}

describe("clipPaneFooterInfo", () => {
  test("caps info copy so chrome never dumps a JSON blob", () => {
    const clipped = clipPaneFooterInfo({
      info: [{
        id: "error",
        parts: [{ text: '{"finance":{"result":null,"error":{"code":"Not Found"}}}', tone: "warning" }],
      }],
      trailingInfo: [],
      hints: [],
    });
    expect(clipped.info[0]?.parts[0]?.text).toBe('{"finance":{"result":nul');
    expect(clipped.info[0]?.parts[0]?.text.length).toBe(24);
  });

  test("caps trailing status the same way", () => {
    const clipped = clipPaneFooterInfo({
      info: [],
      trailingInfo: [{
        id: "warning",
        parts: [{ text: "this trailing warning is far too long for the chip", tone: "warning" }],
      }],
      hints: [],
    });
    expect(clipped.trailingInfo[0]?.parts[0]?.text.length).toBe(24);
  });
});

describe("PaneFooterBar", () => {
  test("rebuilds translated registrations when the app language changes", async () => {
    testSetup = await testRender(<TranslatedFooterHarness />, { width: 40, height: 1 });
    await act(async () => {
      await testSetup?.renderOnce();
      await testSetup?.renderOnce();
    });
    expect(testSetup.captureCharFrame()).toContain("Open");

    await act(async () => {
      setLanguage("zh-CN");
      await Promise.resolve();
    });
    await act(async () => {
      await testSetup?.renderOnce();
      await testSetup?.renderOnce();
      await Promise.resolve();
      await testSetup?.renderOnce();
    });
    expect(testSetup.captureCharFrame()).toContain("打开");
  });

  test("hides hints on inactive footers but keeps info visible", async () => {
    testSetup = await testRender(<FooterHarness />, { width: 64, height: 1 });
    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Updated 2m");
    expect(frame).not.toContain("[o]pen");
  });

  test("renders poll interval on the right after action hints", async () => {
    testSetup = await testRender(<PollTrailingFooterHarness />, { width: 64, height: 1 });
    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const line = testSetup.captureCharFrame().split("\n")[0] ?? "";
    const updatedIdx = line.indexOf("Updated just now");
    const graphIdx = line.indexOf("[g]raph");
    const refreshIdx = line.indexOf("[r]efresh");
    const pollIdx = line.indexOf("poll 1m");
    expect(updatedIdx).toBeGreaterThanOrEqual(0);
    expect(graphIdx).toBeGreaterThan(updatedIdx);
    expect(refreshIdx).toBeGreaterThan(graphIdx);
    expect(pollIdx).toBeGreaterThan(refreshIdx);
  });

  test("keeps poll interval visible when the pane is unfocused", async () => {
    testSetup = await testRender(<PollTrailingFooterHarness focused={false} />, { width: 64, height: 1 });
    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Updated just now");
    expect(frame).toContain("poll 1m");
    expect(frame).not.toContain("[g]raph");
  });

  test("calls [g]raph hint onPress from mouse interaction", async () => {
    let graphCount = 0;
    testSetup = await testRender(
      <PollTrailingFooterHarness onGraph={() => { graphCount += 1; }} />,
      { width: 64, height: 1 },
    );
    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const line = testSetup.captureCharFrame().split("\n")[0] ?? "";
    const col = line.indexOf("[g]raph");
    expect(col).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.click(col + 1, 0);
      await testSetup!.renderOnce();
    });
    expect(graphCount).toBe(1);
  });

  test("opens external links only for plain unconsumed shortcuts and pointer actions", async () => {
    let opened = 0;
    testSetup = await testRender(<ExternalLinkFooterHarness onOpen={() => { opened++; }} />, { width: 80, height: 1 });
    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("source Reuters");
    expect(frame).toContain("[o]pen");
    expect(frame).not.toContain("https://example.com");
    for (const blocked of [{ ctrl: true }, { meta: true }, { alt: true }, { shift: true }, { defaultPrevented: true }]) {
      await act(async () => {
        testSetup!.renderer.keyInput.emit("keypress", {
          name: "o", sequence: "o", ctrl: false, meta: false, option: false, shift: false,
          eventType: "press", repeated: false, preventDefault() {}, stopPropagation() {},
          ...blocked,
        });
      });
    }
    expect(opened).toBe(0);
    await act(async () => { testSetup!.mockInput.pressKey("o"); });
    expect(opened).toBe(1);
    await act(async () => { await testSetup!.mockMouse.click(frame.indexOf("[o]pen") + 1, 0); });
    expect(opened).toBe(2);
  });

  test("omits disabled controls instead of rendering muted hints", async () => {
    testSetup = await testRender(
      <FooterHarness focused openDisabled onOpen={() => {}} />,
      { width: 64, height: 1 },
    );
    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Updated 2m");
    expect(frame).not.toContain("[o]pen");
  });

  test("calls hint onPress from mouse interaction", async () => {
    let openCount = 0;
    testSetup = await testRender(<FooterHarness focused onOpen={() => { openCount += 1; }} />, { width: 64, height: 1 });
    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const line = testSetup.captureCharFrame().split("\n")[0] ?? "";
    const col = line.indexOf("[o]pen");
    expect(col).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.release(col + 1, 0);
      await testSetup!.renderOnce();
    });
    expect(openCount).toBe(0);

    await act(async () => {
      await testSetup!.mockMouse.click(col + 1, 0);
      await testSetup!.renderOnce();
    });
    expect(openCount).toBe(1);
  });

  test("separates actions and opens overflow actions from a narrow footer", async () => {
    const actions: string[] = [];
    testSetup = await testRender(<CrowdedFooterHarness onAction={(id) => actions.push(id)} />, { width: 34, height: 18 });
    for (let frame = 0; frame < 3; frame++) await act(async () => { await testSetup!.renderOnce(); });
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("loading");
    expect(frame).toContain("poll 1m");
    expect(frame).toContain("[o]pen [p]op out");
    expect(frame).toContain("More");
    const lines = frame.split("\n");
    const moreRow = lines.findIndex((line) => line.includes("More"));
    await act(async () => { await testSetup!.mockMouse.click(lines[moreRow]!.indexOf("More"), moreRow); });
    for (let frame = 0; frame < 3; frame++) await act(async () => { await testSetup!.renderOnce(); });
    const menuLines = testSetup.captureCharFrame().split("\n");
    const yankRow = menuLines.findIndex((line) => line.includes("[y]ank"));
    expect(yankRow).toBeGreaterThanOrEqual(0);
    await act(async () => { await testSetup!.mockMouse.click(menuLines[yankRow]!.indexOf("[y]ank"), yankRow); });
    expect(actions).toEqual(["yank"]);
    for (let frame = 0; frame < 3; frame++) await act(async () => { await testSetup!.renderOnce(); });
    await act(async () => { await testSetup!.mockMouse.click(lines[moreRow]!.indexOf("More"), moreRow); });
    for (let frame = 0; frame < 3; frame++) await act(async () => { await testSetup!.renderOnce(); });
    await act(async () => {
      testSetup!.mockInput.pressArrow("down");
      testSetup!.mockInput.pressEnter();
    });
    expect(actions).toEqual(["yank", "bookmark"]);
    for (let frame = 0; frame < 3; frame++) await act(async () => { await testSetup!.renderOnce(); });
    await act(async () => { await testSetup!.mockMouse.click(lines[moreRow]!.indexOf("More"), moreRow); });
    for (let frame = 0; frame < 3; frame++) await act(async () => { await testSetup!.renderOnce(); });
    await act(async () => { testSetup!.mockInput.pressEscape(); await Bun.sleep(60); });
    expect(actions).toEqual(["yank", "bookmark"]);
  });

  test("pointer actions follow the current item even when the footer text is unchanged", async () => {
    const opened: string[] = [];
    let navigate!: (item: string) => void;
    function CurrentItem() {
      const [item, setItem] = useState("first");
      navigate = setItem;
      usePaneFooter("current-item", () => ({
        hints: [{ id: "open", key: "o", label: "pen", onPress: () => opened.push(item) }],
      }), [item]);
      return null;
    }
    testSetup = await testRender(<PaneFooterProvider>{(footer) => <>
      <CurrentItem />
      <PaneFooterBar footer={footer} focused width={30} />
    </>}</PaneFooterProvider>, { width: 30, height: 2 });
    for (let frame = 0; frame < 3; frame++) await act(async () => { await testSetup!.renderOnce(); });
    const column = testSetup.captureCharFrame().indexOf("[o]pen");
    await act(async () => { await testSetup!.mockMouse.click(column + 1, 0); });
    await act(async () => { navigate("second"); });
    for (let frame = 0; frame < 3; frame++) await act(async () => { await testSetup!.renderOnce(); });
    await act(async () => { await testSetup!.mockMouse.click(column + 1, 0); });
    expect(opened).toEqual(["first", "second"]);
  });

  test("opens a poll interval list and applies the chosen option", async () => {
    const selected: string[] = [];
    testSetup = await testRender(
      <PollMenuFooterHarness onSelect={(value) => selected.push(value)} />,
      { width: 64, height: 16 },
    );
    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const lines = testSetup.captureCharFrame().split("\n");
    const footerRow = lines.findIndex((line) => line.includes("poll 1m"));
    const pollCol = lines[footerRow]?.indexOf("poll 1m") ?? -1;
    expect(footerRow).toBeGreaterThanOrEqual(0);
    expect(pollCol).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.click(pollCol + 1, footerRow);
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const openFrame = testSetup.captureCharFrame();
    expect(openFrame).toContain("1 minute");
    expect(openFrame).toContain("5 minutes");
    expect(openFrame).toContain("15 minutes");
    expect(openFrame).toContain("30 minutes");

    const openLines = openFrame.split("\n");
    const fiveRow = openLines.findIndex((line) => line.includes("5 minutes"));
    expect(fiveRow).toBeGreaterThanOrEqual(0);

    const fiveCol = openLines[fiveRow]?.indexOf("5 minutes") ?? -1;
    expect(fiveCol).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.click(fiveCol + 1, fiveRow);
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });
    expect(selected).toEqual(["5"]);
  });
});
