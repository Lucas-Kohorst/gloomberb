import { Box, Text } from "../../../../ui";
import { TextAttributes } from "../../../../ui";
import { colors } from "../../../../theme/colors";
import type { ChatChannel, ChatUserSummary } from "../../../../api-client";
import { truncateChannelLabel } from "../channels";
import { isChatUserOnline, type ChatPresenceLookup } from "../peer-online";
import { OnlinePresenceDot } from "../presence-dot";

const MAX_VISIBLE_MEMBERS = 8;

export function listChannelMembers(channel: ChatChannel | undefined): ChatUserSummary[] {
  if (!channel || channel.kind === "direct") return [];
  const map = new Map<string, ChatUserSummary>();
  for (const member of channel.members ?? []) {
    if (member.id) map.set(member.id, member);
  }
  return [...map.values()];
}

export function ChannelMemberList({
  members,
  presence,
  width,
  onOpenProfile,
}: {
  members: ChatUserSummary[];
  presence: ChatPresenceLookup;
  width: number;
  onOpenProfile: (user: ChatUserSummary) => void;
}) {
  if (members.length === 0 || width < 8) return null;
  const ranked = [...members].sort((left, right) => {
    const leftOnline = isChatUserOnline(left, presence) ? 0 : 1;
    const rightOnline = isChatUserOnline(right, presence) ? 0 : 1;
    if (leftOnline !== rightOnline) return leftOnline - rightOnline;
    return (left.username ?? left.displayName).localeCompare(right.username ?? right.displayName);
  });
  const visible = ranked.slice(0, MAX_VISIBLE_MEMBERS);
  const extra = ranked.length - visible.length;
  const labelWidth = Math.max(6, Math.floor((width - 2 - (extra > 0 ? 4 : 0)) / Math.max(visible.length, 1)));

  return (
    <Box
      height={1}
      width={width}
      flexDirection="row"
      data-gloom-role="chat-member-list"
    >
      {visible.map((member) => {
        const online = isChatUserOnline(member, presence);
        const label = member.username ? `@${member.username}` : member.displayName;
        const chipWidth = Math.max(4, Math.min(label.length + (online ? 1 : 0), labelWidth));
        return (
          <Box
            key={member.id}
            height={1}
            width={chipWidth + 1}
            flexDirection="row"
            backgroundColor={colors.panel}
            onMouseDown={(event: { preventDefault?: () => void; stopPropagation?: () => void }) => {
              event?.preventDefault?.();
              event?.stopPropagation?.();
              onOpenProfile(member);
            }}
            style={{ cursor: "pointer" }}
          >
            {online ? <OnlinePresenceDot /> : <Text fg={colors.textDim} onMouseDown={(event: any) => {
              event?.preventDefault?.();
              event?.stopPropagation?.();
              onOpenProfile(member);
            }}> </Text>}
            <Text
              fg={online ? colors.positive : colors.textDim}
              attributes={TextAttributes.BOLD}
              onMouseDown={(event: any) => {
                event?.preventDefault?.();
                event?.stopPropagation?.();
                onOpenProfile(member);
              }}
            >
              {truncateChannelLabel(label, Math.max(1, chipWidth - (online ? 1 : 0)))}
            </Text>
          </Box>
        );
      })}
      {extra > 0 ? <Text fg={colors.textMuted}>{` +${extra}`}</Text> : null}
    </Box>
  );
}
