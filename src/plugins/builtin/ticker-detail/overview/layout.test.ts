import { expect, test } from "bun:test";
import { getTickerResearchPaneSettings, buildTickerResearchSettingsDef } from "../settings";
import { overviewPanels } from "./layout";

test("overview custom panel settings survive settings serialization without duplicate panels or unknown IDs", () => {
  expect(getTickerResearchPaneSettings(undefined).overviewPreset).toBe("classic");
  const saved = JSON.parse(JSON.stringify({
    overviewPreset: "custom", overviewPanel1: "sec", overviewPanel2: "news",
    overviewPanel3: "sec", overviewPanel4: "removed-plugin", hideTabs: true, lockedTabId: "overview",
  }));
  const settings = getTickerResearchPaneSettings(saved);
  expect(overviewPanels(settings.overviewPreset, settings.overviewPanels)).toEqual(["sec", "news"]);
  const reopened = getTickerResearchPaneSettings(buildTickerResearchSettingsDef(settings).values);
  expect(overviewPanels(reopened.overviewPreset, reopened.overviewPanels)).toEqual(["sec", "news"]);
  expect(reopened.hideTabs).toBe(true);
  expect(reopened.lockedTabId).toBe("overview");
});

test("changing presets retains saved custom panel slots", () => {
  const saved = { overviewPreset: "news", overviewPanel1: "snapshot", overviewPanel2: "none", overviewPanel3: "none", overviewPanel4: "none" };
  const preset = getTickerResearchPaneSettings(saved);
  expect(overviewPanels(preset.overviewPreset, preset.overviewPanels)).toEqual(["news", "buzz"]);
  const custom = getTickerResearchPaneSettings({ ...buildTickerResearchSettingsDef(preset).values, overviewPreset: "custom" });
  expect(overviewPanels(custom.overviewPreset, custom.overviewPanels)).toEqual(["snapshot"]);
});
