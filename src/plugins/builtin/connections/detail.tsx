import { Box, Text, TextAttributes } from "../../../ui";
import { colors } from "../../../theme/colors";
import { formatRelativeAge } from "../../../utils/relative-time";
import { t } from "../../../i18n";
import type { ConnectionState } from "./types";
import { statusColor, statusGlyph, statusLabel, kindLabel, formatLatency } from "./table";

function DetailRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <Box flexDirection="row" height={1}>
      <Box width={18}>
        <Text fg={colors.textDim}>{label}</Text>
      </Box>
      <Text fg={valueColor ?? colors.text}>{value}</Text>
    </Box>
  );
}

function RequestHistoryRow({ index, timestamp, durationMs, success, operation, error }: {
  index: number;
  timestamp: number;
  durationMs: number;
  success: boolean;
  operation?: string;
  error?: string;
}) {
  const age = formatRelativeAge(timestamp);
  const status = success ? "ok" : "fail";
  const color = success ? colors.positive : colors.negative;
  const detail = error ? truncate(error, 40) : (operation ?? "");
  return (
    <Box flexDirection="row" height={1}>
      <Box width={3}>
        <Text fg={colors.textMuted}>{String(index + 1).padStart(2, " ")}</Text>
      </Box>
      <Box width={8}>
        <Text fg={color}>{status}</Text>
      </Box>
      <Box width={8}>
        <Text fg={colors.textDim}>{formatLatency(durationMs)}</Text>
      </Box>
      <Box width={10}>
        <Text fg={colors.textMuted}>{age}</Text>
      </Box>
      <Text fg={colors.textDim}>{detail}</Text>
    </Box>
  );
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

export function ConnectionDetailContent({ row, width }: { row: ConnectionState | null; width: number }) {
  if (!row) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text fg={colors.textDim}>{t("Select a connection to view details.")}</Text>
      </Box>
    );
  }

  const totalRequests = row.successCount + row.failureCount;
  const successRate = totalRequests > 0 ? Math.round((row.successCount / totalRequests) * 100) : null;
  const errorCount = row.failureCount;

  return (
    <Box flexDirection="column" paddingX={1} width={width}>
      <Box height={1} flexDirection="row">
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>{row.name}</Text>
        <Text fg={statusColor(row.status)}> {statusGlyph(row.status)} {statusLabel(row.status)}</Text>
      </Box>
      <Box height={1} />

      <DetailRow label={t("Type")} value={kindLabel(row.kind)} valueColor={colors.textDim} />
      <DetailRow label={t("Plugin")} value={row.pluginId} valueColor={colors.textDim} />
      <DetailRow label={t("Priority")} value={String(row.priority)} valueColor={colors.textDim} />
      {row.isWebSocket && (
        <DetailRow label={t("WS State")} value={row.wsState} valueColor={statusColor(row.status)} />
      )}
      {row.isWebSocket && row.lastMessageAt && (
        <DetailRow label={t("Last Msg")} value={formatRelativeAge(row.lastMessageAt)} valueColor={colors.textMuted} />
      )}
      <DetailRow label={t("Last Poll")} value={row.lastPolledAt ? formatRelativeAge(row.lastPolledAt) : t("never")} valueColor={colors.textMuted} />
      <DetailRow label={t("Latency")} value={formatLatency(row.lastLatencyMs)} valueColor={colors.textMuted} />
      <DetailRow label={t("Requests")} value={`${row.successCount} ok / ${errorCount} fail${successRate != null ? ` (${successRate}%)` : ""}`} valueColor={colors.textMuted} />

      {row.lastError && (
        <>
          <Box height={1} />
          <Box height={1}>
            <Text fg={colors.negative} attributes={TextAttributes.BOLD}>{t("Last Error")}</Text>
          </Box>
          <Box height={1}>
            <Text fg={colors.negative}>{truncate(row.lastError, width - 2)}</Text>
          </Box>
        </>
      )}

      {row.recentRequests.length > 0 && (
        <>
          <Box height={1} />
          <Box height={1}>
            <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>{t("Recent Requests")}</Text>
          </Box>
          <Box height={1} flexDirection="row">
            <Box width={3}><Text fg={colors.textDim}>#</Text></Box>
            <Box width={8}><Text fg={colors.textDim}>Result</Text></Box>
            <Box width={8}><Text fg={colors.textDim}>Time</Text></Box>
            <Box width={10}><Text fg={colors.textDim}>Age</Text></Box>
            <Text fg={colors.textDim}>Operation</Text>
          </Box>
          {row.recentRequests.slice(0, 12).map((req, index) => (
            <RequestHistoryRow
              key={index}
              index={index}
              timestamp={req.timestamp}
              durationMs={req.durationMs}
              success={req.success}
              operation={req.operation}
              error={req.error}
            />
          ))}
        </>
      )}
    </Box>
  );
}
