import type { ScrollBoxRenderable } from "@opentui/core";
import { describe, expect, test } from "bun:test";
import { act, useRef } from "react";
import { createOpenTuiTestHarness } from "../../../renderers/opentui/test-utils";
import { createRemoteUiRegistry, RemoteUiRegistryProvider } from "../../../remote/semantic-tree";
import { AppContext, PaneInstanceProvider, createInitialState } from "../../../state/app/context";
import { createStaticAppStore } from "../../../test-support/app-store";
import { createDefaultConfig } from "../../../types/config";
import { DataTable } from "./index";

const tui = createOpenTuiTestHarness();

type Row = { id: string; name: string };

const rows: Row[] = [
  { id: "aapl", name: "Apple" },
  { id: "msft", name: "Microsoft" },
  { id: "nvda", name: "NVIDIA" },
];

function Table({ selectedId }: { selectedId: string | null }) {
  const headerScrollRef = useRef<ScrollBoxRenderable>(null);
  const scrollRef = useRef<ScrollBoxRenderable>(null);

  return (
    <DataTable
      columns={[{ id: "name", label: "Name", width: 12, align: "left" }]}
      items={rows}
      sortColumnId="name"
      sortDirection="desc"
      headerScrollRef={headerScrollRef}
      scrollRef={scrollRef}
      syncHeaderScroll={() => {}}
      onBodyScrollActivity={() => {}}
      getItemKey={(row) => row.id}
      isSelected={(row) => row.id === selectedId}
      onSelect={() => {}}
      renderCell={(row) => ({ text: row.name })}
      emptyStateTitle="No rows."
    />
  );
}

async function tableMetadata(selectedId: string | null) {
  const registry = createRemoteUiRegistry();
  const state = createInitialState(createDefaultConfig("/tmp/gloomberb-table-metadata"));
  await tui.render(
    <RemoteUiRegistryProvider registry={registry}>
      <AppContext value={createStaticAppStore(state)}>
        <PaneInstanceProvider paneId="table-metadata">
          <Table selectedId={selectedId} />
        </PaneInstanceProvider>
      </AppContext>
    </RemoteUiRegistryProvider>,
    { width: 32, height: 6 },
  );
  await act(async () => {
    await tui.setup().renderOnce();
  });
  return registry.snapshot().find((node) => node.role === "table")?.metadata;
}

describe("DataTable remote metadata", () => {
  test("publishes the row count and selected id without a rows array", async () => {
    const metadata = await tableMetadata("msft");

    expect(metadata).toEqual({
      paneInstanceId: "table-metadata",
      sortColumnId: "name",
      sortDirection: "desc",
      columns: [{ id: "name", label: "Name" }],
      rowCount: 3,
      selectedId: "msft",
    });
    expect(metadata).not.toHaveProperty("rows");
  });

  test("publishes a null selected id when no row is selected", async () => {
    const metadata = await tableMetadata(null);

    expect(metadata).toEqual({
      paneInstanceId: "table-metadata",
      sortColumnId: "name",
      sortDirection: "desc",
      columns: [{ id: "name", label: "Name" }],
      rowCount: 3,
      selectedId: null,
    });
    expect(metadata).not.toHaveProperty("rows");
  });
});
