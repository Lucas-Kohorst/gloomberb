import type { ComponentType, ReactNode } from "react";
import type { GloomPlugin, PaneProps } from "../../../types/plugin";
import { apiClient } from "../../../api-client";
import { createGloomberbCloudCapabilities, createGloomberbCloudProvider } from "../../../sources/gloomberb-cloud";
import { AccountManagementPane } from "../account-management/pane";
import { createByokManageCommand } from "../byok/commands";
import { chatController } from "../chat/controller";
import {
  buildDmCommandResults,
  formatChatPaneTitle,
  getPreferredChatOpenChannelId,
  normalizeShortcutChannelId,
  openDmTargetFromCommand,
  parseConversationCreateArg,
} from "../chat/channels";
import { buildWhoCommandResults } from "../chat/profile-search";
import { buildChatPaneSettingsDef } from "../chat/settings";
import { disposeTwitterFeedFeature, registerTwitterFeedFeature } from "../cloud-tweets/registration";
import { composeBuiltinPlugin, type PluginModule } from "../plugin-module";
import { registerCloudAuthCommands } from "./auth-commands";
import { registerCloudUpgradeCommand } from "./upgrade-command";
import { CloudUpgradeStatusWidget } from "./upgrade-status-widget";
import { teamChannelId } from "./team/model";
import { teamStore } from "./team/store";
import { GLOOM_CLOUD_HTTP_CONNECTION_ID } from "../../../core/connection-health";
import { registerConnectionSource, withConnectionRequest } from "../connections/register";
import { SHARE_CONNECTION_ID } from "../../../shares/connection";
import { registerGloomCloudInventorySources } from "./connections";
import type { SyncTransport } from "../../../sync/types";
import { appendNotificationLog } from "../../../notifications/notification-log";
import { formatChannelToast } from "../chat/controller/utils";

interface GloomberbCloudPluginComponents {
  ChatPane: (props: PaneProps) => ReactNode;
  ChatStatusWidget: ComponentType;
  extraModules?: readonly PluginModule[];
}

function createCloudDataModule(): PluginModule {
  let disposeConfigConnection: (() => void) | null = null;
  let disposeSharingConnection: (() => void) | null = null;
  let disposeOllamaConnection: (() => void) | null = null;
  let disposeGloomCloudInventory: (() => void) | null = null;
  return {
    capabilities: createGloomberbCloudCapabilities(createGloomberbCloudProvider()),
    setup(ctx) {
      ctx.registerSyncTransport(createGloomberbCloudSyncTransport());
      disposeGloomCloudInventory = registerGloomCloudInventorySources();
      disposeConfigConnection = registerConnectionSource({
        id: "hosted-config",
        name: "Hosted Config Sync",
        kind: "api",
        pluginId: "gloomberb-cloud",
        priority: 100,
        authRequired: true,
      });
      disposeSharingConnection = registerConnectionSource({
        id: SHARE_CONNECTION_ID,
        name: "Gloom Sharing",
        kind: "api",
        pluginId: "gloomberb-cloud",
        authRequired: false,
      });
      disposeOllamaConnection = registerConnectionSource({
        id: "ollama",
        name: "Ollama (local)",
        kind: "api",
        pluginId: "gloomberb-cloud",
        authRequired: false,
      });
    },
    dispose() {
      disposeGloomCloudInventory?.();
      disposeGloomCloudInventory = null;
      disposeConfigConnection?.();
      disposeConfigConnection = null;
      disposeSharingConnection?.();
      disposeSharingConnection = null;
      disposeOllamaConnection?.();
      disposeOllamaConnection = null;
      apiClient.dispose();
    },
  };
}

export function createGloomberbCloudSyncTransport(
  isAvailable: () => boolean = () => apiClient.isVerified(),
): SyncTransport {
  return {
    id: "gloomberb-cloud",
    isAvailable,
    pullSnapshot: () => withConnectionRequest(
      GLOOM_CLOUD_HTTP_CONNECTION_ID,
      "pullSnapshot",
      () => apiClient.getSyncSnapshot(),
    ),
    pushSnapshot: (snapshot, options) => withConnectionRequest(
      GLOOM_CLOUD_HTTP_CONNECTION_ID,
      "pushSnapshot",
      () => apiClient.putSyncSnapshot(snapshot, options),
    ),
  };
}

function createChatModule(
  ChatPane: GloomberbCloudPluginComponents["ChatPane"],
  ChatStatusWidget: GloomberbCloudPluginComponents["ChatStatusWidget"],
): PluginModule {
  return {
    panes: [{
      id: "chat",
      name: "Chat",
      icon: "C",
      component: ChatPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 80, height: 30 },
      settings: (context) => buildChatPaneSettingsDef(context.settings),
      portableShare: {
        private: { title: true, params: true, settings: true, state: true },
      },
    }],
    paneTemplates: [{
      id: "new-chat-pane",
      paneId: "chat",
      label: "New Chat Pane",
      description: "Open the floating chat window for a channel",
      keywords: ["new", "chat", "pane", "message"],
      shortcut: { prefix: "CHAT", argPlaceholder: "channel", argKind: "text", argOptional: true },
      singleton: true,
      createInstance: async (context, options) => {
        // `CHAT MD` or `CHAT "Macro Desk"` opens that team's #general. A raw
        // channel id (team ids are mixed case) is kept as typed.
        const rawArg = options?.arg?.trim() ?? "";
        const team = rawArg ? teamStore.findTeam(rawArg) : null;
        const channelId = team
          ? teamChannelId(team.id)
          : rawArg && chatController.getChannels().some((entry) => entry.id === rawArg)
          ? rawArg
          : rawArg
          ? await chatController.resolveRequiredChannelId(normalizeShortcutChannelId(rawArg))
          : await chatController.resolvePreferredChannelId(
            getPreferredChatOpenChannelId(context.config, chatController.getSnapshot()),
          );
        const channel = chatController.getChannels().find((entry) => entry.id === channelId);
        const targetMessageId = options?.values?.messageId?.trim() || null;
        return {
          placement: "floating",
          // One pane per channel: re-opening the same channel focuses the pane
          // that already holds it, even though its channelId setting drifts as
          // the user switches channels inside the pane. A jump to a specific
          // message stays unkeyed so it never lands on a pane that already
          // scrolled past the target.
          ...(targetMessageId ? {} : { instanceId: `chat:${channelId}` }),
          title: formatChatPaneTitle(channel, channelId),
          settings: {
            channelId,
            ...(targetMessageId ? { targetMessageId } : {}),
          },
        };
      },
    }],
    slots: {
      "status:widget": () => <ChatStatusWidget />,
    },
    setup(ctx) {
      chatController.attachPersistence(ctx.persistence, ctx.resume);
      chatController.setNotifier(ctx.notify, (channelId, messageId) => {
        ctx.createPaneFromTemplate("new-chat-pane", { arg: channelId, values: { messageId } });
      });
      // Mirror server-issued chat notifications into the notification log so a
      // channel that is only polled (never focused here) still shows up in the
      // Notification Center. Written straight to the log, so no toast fires.
      // refId = message id keeps this in sync with the mention/reply entries
      // that also describe the same message.
      chatController.setOnUnreadMessage((message, channelId) => {
        const channel = chatController.getChannels().find((entry) => entry.id === channelId);
        appendNotificationLog({
          title: formatChatPaneTitle(channel, channelId),
          body: formatChannelToast(message, channel?.kind === "direct"),
          type: "info",
          refId: message.id,
        }, "chat");
      });
      ctx.registerCommand({
        id: "direct-message",
        label: "DM",
        description: "Open an existing DM or start a direct/group chat",
        keywords: ["dm", "direct", "message", "group", "chat"],
        category: "navigation",
        shortcut: "DM",
        shortcutArg: {
          placeholder: "@username [@username...] [name]",
          kind: "text",
          parse: (arg) => ({ participants: arg.trim() }),
        },
        buildResults: (arg) => buildDmCommandResults(ctx, arg),
        execute: async (values) => {
          const participants = values?.participants ?? values?.shortcut ?? "";
          const created = parseConversationCreateArg(participants);
          if (participants.trim() && !created) {
            throw new Error("Use @username, or multiple usernames and an optional name for a group.");
          }
          await openDmTargetFromCommand(ctx, created?.usernames ?? [], created?.name);
        },
      });
      ctx.registerCommand({
        id: "who-profile",
        label: "WHO",
        description: "Open a public chat profile",
        keywords: ["who", "profile", "user", "username", "people", "chat"],
        category: "navigation",
        shortcut: "WHO",
        shortcutArg: {
          placeholder: "@username",
          kind: "text",
          parse: (arg) => ({ username: arg.trim() }),
        },
        buildResults: (arg) => buildWhoCommandResults(ctx, arg),
        execute: async (values) => {
          const results = buildWhoCommandResults(ctx, values?.username ?? values?.shortcut ?? "");
          const match = results.find((result) => !result.disabled);
          if (!match) {
            ctx.notify({
              body: "No chat user matched that search.",
              type: "error",
            });
            return;
          }
          await match.execute();
        },
      });
    },
    dispose() {
      chatController.dispose();
    },
  };
}

const accountModule: PluginModule = {
  panes: [{
    id: "account-management",
    name: "ACM",
    icon: "A",
    component: AccountManagementPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 112, height: 36 },
    portableShare: {
      private: { title: true, params: true, settings: true, state: true },
    },
  }],
  paneTemplates: [{
    id: "account-management-pane",
    paneId: "account-management",
    label: "Account Management",
    description: "Manage Gloom Cloud profile, display (theme, font, size), AI providers, API keys, password, and public portfolio sharing",
    keywords: ["account", "profile", "cloud", "acm", "password", "settings", "ai", "provider", "ollama", "openrouter", "anthropic", "openai", "theme", "font", "display", "keys", "byok", "api"],
    shortcut: { prefix: "ACM" },
    createInstance: () => ({ placement: "floating" }),
  }],
  slots: {
    "status:widget": () => <CloudUpgradeStatusWidget />,
  },
  setup: (ctx) => {
    registerCloudAuthCommands(ctx);
    registerCloudUpgradeCommand(ctx);
    ctx.registerCommand(createByokManageCommand((paneId) => ctx.showPane(paneId)));
  },
};

const twitterModule: PluginModule = {
  setup: registerTwitterFeedFeature,
  dispose: disposeTwitterFeedFeature,
};

export function createGloomberbCloudPlugin({
  ChatPane,
  ChatStatusWidget,
  extraModules = [],
}: GloomberbCloudPluginComponents): GloomPlugin {
  return composeBuiltinPlugin({
    id: "gloomberb-cloud",
    name: "Gloom Cloud",
    version: "1.0.0",
    description: "Gloom Cloud auth, chat, sync, and Twitter feeds. Chat requires signup.",
    toggleable: true,
    order: 10,
    modules: [
      createCloudDataModule(),
      createChatModule(ChatPane, ChatStatusWidget),
      accountModule,
      ...extraModules,
      twitterModule,
    ],
  });
}
