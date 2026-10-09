import { Box, Text, useUiCapabilities } from "../../../ui";
import { colors } from "../../../theme/colors";
import { t } from "../../../i18n";
import type { ListViewItem } from "../../ui";
import { Spinner } from "../../ui/loading";
import { loadingText, unavailableText } from "../../ui/status";
import { getBrokerLabel } from "./utils";

export function BrokerSyncPanel({
  choices,
  selectedBrokerId,
  brokerSyncing,
  brokerSyncError,
}: {
  choices: ListViewItem[];
  selectedBrokerId: string;
  brokerSyncing: boolean;
  brokerSyncError: string | null;
}) {
  const brokerLabel = getBrokerLabel(choices, selectedBrokerId);
  const desktop = useUiCapabilities().nativePaneChrome === true;

  return (
    <Box flexDirection="column" paddingX={desktop ? 0 : 2} style={desktop ? { marginTop: 14 } : undefined}>
      <Box height={desktop ? 1 : 2} overflow="hidden">
        {brokerSyncing ? <Spinner label={loadingText()} /> : (
          <Text fg={colors.negative} wrapText={!desktop}>
            {brokerSyncError || unavailableText(brokerLabel.trim() || "Broker")}
          </Text>
        )}
      </Box>
      <Box height={1} />
      <Box height={desktop ? 1 : 2} overflow="hidden">
        <Text fg={colors.textDim} wrapText={!desktop}>
          {brokerSyncing
            ? t("This happens now so your portfolio is ready before onboarding finishes.")
            : t("Press Enter to retry, or Backspace to edit the broker settings.")}
        </Text>
      </Box>
    </Box>
  );
}
