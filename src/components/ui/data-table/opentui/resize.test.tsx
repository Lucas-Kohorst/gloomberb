import { afterEach, expect, test } from "bun:test";
import { act, useRef } from "react";
import { testRender } from "../../../../renderers/opentui/test-utils";
import { AppContext, PaneInstanceProvider, createInitialState } from "../../../../state/app/context";
import { createDefaultConfig } from "../../../../types/config";
import type { ScrollBoxRenderable } from "../../../../ui";
import { OpenTuiDataTable } from "./index";

let setup: Awaited<ReturnType<typeof testRender>> | undefined;
afterEach(async () => { await act(async () => setup?.renderer.destroy()); setup = undefined; });

function Harness({ onReset }: { onReset: (id: string) => void }) {
  const header = useRef<ScrollBoxRenderable>(null);
  const body = useRef<ScrollBoxRenderable>(null);
  const state = createInitialState(createDefaultConfig("/tmp/gloom-resize-test"));
  state.focusedPaneId = "portfolio-list:main";
  return <AppContext value={{ state, dispatch: () => {} }}>
    <PaneInstanceProvider paneId="portfolio-list:main">
      <OpenTuiDataTable
        columns={[{ id: "name", label: "Name", width: 20 }]}
        items={[{ id: "one" }]} sortColumnId="name" sortDirection="asc"
        fillAvailableWidth={false} onHeaderClick={() => {}}
        onColumnResize={() => {}} onColumnResizeReset={onReset}
        headerScrollRef={header} scrollRef={body} syncHeaderScroll={() => {}} onBodyScrollActivity={() => {}}
        getItemKey={(item) => item.id} isSelected={() => false} onSelect={() => {}}
        renderCell={(item) => ({ text: item.id })} emptyStateTitle="Empty"
      />
    </PaneInstanceProvider>
  </AppContext>;
}

async function click() {
  await act(async () => { await setup!.mockMouse.click(21, 0); await setup!.renderOnce(); });
}

test("native clicks reset only as a timely pair without a drag", async () => {
  const reset: string[] = [];
  setup = await testRender(<Harness onReset={(id) => reset.push(id)} />, { width: 40, height: 8 });
  await act(async () => { await setup!.renderOnce(); await setup!.renderOnce(); });
  await click();
  await click();
  expect(reset).toEqual(["name"]);
  await click();
  await Bun.sleep(425);
  await click();
  expect(reset).toEqual(["name"]);
  await Bun.sleep(425);
  await act(async () => { await setup!.mockMouse.drag(21, 0, 24, 0); await setup!.renderOnce(); });
  await click();
  expect(reset).toEqual(["name"]);
});

test("Alt+0 resets the focused table's sorted column without a pointer", async () => {
  const reset: string[] = [];
  setup = await testRender(<Harness onReset={(id) => reset.push(id)} />, { width: 40, height: 8 });
  await act(async () => { await setup!.renderOnce(); await setup!.renderOnce(); });
  await act(async () => {
    setup!.mockInput.pressKey("0", { meta: true });
    await setup!.renderOnce();
  });
  expect(reset).toEqual(["name"]);
});
