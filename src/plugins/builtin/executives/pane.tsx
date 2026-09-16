import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CloudExecutiveRowPayload,
  CloudProxyStatementPayload,
  CloudProxyStatementSummaryPayload,
} from "../../../api-client";
import {
  EmptyState,
  PaneStatusBody,
  Spinner,
  Tabs,
  useExternalLinkFooter,
  type PaneFooterSegment,
} from "../../../components";
import { useShortcut } from "../../../react/input";
import { colors, getChartIndicatorColor } from "../../../theme/colors";
import {
  Box,
  ScrollBox,
  Text,
  TextAttributes,
  useUiCapabilities,
  type ScrollBoxRenderable,
} from "../../../ui";
import { isPlainKey } from "../../../utils/keyboard";
import { useBoundTicker } from "../shared/ticker-request";
import { isMissingProxy, loadProxyStatement, loadProxyStatements } from "./data";
import {
  equityShare,
  formatChange,
  formatFiled,
  formatPay,
  formatRatio,
  shortTitle,
} from "./format";

export const EXECUTIVES_PANE_ID = "executives";

const MAX_PROSE_WIDTH = 100;

function SectionHeading({ title }: { title: string }) {
  return (
    <Box height={1} marginTop={1}>
      <Text attributes={TextAttributes.BOLD} fg={colors.textDim}>{title}</Text>
    </Box>
  );
}

/** A figure and what it is, value first so the column of numbers is what the eye reads. */
function FigureLine({
  value,
  label,
  note,
  width,
  valueWidth,
}: {
  value: string;
  label: string;
  note?: string;
  width: number;
  valueWidth: number;
}) {
  const prefix = `${value.padEnd(valueWidth)}  `;
  const rest = [label, note].filter(Boolean).join(", ");
  const clipped = rest.length > Math.max(1, width - prefix.length)
    ? `${rest.slice(0, Math.max(1, width - prefix.length - 1)).trimEnd()}…`
    : rest;
  return (
    <Box height={1} flexDirection="row">
      <Text fg={colors.textBright}>{prefix}</Text>
      <Text fg={colors.textDim}>{clipped}</Text>
    </Box>
  );
}

const PAY_PARTS: Array<{ key: keyof CloudExecutiveRowPayload; label: string }> = [
  { key: "salary", label: "Salary" },
  { key: "bonus", label: "Bonus" },
  { key: "stockAwards", label: "Stock" },
  { key: "optionAwards", label: "Options" },
  { key: "nonEquityIncentive", label: "Incentive" },
  { key: "pensionAndDeferred", label: "Pension" },
  { key: "allOther", label: "Other" },
];

/**
 * How the chief executive's pay was made up, as one bar of blocks. Salary
 * is usually a sliver and equity most of it; seeing that beats the table.
 * Terminal uses block characters; desktop/web uses a real bar.
 */
function PayMixBar({
  row,
  width,
  native,
}: {
  row: CloudExecutiveRowPayload;
  width: number;
  native: boolean;
}) {
  const parts = PAY_PARTS.map((part, index) => ({
    ...part,
    value: (row[part.key] as number | null) ?? 0,
    color: getChartIndicatorColor(index),
  })).filter((part) => part.value > 0);
  const sum = parts.reduce((total, part) => total + part.value, 0);
  if (sum <= 0) return null;
  const barWidth = Math.max(10, Math.min(width, 60));
  let cells = parts.map((part) => Math.max(1, Math.round((part.value / sum) * barWidth)));
  while (cells.reduce((a, b) => a + b, 0) > barWidth) {
    const largest = cells.indexOf(Math.max(...cells));
    cells[largest] = cells[largest]! - 1;
  }
  cells = cells.map((count) => Math.max(1, count));
  return (
    <Box flexDirection="column">
      {native ? (
        <Box
          height={1}
          flexDirection="row"
          style={{
            display: "flex",
            height: 8,
            borderRadius: 2,
            overflow: "hidden",
            width: "100%",
            maxWidth: 360,
          }}
        >
          {parts.map((part) => (
            <Box
              key={part.key}
              style={{
                flexGrow: part.value,
                flexBasis: 0,
                backgroundColor: part.color,
                minWidth: 2,
              }}
            />
          ))}
        </Box>
      ) : (
        <Box height={1} flexDirection="row">
          {parts.map((part, index) => (
            <Text key={part.key} fg={part.color}>
              {"█".repeat(cells[index]!)}
            </Text>
          ))}
        </Box>
      )}
      <Box flexDirection="row" flexWrap="wrap">
        {parts.map((part) => (
          <Box key={part.key} flexDirection="row" marginRight={2}>
            <Text fg={part.color}>■ </Text>
            <Text fg={colors.textDim}>{part.label} </Text>
            <Text fg={colors.text}>{Math.round((part.value / sum) * 100)}%</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function ExecutiveRows({
  rows,
  width,
}: {
  rows: CloudExecutiveRowPayload[];
  width: number;
}) {
  if (width < 52) {
    return (
      <Box flexDirection="column">
        {rows.map((row) => (
          <Box key={`${row.name}-${row.total}`} flexDirection="column">
            <Box height={1} flexDirection="row">
              <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
                {formatPay(row.total)}{" "}
              </Text>
              <Text fg={colors.textBright}>{row.name}</Text>
            </Box>
            <Box height={1}>
              <Text fg={colors.textDim}>
                {[row.title, equityShare(row) ? `${equityShare(row)} equity` : null].filter(Boolean).join(" · ")}
              </Text>
            </Box>
          </Box>
        ))}
      </Box>
    );
  }
  const totalWidth = 9;
  const equityWidth = 5;
  const nameWidth = Math.min(24, Math.max(10, ...rows.map((row) => row.name.length)));
  const titleWidth = Math.max(8, width - nameWidth - equityWidth - totalWidth - 6);
  return (
    <Box flexDirection="column">
      <Box height={1} flexDirection="row">
        <Text fg={colors.textDim}>
          {"NAME".padEnd(nameWidth)} {"TITLE".padEnd(titleWidth)}{" "}
          {"EQ%".padStart(equityWidth)} {"TOTAL".padStart(totalWidth)}
        </Text>
      </Box>
      {rows.map((row) => (
        <Box key={`${row.name}-${row.total}`} height={1} flexDirection="row">
          <Text fg={colors.textBright}>
            {shortTitle(row.name, nameWidth).padEnd(nameWidth)}
          </Text>
          <Text fg={colors.textDim}>
            {" "}
            {shortTitle(row.title, titleWidth).padEnd(titleWidth)}{" "}
          </Text>
          <Text fg={colors.textDim}>
            {equityShare(row).padStart(equityWidth)}{" "}
          </Text>
          <Text fg={colors.text} attributes={TextAttributes.BOLD}>
            {formatPay(row.total).padStart(totalWidth)}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

function figuresOf(statement: CloudProxyStatementPayload) {
  const figures: Array<{ value: string; label: string; note?: string }> = [];
  const ceo = statement.ceo;
  if (ceo?.total != null && Number.isFinite(ceo.total)) {
    const change = formatChange(ceo.total, ceo.priorYearTotal);
    figures.push({
      value: formatPay(ceo.total),
      label: `${ceo.name} total pay`,
      note: change ? `${change} vs prior year` : (statement.fiscalYearLabel ?? undefined),
    });
  }
  if (statement.payRatio !== null) {
    figures.push({
      value: formatRatio(statement.payRatio),
      label: "CEO to median employee",
      note: statement.medianEmployeePay
        ? `median ${formatPay(statement.medianEmployeePay)}`
        : undefined,
    });
  }
  if (ceo) {
    const share = equityShare(ceo);
    if (share) figures.push({ value: share, label: "CEO pay in equity" });
  }
  if (statement.sayOnPayPriorSupport !== null) {
    figures.push({
      value: `${Math.round(statement.sayOnPayPriorSupport)}%`,
      label: "prior say-on-pay support",
    });
  }
  const seen = new Set(figures.map((figure) => figure.label.toLowerCase()));
  for (const figure of statement.keyFigures ?? []) {
    if (figures.length >= 8) break;
    if (seen.has(figure.label.toLowerCase())) continue;
    figures.push({
      value: figure.value,
      label: figure.label,
      note: figure.note || undefined,
    });
  }
  return figures;
}

export function ExecutivesPane({
  focused,
  width,
}: {
  focused: boolean;
  width: number;
  height: number;
}) {
  const { symbol } = useBoundTicker();
  const ticker = symbol ? symbol.toUpperCase() : null;
  const nativePaneChrome = useUiCapabilities().nativePaneChrome === true;

  const [years, setYears] = useState<CloudProxyStatementSummaryPayload[]>([]);
  const [year, setYear] = useState<number | null>(null);
  const [statement, setStatement] = useState<CloudProxyStatementPayload | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "loaded" | "none" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);

  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;
    setStatus("loading");
    setStatement(null);
    setError(null);
    loadProxyStatements(ticker)
      .then((payload) => {
        if (cancelled) return;
        setYears(payload.proxies);
        setYear(payload.proxies[0]?.proxyYear ?? null);
        setStatus(payload.proxies.length > 0 ? "loaded" : "none");
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        if (isMissingProxy(caught)) {
          setYears([]);
          setStatus("none");
          return;
        }
        setError(caught instanceof Error ? caught.message : String(caught));
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  useEffect(() => {
    if (!ticker || year === null) return;
    let cancelled = false;
    loadProxyStatement(ticker, year)
      .then((payload) => {
        if (!cancelled) setStatement(payload);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [ticker, year]);

  useEffect(() => {
    const scrollBox = scrollRef.current;
    if (scrollBox) scrollBox.scrollTop = 0;
  }, [year]);

  const scrollBy = useCallback((delta: number) => {
    const scrollBox = scrollRef.current;
    if (!scrollBox?.viewport) return;
    const max = Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height);
    scrollBox.scrollTop = Math.max(0, Math.min(max, scrollBox.scrollTop + delta));
  }, []);

  useShortcut((event) => {
    if (isPlainKey(event, "j", "down")) scrollBy(1);
    else if (isPlainKey(event, "k", "up")) scrollBy(-1);
  }, { enabled: focused });

  const footerInfo = useMemo((): PaneFooterSegment[] => {
    const info: PaneFooterSegment[] = [];
    if (status === "loading") {
      info.push({ id: "loading", parts: [{ text: "loading", tone: "muted" }] });
    }
    if (statement) {
      info.push({
        id: "filed",
        parts: [{ text: `filed ${formatFiled(statement.filedAt)}`, tone: "muted" }],
      });
    }
    return info;
  }, [status, statement]);

  useExternalLinkFooter({
    registrationId: EXECUTIVES_PANE_ID,
    focused,
    url: statement?.docUrl,
    source: statement ? "DEF 14A" : null,
    info: footerInfo,
    label: "filing",
  });

  const figures = useMemo(() => (statement ? figuresOf(statement) : []), [statement]);
  const bodyWidth = Math.max(12, width - 2);
  const proseWidth = Math.min(bodyWidth, MAX_PROSE_WIDTH);
  const valueWidth = Math.min(14, Math.max(4, ...figures.map((figure) => figure.value.length)));

  if (!ticker) return <EmptyState title="Pick a ticker to see its executives." />;
  if (status === "loading" && !statement) {
    return <PaneStatusBody loading subject="proxy statement" />;
  }
  if (status === "none") {
    return (
      <EmptyState
        title={`No proxy statement on file for ${ticker}.`}
        message="Executive pay comes from the annual DEF 14A. Funds, SPACs and foreign filers do not file one with a compensation table."
      />
    );
  }
  if (status === "error") {
    return <PaneStatusBody error={error ?? "Could not load executive compensation."} subject="executive compensation" />;
  }

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      flexShrink={1}
      flexBasis={0}
      minHeight={0}
      overflow="hidden"
    >
      {years.length > 1 && (
        <Box height={1} flexShrink={0} paddingX={1} overflow="hidden">
          <Tabs
            tabs={years.map((entry) => ({
              label: `${entry.proxyYear} proxy`,
              value: String(entry.proxyYear),
            }))}
            activeValue={year === null ? "" : String(year)}
            onSelect={(value) => setYear(Number(value))}
            compact
            variant="bare"
            focused={focused}
          />
        </Box>
      )}
      <ScrollBox
        ref={scrollRef}
        flexGrow={1}
        flexShrink={1}
        flexBasis={0}
        minHeight={0}
        paddingX={1}
      >
        {statement ? (
          <Box flexDirection="column" width={nativePaneChrome ? "100%" : bodyWidth}>
            <Box height={1}>
              <Text fg={colors.textDim}>
                {[
                  `${statement.proxyYear} proxy statement`,
                  statement.fiscalYearLabel
                    ? `pay for ${statement.fiscalYearLabel.replace(/^Fiscal/, "fiscal")}`
                    : null,
                  statement.meetingDate
                    ? `meeting ${formatFiled(statement.meetingDate)}`
                    : null,
                ].filter(Boolean).join("  ·  ")}
              </Text>
            </Box>
            {figures.length > 0 && (
              <Box flexDirection="column">
                <SectionHeading title="KEY FIGURES" />
                {figures.map((figure) => (
                  <FigureLine
                    key={`${figure.label}-${figure.value}`}
                    value={figure.value}
                    label={figure.label}
                    note={figure.note}
                    width={proseWidth}
                    valueWidth={valueWidth}
                  />
                ))}
              </Box>
            )}
            {statement.ceo && (
              <Box flexDirection="column">
                <SectionHeading
                  title={`HOW ${statement.ceo.name.split(" ").pop()?.toUpperCase() ?? "THE CEO"} WAS PAID`}
                />
                <PayMixBar row={statement.ceo} width={proseWidth} native={nativePaneChrome} />
              </Box>
            )}
            {statement.namedExecutives.length > 0 && (
              <Box flexDirection="column">
                <SectionHeading title="NAMED EXECUTIVE OFFICERS" />
                <ExecutiveRows rows={statement.namedExecutives} width={proseWidth} />
              </Box>
            )}
            {statement.highlights && (
              <Box flexDirection="column">
                <SectionHeading title="WHAT CHANGED" />
                {statement.highlights.split("\n").map((point) => (
                  <Box key={point} height={1}>
                    <Text fg={colors.text}>{`• ${point}`}</Text>
                  </Box>
                ))}
              </Box>
            )}
            <Box height={1} marginTop={1}>
              <Text fg={colors.textDim}>
                Read from the DEF 14A and checked against the filing. Equity valued at grant.
              </Text>
            </Box>
          </Box>
        ) : (
          <Spinner label="Loading..." />
        )}
      </ScrollBox>
    </Box>
  );
}
