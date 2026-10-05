import type { PluginModule } from "../plugin-module";
import { registerConnectionSource } from "../connections/register";
import { ROTATION_CONNECTION_ID, rotationCache } from "./client";
import { rotationHeadless } from "./headless";
import { RelativeRotationPane } from "./pane";

let disposeConnection: (() => void) | null = null;

export const relativeRotationModule: PluginModule = {
  panes: [
    {
      id: "relative-rotation",
      name: "Relative Rotation",
      icon: "R",
      component: RelativeRotationPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 36 },
      tableExport: true,
      headless: rotationHeadless,
      settings: {
        title: "Relative Rotation",
        fields: [
          {
            key: "scope",
            label: "Universe",
            type: "select",
            options: [
              { value: "sectors", label: "US sectors" },
              { value: "collection", label: "Linked watchlist or portfolio" },
              { value: "custom", label: "Custom symbols" },
            ],
          },
          {
            key: "symbols",
            label: "Custom symbols",
            type: "text",
            placeholder: "AAPL:NASDAQ, MSFT:NASDAQ",
          },
          {
            key: "benchmark",
            label: "Benchmark",
            type: "text",
            placeholder: "SPY:NYSEARCA",
          },
          {
            key: "trail",
            label: "Trail weeks",
            type: "select",
            options: Array.from({ length: 11 }, (_, index) => index + 2).map(
              (value) => ({
                value: String(value),
                label: String(value),
              }),
            ),
          },
        ],
      },
    },
  ],
  paneTemplates: [{
    id: "relative-rotation-rrg",
    paneId: "relative-rotation",
    label: "Relative Rotation",
    description:
      "Sector or watchlist strength and momentum versus a benchmark, with weekly trails.",
    keywords: [
      "relative",
      "rotation",
      "strength",
      "momentum",
      "sector",
      "rrg",
      "grr",
    ],
    shortcut: { prefix: "RRG", aliases: ["GRR"], argKind: "ticker-list" as const, argOptional: true },
    headless: rotationHeadless,
    createInstance: (_context, options) => ({
      settings: options?.symbols?.length
        ? { scope: "custom", symbols: options.symbols.join(",") }
        : { scope: "sectors" },
      placement: "floating" as const,
    }),
  }],
  setup(ctx) {
    rotationCache.attach(ctx.persistence);
    disposeConnection = registerConnectionSource({
      id: ROTATION_CONNECTION_ID,
      name: "Gloom Cloud Relative Rotation",
      kind: "api",
      pluginId: "market-overview",
    });
  },
  dispose() {
    disposeConnection?.();
    disposeConnection = null;
    rotationCache.reset();
  },
};
