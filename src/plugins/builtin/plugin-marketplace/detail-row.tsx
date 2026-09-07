import { useThemeColors } from "../../../theme/theme-context";
import { Box, Text } from "../../../ui";

/**
 * Label/value pair used by both the terminal detail view (pane.tsx) and the
 * desktop-web gallery preview. Shared so the two views cannot drift apart.
 */
export function DetailRow({ label, value }: { label: string; value: string }) {
  const colors = useThemeColors();
  return (
    <Box flexDirection="row" gap={1} minWidth={0} alignItems="flex-start">
      <Text fg={colors.textDim}>{`${label}:`}</Text>
      <Text
        fg={colors.text}
        wrapText
        style={{ minWidth: 0, flexGrow: 1, flexShrink: 1 }}
      >
        {value}
      </Text>
    </Box>
  );
}
