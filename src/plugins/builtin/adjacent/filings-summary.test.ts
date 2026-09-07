import { afterEach, describe, expect, test } from "bun:test";
import { setAiRuntimeCatalog } from "../ai/runner";
import type { CftcFiling } from "./types";
import {
  buildCftcSummaryPrompt,
  parseCftcSummaryResponse,
  renderCftcSummary,
  summarizeCftcFiling,
} from "./filings-summary";

afterEach(() => {
  setAiRuntimeCatalog({ providers: [], accounts: [], models: [] });
});

function filing(overrides: Partial<CftcFiling> = {}): CftcFiling {
  return {
    id: 1,
    feed: "dcm_products",
    title: "Will Jackson Hole Mountain Resort open for the ski season?",
    orgCode: "KEX",
    status: "Certified",
    statusDate: new Date("2026-09-04"),
    docCount: 2,
    ...overrides,
  };
}

describe("CFTC filing summary", () => {
  test("prompt names the filing so the connected agent has context", () => {
    const prompt = buildCftcSummaryPrompt(filing(), "FOIA confidential treatment requested.");
    expect(prompt).toContain("Will Jackson Hole Mountain Resort open for the ski season?");
    expect(prompt).toContain("KEX");
    expect(prompt).toContain("New contract");
    expect(prompt).toContain("Certified");
    expect(prompt).toContain("FOIA confidential treatment requested.");
  });

  test("parses JSON from the connected agent, including fenced output", () => {
    expect(parseCftcSummaryResponse(JSON.stringify({
      executiveSummary: "Kalshi asked the CFTC to keep this filing confidential.",
      keyPoints: ["Five-year FOIA request", "Exemption 4"],
    }))).toEqual({
      executiveSummary: "Kalshi asked the CFTC to keep this filing confidential.",
      keyPoints: ["Five-year FOIA request", "Exemption 4"],
    });
    expect(parseCftcSummaryResponse("```json\n{\"executiveSummary\":\"Plain letter.\"}\n```")).toEqual({
      executiveSummary: "Plain letter.",
      keyPoints: [],
    });
  });

  test("renders the summary as markdown for the filing reader", () => {
    expect(renderCftcSummary({
      executiveSummary: "This is a confidential treatment request.",
      keyPoints: ["Withhold for five years"],
      generatedAt: 1,
      providerId: "openai-codex",
    })).toContain("AI Summary");
  });

  test("uses the connected provider to summarize", async () => {
    setAiRuntimeCatalog({
      providers: [{
        providerId: "openai-codex",
        label: "OpenAI (ChatGPT)",
        status: "ready",
        outputModes: ["plain"],
        defaultModelId: "gpt-5.6-sol",
      }],
      accounts: [{
        providerId: "openai-codex",
        providerLabel: "OpenAI (ChatGPT)",
        connectionState: "connected",
        connectionLabel: "Connected with OAuth",
        credentialSource: "OAuth",
        credentialOrigin: "stored",
        authMethods: [{ type: "oauth", label: "ChatGPT Plus/Pro", canLogin: true }],
        canLogin: true,
        canDisconnect: true,
        loginType: "oauth",
      }],
      models: [{ id: "gpt-5.6-sol", providerId: "openai-codex", label: "GPT-5.6 Sol", available: true }],
    });
    const result = await summarizeCftcFiling({
      filing: filing(),
      content: "Kalshi requests confidential treatment for five years.",
      providers: [{
        id: "openai-codex",
        name: "OpenAI (ChatGPT)",
        available: true,
        status: "ready",
        outputModes: ["plain"],
        defaultModelId: "gpt-5.6-sol",
      }],
      run: (options) => {
        expect(options.providerId).toBe("openai-codex");
        expect(options.prompt).toContain("Kalshi requests confidential treatment");
        return {
          done: Promise.resolve(JSON.stringify({
            executiveSummary: "Kalshi wants the CFTC to withhold the attached materials.",
            keyPoints: ["FOIA Exemption 4"],
          })),
          cancel: () => {},
        };
      },
    });
    expect(result.executiveSummary).toContain("Kalshi");
    expect(result.providerId).toBe("openai-codex");
  });
});
