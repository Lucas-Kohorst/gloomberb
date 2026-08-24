import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
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
  onRefresh,
  refreshDisabled = false,
}: {
  onRefresh?: () => void;
  refreshDisabled?: boolean;
}) {
  usePaneFooter("test", () => {
    return {
      info: [
        {
          id: "status",
          parts: [{ text: "loading", tone: "muted" }],
        },
      ],
      hints: [
        { id: "refresh", key: "r", label: "efresh", onPress: onRefresh, disabled: refreshDisabled },
      ],
    };
  }, [onRefresh, refreshDisabled]);
  return null;
}

function PollTrailingRegistration({ onGraph }: { onGraph?: () => void }) {
  usePaneFooter("poll-trailing", () => ({
    info: [{ id: "status", parts: [{ text: "loading", tone: "muted" }] }],
    trailingInfo: [{ id: "poll-interval", parts: [{ text: "poll 1m", tone: "muted" }] }],
    hints: [
      { id: "graph", key: "g", label: "raph", onPress: onGraph },
      { id: "refresh", key: "r", label: "efresh" },
    ],
  }), [onGraph]);
  return null;
}

function ExternalLinkRegistration() {
  useExternalLinkFooter({
    registrationId: "external-link",
    focused: true,
    url: "https://example.com/story?utm=raw",
    source: "Reuters",
  });
  return null;
}

function TranslatedRegistration() {
  usePaneFooter("translated", () => ({
    info: [{ id: "state", parts: [{ text: t("Open"), tone: "value" }] }],
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
  onRefresh,
  refreshDisabled = false,
}: {
  focused?: boolean;
  onRefresh?: () => void;
  refreshDisabled?: boolean;
}) {
  return (
    <PaneFooterProvider>
      {(footer) => (
        <Box width={64} height={1}>
          <Registration onRefresh={onRefresh} refreshDisabled={refreshDisabled} />
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

function ExternalLinkFooterHarness() {
  return (
    <PaneFooterProvider>
      {(footer) => (
        <Box width={80} height={1}>
          <ExternalLinkRegistration />
          <PaneFooterBar footer={footer} focused width={80} />
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
    expect(frame).toContain("loading");
    expect(frame).not.toContain("[r]efresh");
  });

  test("renders poll interval on the right after action hints", async () => {
    testSetup = await testRender(<PollTrailingFooterHarness />, { width: 64, height: 1 });
    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const line = testSetup.captureCharFrame().split("\n")[0] ?? "";
    const loadingIdx = line.indexOf("loading");
    const graphIdx = line.indexOf("[g]raph");
    const refreshIdx = line.indexOf("[r]efresh");
    const pollIdx = line.indexOf("poll 1m");
    expect(loadingIdx).toBeGreaterThanOrEqual(0);
    expect(graphIdx).toBeGreaterThan(loadingIdx);
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
    expect(frame).toContain("loading");
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

  test("keeps raw external URLs out of footer text", async () => {
    testSetup = await testRender(<ExternalLinkFooterHarness />, { width: 80, height: 1 });
    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("source Reuters");
    expect(frame).toContain("[o]pen");
    expect(frame).not.toContain("https://example.com");
  });

  test("omits disabled controls instead of rendering muted hints", async () => {
    testSetup = await testRender(
      <FooterHarness focused refreshDisabled onRefresh={() => {}} />,
      { width: 64, height: 1 },
    );
    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("loading");
    expect(frame).not.toContain("[r]efresh");
  });

  test("calls hint onPress from mouse interaction", async () => {
    let refreshCount = 0;
    testSetup = await testRender(<FooterHarness focused onRefresh={() => { refreshCount += 1; }} />, { width: 64, height: 1 });
    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const line = testSetup.captureCharFrame().split("\n")[0] ?? "";
    const col = line.indexOf("[r]efresh");
    expect(col).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.release(col + 1, 0);
      await testSetup!.renderOnce();
    });
    expect(refreshCount).toBe(0);

    await act(async () => {
      await testSetup!.mockMouse.click(col + 1, 0);
      await testSetup!.renderOnce();
    });
    expect(refreshCount).toBe(1);
  });
});
