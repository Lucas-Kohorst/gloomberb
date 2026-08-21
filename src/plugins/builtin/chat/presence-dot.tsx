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
