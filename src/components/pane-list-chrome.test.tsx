import { afterEach, describe, expect, test } from "bun:test";
import { act, useRef, useState } from "react";
import { testRender } from "../renderers/opentui/test-utils";
import { AppContext, createInitialState } from "../state/app/context";
import { createDefaultConfig } from "../types/config";
import { Box, Text, type InputRenderable } from "../ui";
import { Tabs } from "./ui/tabs";
import { PaneListChrome } from "./pane-list-chrome";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(async () => {
  if (!testSetup) return;
  await act(async () => {
    testSetup!.renderer.destroy();
  });
  testSetup = undefined;
});

function SearchChromeHarness({
  trailing,
}: {
  trailing?: boolean;
}) {
  const state = createInitialState(createDefaultConfig("/tmp/gloomberb-pane-list-chrome"));
  const inputRef = useRef<InputRenderable | null>(null);
  const [activeTab, setActiveTab] = useState("indices");
  const [query, setQuery] = useState("");

  return (
    <AppContext value={{ state, dispatch: () => {} }}>
      <PaneListChrome
        width={48}
        height={8}
        focused
        tabs={[
          { label: "Indices", value: "indices" },
          { label: "Rates", value: "rates" },
          { label: "CFTC", value: "cftc" },
        ]}
        activeValue={activeTab}
        onSelect={setActiveTab}
        search={{
          value: query,
          active: false,
          focusToken: 0,
          inputRef,
          placeholder: "ticker or name",
          debounceMs: 80,
          onFocus: () => {},
          onBlur: () => {},
          onQueryChange: setQuery,
        }}
        trailing={trailing ? (
          <Tabs
            tabs={[
              { label: "All", value: "all" },
              { label: "Watchlist", value: "watchlist" },
            ]}
            activeValue="all"
            onSelect={() => {}}
            compact
            variant="bare"
            scrollable={false}
          />
        ) : undefined}
      >
        <Box>
          <Text>table body</Text>
        </Box>
      </PaneListChrome>
    </AppContext>
  );
}

describe("PaneListChrome", () => {
  test("puts dataset tabs above / search and does not repeat a pane title", async () => {
    testSetup = await testRender(<SearchChromeHarness />, { width: 48, height: 8 });
    await act(async () => {
      await testSetup!.renderOnce();
    });

    const rows = testSetup.captureCharFrame().split("\n");
    const tabsRow = rows.findIndex((line) => line.includes("Indices") && line.includes("Rates"));
    const searchRow = rows.findIndex((line) => line.includes("/ ticker or name") || line.includes("/ticker or name"));
    const bodyRow = rows.findIndex((line) => line.includes("table body"));

    expect(tabsRow).toBeGreaterThanOrEqual(0);
    expect(rows[tabsRow]).toContain("Indices");
    expect(searchRow).toBeGreaterThan(tabsRow);
    expect(rows[searchRow]).toMatch(/ticker or name/);
    expect(bodyRow).toBeGreaterThan(searchRow);
    expect(rows.slice(0, bodyRow).join("\n")).not.toMatch(/\bAdjacent\b/);
    expect(rows[tabsRow]).not.toContain("ticker or name");
  });

  test("keeps filter chips on the search row", async () => {
    testSetup = await testRender(<SearchChromeHarness trailing />, { width: 56, height: 8 });
    await act(async () => {
      await testSetup!.renderOnce();
    });

    const rows = testSetup.captureCharFrame().split("\n");
    const searchRow = rows.findIndex((line) =>
      (line.includes("/ ticker or name") || line.includes("/ticker or name") || line.includes("ticker or name"))
      && line.includes("All")
    );
    expect(searchRow).toBeGreaterThanOrEqual(0);
    expect(rows[searchRow]).toContain("Watchlist");
  });
});
