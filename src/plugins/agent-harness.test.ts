import { describe, expect, test } from "bun:test";
import { buildPluginAgentPrompt } from "./agent-harness";

describe("buildPluginAgentPrompt", () => {
  test("names the template id and seed so the agent can open the pane", () => {
    const prompt = buildPluginAgentPrompt({
      label: "CFTC Filings",
      templates: [{
        id: "cftc-filings-pane",
        shortcut: { prefix: "CFTC", argKind: "text" },
      }],
      howTo: "Pass options.arg chart for the DCM stacked bar.",
    });
    expect(prompt).toContain("pane.createFromTemplate cftc-filings-pane options.arg (CFTC)");
    expect(prompt).toContain("Pass options.arg chart");
  });
});
