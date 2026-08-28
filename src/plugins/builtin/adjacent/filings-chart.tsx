import { useMemo, useState } from "react";
import { Box, Text, useUiHost } from "../../../ui";
import { colors } from "../../../theme/colors";
import { CFTC_CHART_OTHER_ORG, formatCftcChartMonth, type CftcStackedBarChart } from "./filings-rollup";

const ORG_PALETTE = [
  colors.positive,
  colors.warning,
  colors.selected,
  colors.borderFocused,
  colors.negative,
  colors.header,
  colors.textBright,
  colors.neutral,
];

function orgColor(org: string, index: number): string {
  if (org === CFTC_CHART_OTHER_ORG) return colors.textMuted;
  return ORG_PALETTE[index % ORG_PALETTE.length]!;
}

export function CftcStackedBarChartView({
  chart,
  width,
  height,
}: {
  chart: CftcStackedBarChart;
  width: number;
  height: number;
}) {
  const isDesktop = useUiHost().kind === "desktop-web";
  if (chart.months.length === 0) {
    return (
      <Box flexGrow={1} justifyContent="center" alignItems="center">
        <Text fg={colors.textDim}>No DCM product filings in this window.</Text>
      </Box>
    );
  }
  return isDesktop
    ? <DesktopStackedBars chart={chart} width={width} height={height} />
    : <TerminalStackedBars chart={chart} width={width} />;
}

function DesktopStackedBars({
  chart,
  width,
  height,
}: {
  chart: CftcStackedBarChart;
  width: number;
  height: number;
}) {
  const [hover, setHover] = useState<{ org: string; month: string; count: number } | null>(null);
  const maxTotal = Math.max(1, ...chart.totals);
  const plotHeight = Math.max(80, height * 8);
  const plotWidth = Math.max(160, width * 8);
  const pad = { top: 28, right: 16, bottom: 36, left: 36 };
  const innerWidth = Math.max(1, plotWidth - pad.left - pad.right);
  const innerHeight = Math.max(1, plotHeight - pad.top - pad.bottom);
  const gap = 6;
  const barWidth = Math.max(8, (innerWidth - gap * Math.max(0, chart.months.length - 1)) / chart.months.length);

  const bars = useMemo(() => {
    return chart.months.map((month, monthIndex) => {
      let y = pad.top + innerHeight;
      const stacks = chart.orgs.map((org, orgIndex) => {
        const count = chart.counts[org]?.[monthIndex] ?? 0;
        const sliceHeight = (count / maxTotal) * innerHeight;
        y -= sliceHeight;
        return { org, count, y, height: sliceHeight, color: orgColor(org, orgIndex) };
      });
      return {
        month,
        x: pad.left + monthIndex * (barWidth + gap),
        total: chart.totals[monthIndex] ?? 0,
        stacks,
      };
    });
  }, [barWidth, chart, innerHeight, maxTotal, pad.left, pad.top]);

  return (
    <Box flexGrow={1} flexDirection="column" minHeight={0}>
      <Box paddingX={1} height={1}>
        <Text fg={colors.textBright}>{chart.title}</Text>
        {hover ? (
          <Text fg={colors.textDim}>{`  ${hover.org} · ${hover.month} · ${hover.count}`}</Text>
        ) : null}
      </Box>
      <Box flexDirection="row" height={1} paddingX={1} gap={1} overflow="hidden">
        {chart.orgs.map((org, index) => (
          <Text key={org} fg={orgColor(org, index)}>{org}</Text>
        ))}
      </Box>
      <Box flexGrow={1} minHeight={0}>
        <svg
          viewBox={`0 0 ${plotWidth} ${plotHeight}`}
          width="100%"
          height="100%"
          role="img"
          aria-label={chart.title}
        >
          {bars.map((bar) => (
            <g key={bar.month}>
              {bar.stacks.map((stack) => (
                stack.height <= 0 ? null : (
                  <rect
                    key={stack.org}
                    x={bar.x}
                    y={stack.y}
                    width={barWidth}
                    height={stack.height}
                    fill={stack.color}
                    onMouseEnter={() => setHover({ org: stack.org, month: bar.month, count: stack.count })}
                    onMouseLeave={() => setHover(null)}
                  />
                )
              ))}
              <text
                x={bar.x + barWidth / 2}
                y={plotHeight - 12}
                textAnchor="middle"
                fill={colors.textDim}
                fontSize="11"
              >
                {formatCftcChartMonth(bar.month)}
              </text>
              {bar.total > 0 && bar.month === chart.months[chart.months.length - 1] ? (
                <text
                  x={bar.x + barWidth / 2}
                  y={pad.top - 8}
                  textAnchor="middle"
                  fill={colors.text}
                  fontSize="12"
                >
                  {bar.total}
                </text>
              ) : null}
            </g>
          ))}
        </svg>
      </Box>
    </Box>
  );
}

function TerminalStackedBars({
  chart,
  width,
}: {
  chart: CftcStackedBarChart;
  width: number;
}) {
  const maxTotal = Math.max(1, ...chart.totals);
  const labelWidth = 8;
  const countWidth = 5;
  const barWidth = Math.max(8, width - labelWidth - countWidth - 3);
  return (
    <Box flexGrow={1} flexDirection="column" paddingX={1} overflow="hidden">
      <Text fg={colors.textBright}>{chart.title}</Text>
      <Box flexDirection="row" height={1} gap={1} overflow="hidden">
        {chart.orgs.map((org, index) => (
          <Text key={org} fg={orgColor(org, index)}>{org}</Text>
        ))}
      </Box>
      {chart.months.map((month, monthIndex) => {
        const total = chart.totals[monthIndex] ?? 0;
        return (
          <Box key={month} flexDirection="row" height={1}>
            <Box width={labelWidth}>
              <Text fg={colors.textDim}>{formatCftcChartMonth(month).padEnd(labelWidth)}</Text>
            </Box>
            <Box flexDirection="row" width={barWidth} height={1}>
              {chart.orgs.map((org, orgIndex) => {
                const count = chart.counts[org]?.[monthIndex] ?? 0;
                const slice = Math.round((count / maxTotal) * barWidth);
                if (slice <= 0) return null;
                return (
                  <Box
                    key={org}
                    width={slice}
                    height={1}
                    backgroundColor={orgColor(org, orgIndex)}
                  />
                );
              })}
            </Box>
            <Text fg={colors.text}>{String(total).padStart(countWidth)}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
