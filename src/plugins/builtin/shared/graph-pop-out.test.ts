import { describe, expect, test } from "bun:test";
import {
  CHART_COMPOSER_TEMPLATE_ID,
  openChartComposerPopOut,
} from "./graph-pop-out";

describe("chart composer pop-out", () => {
  test("opens the floating Custom Chart template with the series expression", () => {
    const opened: Array<{ templateId: string; arg?: string }> = [];
    expect(openChartComposerPopOut((templateId, options) => {
      opened.push({ templateId, arg: options?.arg });
    }, "  ADJ:red  ")).toBe(true);
    expect(opened).toEqual([{ templateId: CHART_COMPOSER_TEMPLATE_ID, arg: "ADJ:red" }]);
  });

  test("does not open a chart when there is no expression", () => {
    const opened: string[] = [];
    expect(openChartComposerPopOut((templateId) => {
      opened.push(templateId);
    }, "   ")).toBe(false);
    expect(openChartComposerPopOut((templateId) => {
      opened.push(templateId);
    }, null)).toBe(false);
    expect(opened).toEqual([]);
  });
});
