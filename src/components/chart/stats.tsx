import { StyledText, Text } from "../../ui";
import { colors } from "../../theme/colors";
import { displayWidth } from "../../utils/format";

export function ChartStats({ items, width }: {
  items: readonly { label: string; value: string; color?: string }[];
  width: number;
}) {
  const lineWidth = Math.max(1, width);
  const chunks: StyledText["chunks"] = [];
  let used = 0;
  for (const item of items) {
    const label = item.label ? `${item.label} ` : "";
    const cells = displayWidth(label) + displayWidth(item.value);
    if (chunks.length > 0) {
      const nextLine = used + 2 + cells > lineWidth;
      chunks.push({ text: nextLine ? "\n" : "  " });
      used = nextLine ? 0 : used + 2;
    }
    chunks.push({ text: label, fg: colors.textDim });
    chunks.push({ text: item.value, fg: item.color ?? colors.text });
    used += cells;
  }
  return <Text width={lineWidth} wrapText wrapMode="word" content={new StyledText(chunks)} />;
}
