import { afterEach, describe, expect, test } from "bun:test";
import { act, useEffect, useRef } from "react";
import { testRender } from "../../../renderers/opentui/test-utils";
import {
  AppContext,
  PaneInstanceProvider,
  createInitialState,
} from "../../../state/app/context";
import { createDefaultConfig } from "../../../types/config";
import {
  RemoteUiRegistryProvider,
  useRemoteUiRegistry,
  type RemoteUiRegistry,
} from "../../../remote/semantic-tree";
import { DataTable, type DataTableColumn } from "./index";
import type { ScrollBoxRenderable } from "../../../ui";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;
let remoteRegistry: RemoteUiRegistry | null = null;

afterEach(async () => {
  const setup = testSetup;
  testSetup = undefined;
  remoteRegistry = null;
  if (!setup) return;
  await act(async () => {
    setup.renderer.destroy();
  });
});

type Row = { id: string; title: string };
const columns: Array<DataTableColumn & { id: "title" }> = [
  { id: "title", label: "Title", width: 20, align: "left" },
];

function RemoteRegistryProbe() {
  const registry = useRemoteUiRegistry();
  useEffect(() => {
    remoteRegistry = registry;
  }, [registry]);
  return null;
}

function RemoteTableHarness({
  items,
  selectedId,
  selectedItemKey,
  onIsSelected,
}: {
  items: Row[];
  selectedId: string | null;
  selectedItemKey?: string | null;
  onIsSelected?: () => void;
}) {
  const headerScrollRef = useRef<ScrollBoxRenderable>(null);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const state = createInitialState(
    createDefaultConfig("/tmp/gloomberb-data-table-remote-test"),
  );

  return (
    <AppContext value={{ state, dispatch: () => {} }}>
      <PaneInstanceProvider paneId="data-table-remote-test">
        <RemoteUiRegistryProvider>
          <RemoteRegistryProbe />
          <DataTable<Row, DataTableColumn & { id: "title" }>
            columns={columns}
            items={items}
            sortColumnId="title"
            sortDirection="desc"
            onHeaderClick={() => undefined}
            headerScrollRef={headerScrollRef}
            scrollRef={scrollRef}
            syncHeaderScroll={() => {}}
            onBodyScrollActivity={() => {}}
            getItemKey={(row) => row.id}
            selectedItemKey={selectedItemKey}
            isSelected={(row) => {
              onIsSelected?.();
              return row.id === selectedId;
            }}
            onSelect={() => {}}
            renderCell={(row) => ({ text: row.title })}
            emptyStateTitle="No rows"
          />
        </RemoteUiRegistryProvider>
      </PaneInstanceProvider>
    </AppContext>
  );
}

describe("DataTable remote metadata", () => {
  test("publishes sort, columns, rowCount, and selectedId without projecting rows", async () => {
    const items = Array.from({ length: 250 }, (_, index) => ({
      id: `row-${index}`,
      title: `Row ${index}`,
    }));
    testSetup = await testRender(
      <RemoteTableHarness items={items} selectedId="row-7" />,
      { width: 40, height: 12 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const tableNode = remoteRegistry?.snapshot().find((node) => node.role === "table");
    expect(tableNode?.metadata).toEqual({
      sortColumnId: "title",
      sortDirection: "desc",
      columns: [{ id: "title", label: "Title" }],
      rowCount: 250,
      selectedId: "row-7",
    });
    expect(tableNode?.metadata).not.toHaveProperty("rows");
  });

  test("does not scan items for selectedId when selectedItemKey is provided", async () => {
    const items = Array.from({ length: 250 }, (_, index) => ({
      id: `row-${index}`,
      title: `Row ${index}`,
    }));
    let isSelectedCalls = 0;
    testSetup = await testRender(
      <RemoteTableHarness
        items={items}
        selectedId="row-7"
        selectedItemKey="row-7"
        onIsSelected={() => {
          isSelectedCalls += 1;
        }}
      />,
      { width: 40, height: 12 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const tableNode = remoteRegistry?.snapshot().find((node) => node.role === "table");
    expect(tableNode?.metadata).toMatchObject({
      rowCount: 250,
      selectedId: "row-7",
    });
    expect(isSelectedCalls).toBeLessThan(150);
  });
});
