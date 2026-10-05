/** @jsxImportSource react */
import type { ScrollBoxRenderable } from "@opentui/core";
import { expect, test } from "bun:test";
import { act, useRef } from "react";
import { createOpenTuiTestHarness } from "../../../../renderers/opentui/test-utils";
import { AppContext, createInitialState } from "../../../../state/app/context";
import { createStaticAppStore } from "../../../../test-support/app-store";
import { createDefaultConfig } from "../../../../types/config";
import { OpenTuiDataTable } from "./index";

const tui = createOpenTuiTestHarness({ width: 40, height: 8 });

test("a second click on a column's gap resets that column", async () => {
  const reset: string[] = [];
  const state = createInitialState(createDefaultConfig("/tmp/gloomberb-column-resize"));

  function Harness() {
    const headerScrollRef = useRef<ScrollBoxRenderable>(null);
    const scrollRef = useRef<ScrollBoxRenderable>(null);
    return (
      <OpenTuiDataTable
        columns={[{ id: "name", label: "Name", width: 20 }]}
        items={[{ id: "one" }]}
        sortColumnId="name"
        sortDirection="asc"
        fillAvailableWidth={false}
        onHeaderClick={() => {}}
        onColumnResize={() => {}}
        onColumnResizeReset={(id) => reset.push(id)}
        headerScrollRef={headerScrollRef}
        scrollRef={scrollRef}
        syncHeaderScroll={() => {}}
        onBodyScrollActivity={() => {}}
        getItemKey={(item) => item.id}
        isSelected={() => false}
        onSelect={() => {}}
        renderCell={(item) => ({ text: item.id })}
        emptyStateTitle="Empty"
      />
    );
  }

  await tui.render(
    <AppContext value={createStaticAppStore(state)}>
      <Harness />
    </AppContext>,
  );
  await act(async () => {
    await tui.setup().renderOnce();
  });
  const clickGap = async () => {
    await act(async () => {
      await tui.setup().mockMouse.click(21, 0);
    });
  };
  await clickGap();
  await clickGap();
  expect(reset).toEqual(["name"]);
});
