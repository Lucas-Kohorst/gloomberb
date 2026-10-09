import { expect, test } from "bun:test";
import { act } from "react";
import { Box, Text } from "../../../ui";
import { createOpenTuiTestHarness } from "../../../renderers/opentui/test-utils";
import { PaneFooterBar, PaneFooterProvider } from "./footer";
import { PaneBodyLoadingRow } from "./frame";
import { usePaneStatusFooter } from "./status-footer";
import { PaneStatusBody } from "../../ui/status";

const tui = createOpenTuiTestHarness();

function Probe({ loading, replace }: { loading: boolean; replace: boolean }) {
  usePaneStatusFooter({ registrationId: "probe", loading, error: loading ? null : "quotes down" });
  return replace
    ? <PaneStatusBody loading={loading} subject="Quotes"><Text>ROWS</Text></PaneStatusBody>
    : <Text>ROWS</Text>;
}

function Shell({ loading, replace }: { loading: boolean; replace: boolean }) {
  return (
    <PaneFooterProvider>
      {(footer) => (
        <Box width={40} height={8} flexDirection="column">
          <Box width={40} height={6} flexDirection="column">
            <PaneBodyLoadingRow />
            <Probe loading={loading} replace={replace} />
          </Box>
          <PaneFooterBar footer={footer} focused width={40} />
        </Box>
      )}
    </PaneFooterProvider>
  );
}

async function paint(node: JSX.Element) {
  await tui.render(node, { width: 40, height: 8 });
  await act(async () => {
    await tui.setup().renderOnce();
    await tui.setup().renderOnce();
  });
}

test("a refresh keeps the rows and draws the spinner in the body", async () => {
  await paint(<Shell loading replace={false} />);
  const frame = tui.frame();
  expect(frame).toContain("Loading...");
  expect(frame).toContain("ROWS");
  expect(frame).not.toMatch(/\bloading\b/);
});

test("the first load is one spinner", async () => {
  await paint(<Shell loading replace />);
  const matches = tui.frame().match(/Loading\.\.\./g) ?? [];
  expect(matches).toHaveLength(1);
  expect(tui.frame()).not.toContain("ROWS");
});

test("a settled pane keeps its rows and does not spin", async () => {
  await paint(<Shell loading={false} replace={false} />);
  const frame = tui.frame();
  expect(frame).toContain("ROWS");
  expect(frame).toContain("quotes down");
  expect(frame).not.toContain("Loading...");
});
