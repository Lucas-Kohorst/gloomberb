import { afterEach, describe, expect, test } from "bun:test";
import { parseRootShortcutIntent, shortcutClaimsQuery } from "../../../components/command-bar/routes/root/shortcuts";
import { createDefaultConfig } from "../../../types/config";
import type { PaneDef, PaneTemplateDef } from "../../../types/plugin";
import { consumeRequestedAccountManagementTab } from "../account-management/navigation";
import { consumeAskGloomDraft } from "./workspace/pending-draft";
import { aiPlugin } from "./index";
import {
  AI_PROVIDER_IDS,
  getAiProviderDefinition,
  setDetectedProviders,
  type AiProviderId,
} from "./providers";
import {
  setAiRunHost,
  setAiRuntimeCatalog,
  type AiRuntimeCatalog,
} from "./runner";

function catalog(readyProviderIds: readonly AiProviderId[]): AiRuntimeCatalog {
  const ready = new Set(readyProviderIds);
  return {
    providers: AI_PROVIDER_IDS.map((providerId) => {
      const definition = getAiProviderDefinition(providerId)!;
      const connected = ready.has(providerId);
      return {
        providerId,
        label: definition.name,
        status: connected ? "ready" : "not_authenticated",
        ...(!connected ? { unavailableReason: "Not connected." } : {}),
        outputModes: [...definition.outputModes],
        defaultModelId: definition.preferredModelIds[0],
      };
    }),
    accounts: AI_PROVIDER_IDS.map((providerId) => {
      const definition = getAiProviderDefinition(providerId)!;
      const connected = ready.has(providerId);
      const supportsOAuth = [
        "anthropic",
        "openai-codex",
        "github-copilot",
        "xai",
      ].includes(providerId);
      return {
        providerId,
        providerLabel: definition.name,
        connectionState: connected ? "connected" : "not_connected",
        connectionLabel: connected ? "Connected" : "Not connected.",
        ...(connected ? {
          credentialSource: "OAuth",
          credentialOrigin: "stored" as const,
        } : {}),
        authMethods: supportsOAuth
          ? [{ type: "oauth" as const, label: "Sign in", canLogin: true }]
          : [{ type: "api_key" as const, label: "API key", canLogin: false }],
        canLogin: supportsOAuth,
        canDisconnect: connected,
        ...(supportsOAuth ? { loginType: "oauth" as const } : {}),
      };
    }),
    models: AI_PROVIDER_IDS.flatMap((providerId) => {
      const definition = getAiProviderDefinition(providerId)!;
      const modelId = definition.preferredModelIds[0];
      if (!modelId) return [];
      return [{
        id: modelId,
        providerId,
        label: modelId,
        available: ready.has(providerId),
      }];
    }),
  };
}

function setupPlugin(config = createDefaultConfig("/tmp/gloomberb-ai-plugin")) {
  const panes: PaneDef[] = [];
  const templates: PaneTemplateDef[] = [];
  const setCalls: Array<[string, unknown]> = [];
  const shownPanes: string[] = [];
  const listeners: {
    configChanged?: (payload: { config: typeof config }) => void;
  } = {};

  aiPlugin.setup?.({
    getConfig: () => config,
    showPane: (paneId: string) => { shownPanes.push(paneId); },
    configState: {
      get: (key: string) => config.pluginConfig.ai?.[key] ?? null,
      set: async (key: string, value: unknown) => {
        config.pluginConfig.ai = { ...(config.pluginConfig.ai ?? {}), [key]: value };
        setCalls.push([key, value]);
      },
      delete: async () => {},
      keys: () => Object.keys(config.pluginConfig.ai ?? {}),
    },
    resume: {
      getState: () => null,
      setState() {},
      deleteState() {},
      getPaneState: () => null,
      setPaneState() {},
      deletePaneState() {},
    },
    registerPane: (pane: PaneDef) => panes.push(pane),
    registerPaneTemplate: (template: PaneTemplateDef) => templates.push(template),
    registerTickerResearchTab() {},
    on: (event: string, listener: (payload: { config: typeof config }) => void) => {
      if (event === "config:changed") listeners.configChanged = listener;
      return () => {};
    },
    log: { warn() {} },
  } as any);

  return { config, listeners, panes, setCalls, shownPanes, templates };
}

afterEach(() => {
  setDetectedProviders(null);
  setAiRunHost(null);
  setAiRuntimeCatalog({ providers: [], accounts: [], models: [] });
  consumeRequestedAccountManagementTab();
});

describe("AI plugin shared provider settings", () => {
  test("routes Agent account management to ACM instead of pane Connect/Disconnect", async () => {
    setAiRuntimeCatalog(catalog(["anthropic"]));
    const { config, panes, shownPanes } = setupPlugin();
    const workspacePane = panes.find((pane) => pane.id === "local-agent-workspace");
    const settings = typeof workspacePane?.settings === "function"
      ? workspacePane.settings({
          config,
          layout: config.layout,
          paneId: "agent-pane",
          paneType: "local-agent-workspace",
          pane: { instanceId: "agent-pane", paneId: "local-agent-workspace", title: "AI Agent" },
          settings: {},
          paneState: {},
          activeTicker: null,
          activeCollectionId: null,
        })
      : null;
    expect(settings?.fields.some((field) => field.key.startsWith("account:"))).toBe(false);
    const manageField = settings?.fields.find((field) => field.key === "manageAiAccounts");
    if (manageField?.type !== "action") throw new Error("Expected Account Management action");
    let closed = false;
    await manageField.action({
      close() { closed = true; },
    } as any);
    expect(closed).toBe(true);
    expect(shownPanes).toEqual(["account-management"]);
    expect(consumeRequestedAccountManagementTab()).toBe("ai");
  });

  test("opens the Agent pane directly while keeping every adapter in shared settings", async () => {
    setAiRuntimeCatalog(catalog(["anthropic"]));
    const config = createDefaultConfig("/tmp/gloomberb-ai-plugin-settings");
    config.pluginConfig.ai = {
      defaultProviderId: "claude",
      defaultModelId: "claude-custom",
    };
    const { panes, templates } = setupPlugin(config);

    const workspaceTemplate = templates.find(
      (template) => template.id === "new-local-agent-workspace",
    );
    const screenerTemplate = templates.find(
      (template) => template.id === "new-ai-screener-pane",
    );
    expect(workspaceTemplate?.shortcut).toMatchObject({ prefix: "ASKG", aliases: ["AGENT"] });
    expect(screenerTemplate?.shortcut).toMatchObject({ prefix: "AIS", aliases: ["AI"] });
    for (const query of ["ASKG compare my holdings", "AGENT compare my holdings", "ASKG"]) {
      const intent = parseRootShortcutIntent({
        query, commands: [], pluginCommands: [], paneTemplates: templates, activeTicker: null,
      });
      expect(intent.kind).toBe(query === "ASKG" ? "partial" : "complete");
      expect(shortcutClaimsQuery(intent)).toBe(query !== "ASKG");
      if (intent.kind === "none" || intent.source !== "pane-template") throw new Error("Expected assistant route");
      expect(intent.template.id).toBe("new-local-agent-workspace");
      expect(intent.argText).toBe(query === "ASKG" ? "" : "compare my holdings");
    }
    const drafted = await workspaceTemplate?.createInstance?.({} as any, { arg: "compare my holdings" });
    const draftId = drafted?.params?.askGloomDraftId;
    expect(typeof draftId).toBe("string");
    expect(JSON.stringify(drafted)).not.toContain("compare my holdings");
    expect(consumeAskGloomDraft(String(draftId))).toBe("compare my holdings");
    expect(consumeAskGloomDraft(String(draftId))).toBeUndefined();
    expect(workspaceTemplate?.wizard).toBeUndefined();
    const workspaceInstance = workspaceTemplate?.createInstance?.({} as any, {});
    expect(workspaceInstance).toMatchObject({
      title: "Ask Gloom",
      placement: "floating",
    });
    expect((workspaceInstance as any)?.params?.newThreadId).toBeUndefined();
    expect(workspaceTemplate?.keywords).toContain("ai");
    expect(workspaceTemplate?.keywords).toContain("factory");
    expect(workspaceTemplate?.keywords).not.toContain("opencode");

    const workspacePane = panes.find((pane) => pane.id === "local-agent-workspace");
    const settings = typeof workspacePane?.settings === "function"
      ? workspacePane.settings({
          config,
          layout: config.layout,
          paneId: "agent-pane",
          paneType: "local-agent-workspace",
          pane: { instanceId: "agent-pane", paneId: "local-agent-workspace", title: "AI Agent" },
          settings: {},
          paneState: {},
          activeTicker: null,
          activeCollectionId: null,
        })
      : null;
    const defaultProviderField = settings?.fields.find(
      (field) => field.key === "defaultProviderId",
    );
    if (defaultProviderField?.type !== "select") {
      throw new Error("Expected shared default provider selector");
    }
    const providerIds = defaultProviderField.options.map((option) => option.value);
    expect(providerIds).toContain("factory");
    expect(providerIds).toContain("anthropic");
    expect(providerIds).not.toContain("ollama");

    config.pluginConfig.ai = {
      defaultProviderId: "codex",
      defaultModelId: "gpt-custom",
    };
    setAiRuntimeCatalog(catalog(["openai-codex"]));

    expect(screenerTemplate?.wizard?.find((step) => step.key === "providerId")?.defaultValue)
      .toBe("openai-codex");
  });
});
