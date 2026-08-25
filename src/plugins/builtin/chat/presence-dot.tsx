import { Box, Span, Text, useUiCapabilities } from "../../../ui";
import { colors } from "../../../theme/colors";

const PRESENCE_SLOT_STYLE = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "1ch",
  minWidth: 8,
  height: "1em",
  flexShrink: 0,
} as const;

export function OnlinePresenceDot({
  onMouseDown,
}: {
  onMouseDown?: (event: any) => void;
}) {
  const { nativePaneChrome } = useUiCapabilities();
  if (!nativePaneChrome) {
    return (
      <Text fg={colors.positive} selectable={false} onMouseDown={onMouseDown}>●</Text>
    );
  }

  return (
    <Span
      fg={colors.positive}
      onMouseDown={onMouseDown}
      aria-label="Online"
      data-gloom-role="chat-presence-dot"
      style={PRESENCE_SLOT_STYLE}
    >
      <Box
        style={{
          width: "0.5em",
          height: "0.5em",
          minWidth: 6,
          minHeight: 6,
          borderRadius: 999,
          backgroundColor: colors.positive,
        }}
      />
    </Span>
  );
}

export function PresenceSlot({
  online,
  onMouseDown,
}: {
  online: boolean;
  onMouseDown?: (event: any) => void;
}) {
  const { nativePaneChrome } = useUiCapabilities();
  if (online) return <OnlinePresenceDot onMouseDown={onMouseDown} />;
  if (!nativePaneChrome) {
    return (
      <Text selectable={false} onMouseDown={onMouseDown}> </Text>
    );
  }

  return (
    <Span
      aria-hidden
      onMouseDown={onMouseDown}
      data-gloom-role="chat-presence-slot"
      style={PRESENCE_SLOT_STYLE}
    />
  );
}

export function ChatTitlePresenceDot() {
  const { nativePaneChrome } = useUiCapabilities();
  return (
    <>
      {!nativePaneChrome ? <Text selectable={false}> </Text> : null}
      <Box
        data-gloom-role="pane-title-presence"
        flexShrink={0}
        style={nativePaneChrome ? { marginLeft: 6 } : undefined}
      >
        <OnlinePresenceDot />
      </Box>
    </>
  );
}
