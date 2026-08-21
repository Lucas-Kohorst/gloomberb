import type { CommandResultDef, GloomPluginContext } from "../../../types/plugin";
import type { ChatChannel, ChatMessage, ChatUserSummary } from "../../../api-client";
import { t } from "../../../i18n";
import { chatController } from "./controller";
import { parseDmUsernames } from "./channels";
import { requestOpenChatProfile } from "./profile-request";

function rememberUser(map: Map<string, ChatUserSummary>, user: ChatUserSummary | null | undefined): void {
  if (!user?.id) return;
  const existing = map.get(user.id);
  map.set(user.id, existing ? { ...existing, ...user } : user);
}

export function collectKnownChatUsers(
  channels: ChatChannel[],
  messages: ChatMessage[],
): ChatUserSummary[] {
  const map = new Map<string, ChatUserSummary>();
  for (const message of messages) rememberUser(map, message.user);
  for (const channel of channels) {
    rememberUser(map, channel.dmUser);
    for (const member of channel.members ?? []) rememberUser(map, member);
  }
  return [...map.values()].sort((left, right) => {
    const leftName = (left.username ?? left.displayName).toLowerCase();
    const rightName = (right.username ?? right.displayName).toLowerCase();
    return leftName.localeCompare(rightName);
  });
}

export function listKnownChatUsersFromController(
  controller: {
    getChannels: () => ChatChannel[];
    getSnapshot: (channelId?: string) => { messages: ChatMessage[] };
  } = chatController,
): ChatUserSummary[] {
  const channels = controller.getChannels();
  const messages = channels.flatMap((channel) => controller.getSnapshot(channel.id).messages);
  return collectKnownChatUsers(channels, messages);
}

function matchesProfileQuery(user: ChatUserSummary, query: string): boolean {
  if (!query) return true;
  const haystack = [
    user.username,
    user.displayName,
    user.company,
    user.title,
    user.bio,
    user.xAccount,
  ].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(query);
}

export function openChatProfileFromCommand(
  ctx: Pick<GloomPluginContext, "createPaneFromTemplate">,
  user: ChatUserSummary,
): void {
  requestOpenChatProfile(user);
  const username = user.username?.trim().toLowerCase();
  const dm = chatController.getChannels().find((channel) => (
    channel.kind === "direct"
    && (
      channel.dmUser?.id === user.id
      || (username && channel.dmUser?.username?.trim().toLowerCase() === username)
    )
  ));
  ctx.createPaneFromTemplate("new-chat-pane", dm ? { arg: dm.id } : undefined);
}

function stubProfileUser(username: string): ChatUserSummary {
  return {
    id: username,
    username,
    displayName: username,
  };
}

export function buildWhoCommandResults(ctx: GloomPluginContext, arg: string): CommandResultDef[] {
  const trimmed = arg.trim();
  const query = trimmed.replace(/^@+/, "").toLowerCase();
  const users = listKnownChatUsersFromController(chatController).filter((user) => matchesProfileQuery(user, query));

  if (users.length > 0) {
    return users.map((user) => {
      const username = user.username?.trim();
      const label = username ? `@${username}` : user.displayName;
      const detail = [user.displayName !== label ? user.displayName : null, user.company, user.title]
        .filter(Boolean)
        .join(" · ") || t("Open public profile");
      return {
        id: `who:${user.id}`,
        label,
        detail,
        category: t("People"),
        right: "WHO",
        keywords: [user.username ?? "", user.displayName, user.company ?? ""],
        execute: () => openChatProfileFromCommand(ctx, user),
      };
    });
  }

  const typedUsername = parseDmUsernames(trimmed)[0] ?? (query || null);
  if (typedUsername) {
    return [{
      id: `who:${typedUsername}`,
      label: `@${typedUsername}`,
      detail: t("Open public profile"),
      category: t("People"),
      right: "WHO",
      execute: () => openChatProfileFromCommand(ctx, stubProfileUser(typedUsername)),
    }];
  }

  return [{
    id: "who:empty",
    label: t("No chat users yet"),
    detail: t("Type WHO @username to open a public profile"),
    category: t("People"),
    right: "WHO",
    disabled: true,
    execute: () => {},
  }];
}
