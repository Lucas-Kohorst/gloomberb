import { Box } from "../../../ui";
import { colors } from "../../../theme/colors";
import { ExternalLinkText } from "../../../components/ui/external-link";
import type {
  PredictionListRow,
  PredictionMarketDetail,
  PredictionMarketSummary,
} from "../types";

export function truncatePredictionText(
  value: string | null | undefined,
  maxLength: number,
): string {
  const text = value ?? "";
  if (text.length <= maxLength) return text;
  if (maxLength <= 3) return text.slice(0, maxLength);
  return `${text.slice(0, maxLength - 3)}...`;
}

export function resolvePredictionDetailTitle({
  detail,
  selectedRow,
  selectedSummary,
}: {
  detail: PredictionMarketDetail | null;
  selectedRow: PredictionListRow | null;
  selectedSummary: PredictionMarketSummary | null;
}): string | undefined {
  if (!selectedSummary) return undefined;
  const summary = detail?.summary ?? selectedSummary;
  return selectedRow?.kind === "group" ? selectedRow.title : summary.title;
}

export function SummaryLink({
  url,
  maxLength,
}: {
  url: string | null | undefined;
  maxLength: number;
}) {
  const safeUrl = url ?? "";
  return (
    <Box height={1}>
      <ExternalLinkText
        url={safeUrl}
        label={truncatePredictionText(safeUrl, maxLength)}
        color={colors.textBright}
      />
    </Box>
  );
}
