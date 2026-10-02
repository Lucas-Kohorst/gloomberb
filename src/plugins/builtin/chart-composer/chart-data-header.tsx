import { Box, Text } from "../../../ui";
import { colors } from "../../../theme/colors";

/** Our quote, studies, and (on the embed) price levels. One row, clipped. */
export function ChartDataHeader({ text, width }: { text: string; width: number }) {
  if (!text) return null;
  return (
    <Box
      height={1}
      width={width}
      paddingX={1}
      overflow="hidden"
      flexShrink={0}
      data-gloom-role="chart-data-header"
    >
      <Text fg={colors.text}>{text}</Text>
    </Box>
  );
}
