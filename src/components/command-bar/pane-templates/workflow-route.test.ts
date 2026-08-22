import { describe, expect, test } from "bun:test";
import type { PaneTemplateDef } from "../../../types/plugin";
import { shouldOpenPaneTemplateConfig } from "./workflow-route";

// ticker/tickers placeholders generate a config field. That is what lets
// canPromptForPaneTemplateArg run; argOptional then short-circuits it.
function chatLikeTextTemplate(argOptional?: boolean): PaneTemplateDef {
  return {
    id: "new-chat-pane",
    paneId: "chat",
    label: "New Chat Pane",
    description: "Open the floating chat window",
    shortcut: {
      prefix: "CHAT",
      argPlaceholder: "ticker",
      argKind: "text",
      ...(argOptional ? { argOptional: true } : {}),
    },
  };
}

describe("shouldOpenPaneTemplateConfig", () => {
  test("CHAT-like text shortcut with argOptional does not open config when arg is empty", () => {
    expect(shouldOpenPaneTemplateConfig(chatLikeTextTemplate(true))).toBe(false);
    expect(shouldOpenPaneTemplateConfig(chatLikeTextTemplate(true), "")).toBe(false);
    expect(shouldOpenPaneTemplateConfig(chatLikeTextTemplate(true), "  ")).toBe(false);
  });

  test("CHAT-like text shortcut without argOptional opens config when arg is empty", () => {
    expect(shouldOpenPaneTemplateConfig(chatLikeTextTemplate())).toBe(true);
    expect(shouldOpenPaneTemplateConfig(chatLikeTextTemplate(), "")).toBe(true);
  });

  test("CHAT-like text shortcut still skips config when an arg is provided", () => {
    expect(shouldOpenPaneTemplateConfig(chatLikeTextTemplate(), "#general")).toBe(false);
    expect(shouldOpenPaneTemplateConfig(chatLikeTextTemplate(true), "#general")).toBe(false);
  });
});
