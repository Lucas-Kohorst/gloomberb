import { Box, Text, useUiCapabilities } from "../../../../ui";
import type { ChatUserSummary } from "../../../../api-client";
import { OnlinePresenceDot } from "../presence-dot";

export function ChatUserHitTarget({
  user,
  label,
  color,
  attributes,
  online = false,
  onHover,
  onHoverEnd,
  onActivate,
}: {
  user: ChatUserSummary;
  label: string;
  color: string;
  attributes?: number;
  online?: boolean;
  onHover: (user: ChatUserSummary) => void;
  onHoverEnd: () => void;
  onActivate: (user: ChatUserSummary) => void;
}) {
  const { nativePaneChrome } = useUiCapabilities();
  const activate = (event?: { preventDefault?: () => void; stopPropagation?: () => void }) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    onActivate(user);
  };

  return (
    <Box
      height={1}
      flexDirection="row"
      flexShrink={0}
      data-gloom-role="chat-user"
      onMouseOver={() => onHover(user)}
      onMouseMove={() => onHover(user)}
      onMouseOut={onHoverEnd}
      onMouseDown={activate}
      style={{ cursor: "pointer", minWidth: nativePaneChrome ? 48 : undefined }}
    >
      {online ? <OnlinePresenceDot onMouseDown={activate} /> : null}
      <Text fg={color} attributes={attributes}>
        {label}
      </Text>
    </Box>
  );
}
