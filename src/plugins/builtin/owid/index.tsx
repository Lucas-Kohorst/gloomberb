import type { PluginModule } from "../plugin-module";
import { registerConnectionSource } from "../connections/register";
import { parseOwidShortcutArg } from "../../../sources/owid/parse";
import { ADJACENT_PLUGIN_ID } from "../adjacent/types";
import { OwidPane } from "./pane";
import { OWID_CONNECTION_ID, OWID_PANE_ID } from "./types";

let disposeConnection: (() => void) | null = null;

export const owidModule: PluginModule = {
  panes: [
    {
      id: OWID_PANE_ID,
      name: "Our World in Data",
      icon: "O",
      component: OwidPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 88, height: 30 },
    },
  ],

  paneTemplates: [
    {
      id: "owid-pane",
      paneId: OWID_PANE_ID,
      label: "Our World in Data",
      description:
        "Search Our World in Data grapher charts and series keyed by slug + entity code (ISO alpha-3 / OWID custom). CC BY 4.0; some charts are not redistributable.",
      keywords: [
        "owid",
        "our world in data",
        "grapher",
        "life expectancy",
        "population",
        "gdp",
        "climate",
        "health",
        "cc by",
      ],
      category: "Data",
      shortcut: { prefix: "OWID", argPlaceholder: "query", argKind: "text", argOptional: true },
      wizard: [{
        key: "query",
        label: "Chart or series",
        placeholder: "life-expectancy USA",
        type: "text",
        body: [
          "Enter a topic, a grapher slug, or slug plus entity code (e.g. life-expectancy USA).",
        ],
      }],
      createInstance: (_context, options) => {
        const parsed = parseOwidShortcutArg(options?.arg ?? options?.values?.query ?? "");
        return {
          placement: "floating",
          params: {
            query: parsed.query,
            slug: parsed.slug ?? "",
            entity: parsed.entity ?? "",
          },
        };
      },
    },
  ],

  setup() {
    disposeConnection = registerConnectionSource({
      id: OWID_CONNECTION_ID,
      name: "Our World in Data",
      kind: "data",
      pluginId: ADJACENT_PLUGIN_ID,
      priority: 270,
      authRequired: false,
    });
  },

  dispose() {
    disposeConnection?.();
    disposeConnection = null;
  },
};
