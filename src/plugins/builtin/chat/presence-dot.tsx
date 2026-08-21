import { Box, Span, Text, useUiCapabilities } from "../../../ui";
import { colors } from "../../../theme/colors";

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
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 8,
        height: 16,
        flexShrink: 0,
      }}
    >
      <Box
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          backgroundColor: colors.positive,
        }}
      />
    </Span>
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
