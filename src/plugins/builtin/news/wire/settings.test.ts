import { describe, expect, test } from "bun:test";
import type { PaneSettingsContext } from "../../../../types/plugin";
import { buildNewsPaneSettingsDef, getNewsPaneSettings } from "./settings";
import { NEWS_MUTED_KEYWORDS_KEY, NEWS_MUTED_SOURCES_KEY, NEWS_PLUGIN_ID } from "./mutes";

function makePaneSettingsContext(
  settings: Record<string, unknown>,
  pluginConfig: Record<string, Record<string, unknown>> = {},
): PaneSettingsContext {
  return {
    config: { pluginConfig } as PaneSettingsContext["config"],
    layout: {} as PaneSettingsContext["layout"],
    paneId: "news-feed:main",
    paneType: "news-feed",
    pane: {} as PaneSettingsContext["pane"],
    settings,
    paneState: {},
    activeTicker: null,
    activeCollectionId: null,
  };
}

describe("news pane settings", () => {
  test("keeps headline visible and encodes the default sort", () => {
    const definition = buildNewsPaneSettingsDef(
      makePaneSettingsContext({ columnIds: ["time", "tickers"], sort: "source:asc" }),
      { columns: ["time", "source", "title", "tickers"], sort: { columnId: "time", direction: "desc" } },
    );
    expect(definition.values?.columnIds).toEqual(["time", "tickers", "title"]);
    expect(definition.values?.sort).toBe("source:asc");
    expect(definition.fields.map((field) => field.key)).toEqual(["columnIds", "sort"]);
  });

  test("falls back to the pane's own columns and sort", () => {
    expect(getNewsPaneSettings({}, {
      columns: ["time", "title", "importance"],
      sort: { columnId: "importance", direction: "desc" },
    })).toEqual({
      columnIds: ["time", "title", "importance"],
      sort: { columnId: "importance", direction: "desc" },
    });
  });
});

describe("news pane mute settings", () => {
  test("feed-list panes expose plugin-scoped Muted Sources and Muted Keywords", () => {
    const definition = buildNewsPaneSettingsDef(
      makePaneSettingsContext({}, {
        [NEWS_PLUGIN_ID]: { [NEWS_MUTED_SOURCES_KEY]: ["Legacy Feed"] },
      }),
      { columns: ["time", "source", "title"], sort: { columnId: "time", direction: "desc" } },
      { includeMutes: true },
    );
    const fields = definition.fields.map((field) => field.key);
    expect(fields).toEqual(["columnIds", "sort", NEWS_MUTED_SOURCES_KEY, NEWS_MUTED_KEYWORDS_KEY]);

    const sourcesField = definition.fields.find((field) => field.key === NEWS_MUTED_SOURCES_KEY)!;
    expect(sourcesField.type).toBe("multi-select");
    expect(sourcesField.storage).toBe("plugin");
    // Already-muted names stay selectable even with no recent articles.
    expect(sourcesField.type === "multi-select" && sourcesField.options.map((option) => option.value))
      .toEqual(["Legacy Feed"]);

    const keywordsField = definition.fields.find((field) => field.key === NEWS_MUTED_KEYWORDS_KEY)!;
    expect(keywordsField.type).toBe("text");
    expect(keywordsField.storage).toBe("plugin");
  });

  test("Top News omits the mute fields because mutes do not apply there", () => {
    const definition = buildNewsPaneSettingsDef(
      makePaneSettingsContext({}),
      { columns: ["time", "title", "importance"], sort: { columnId: "importance", direction: "desc" } },
      { title: "Top News Settings" },
    );
    expect(definition.fields.map((field) => field.key)).toEqual(["columnIds", "sort"]);
  });
});
