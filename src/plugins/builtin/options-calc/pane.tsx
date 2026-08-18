import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, Text, TextAttributes, type InputRenderable } from "../../../ui";
import { useShortcut } from "../../../react/input";
import { colors } from "../../../theme/colors";
import { NumberField, SegmentedControl, usePaneFooter } from "../../../components";
import type { PaneProps } from "../../../types/plugin";
import { usePaneStateValue, usePaneTicker } from "../../../state/app/context";
import { formatNumber } from "../../../utils/format";
import {
  blackScholes,
  impliedVolatility,
  type BSInputs,
} from "./blackscholes";

export const OPTIONS_CALC_PANE_ID = "options-calc";
const DEFAULT_FLOATING_SIZE = { width: 70, height: 20 };
const DAYS_PER_YEAR = 365;

export { DEFAULT_FLOATING_SIZE };

type OptionType = "call" | "put";

interface CalcInputs {
  spot: number;
  strike: number;
  daysToExpiry: number;
  riskFreeRate: number; // percent (5 = 5%)
  volatility: number; // percent (20 = 20%)
  dividendYield: number; // percent (0 = 0%)
  marketPrice: number | null; // optional, for IV solving
  type: OptionType;
}

const DEFAULT_INPUTS: CalcInputs = {
  spot: 100,
  strike: 100,
  daysToExpiry: 365,
  riskFreeRate: 5,
  volatility: 20,
  dividendYield: 0,
  marketPrice: null,
  type: "call",
};

interface FieldDef {
  id: string;
  label: string;
  value: number;
  percent?: boolean;
  allowNegative?: boolean;
  onValue: (value: number) => void;
  onClear?: () => void;
}

function truncateText(value: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (value.length <= maxWidth) return value;
  if (maxWidth <= 1) return value.slice(0, maxWidth);
  return `${value.slice(0, maxWidth - 1)}…`;
}

function formatInputNumber(value: number, percent = false): string {
  const scaled = percent ? value * 100 : value;
  const decimals = percent
    ? Math.abs(scaled) >= 10 ? 1 : 2
    : Math.abs(scaled) >= 100 ? 0 : 2;
  return formatNumber(scaled, decimals).replace(/,/g, "");
}

function parsePromptNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function InlineField({
  field,
  active,
  width,
  focused,
  onFocus,
}: {
  field: FieldDef;
  active: boolean;
  width: number;
  focused: boolean;
  onFocus: () => void;
}) {
  const labelWidth = Math.min(12, Math.max(7, Math.floor(width * 0.38)));
  const suffixWidth = field.percent ? 2 : 0;
  const valueWidth = Math.max(5, width - labelWidth - suffixWidth - 2);
  const inputNodeRef = useRef<InputRenderable | null>(null);
  const displayValue = formatInputNumber(field.value, field.percent);
  const fieldRef = useRef(field);
  const displayValueRef = useRef(displayValue);
  const [text, setText] = useState(displayValue);
  const latestTextRef = useRef(displayValue);
  const committedTextRef = useRef(displayValue);
  const wasActiveRef = useRef(active);
  const dirtyRef = useRef(false);
  fieldRef.current = field;
  displayValueRef.current = displayValue;

  const focusInput = useCallback(() => {
    const input = inputNodeRef.current;
    try {
      input?.focus?.();
      input?.setCursorOffset?.(0);
    } catch {
      // Renderer teardown can race queued focus attempts.
    }
  }, []);

  const commitText = useCallback((nextText: string): string | null => {
    const currentField = fieldRef.current;
    if (nextText.trim() === "") {
      currentField.onClear?.();
      return null;
    }
    const parsed = parsePromptNumber(nextText);
    if (parsed == null) return null;
    const nextValue = currentField.percent ? parsed / 100 : parsed;
    currentField.onValue?.(nextValue);
    return formatInputNumber(nextValue, currentField.percent);
  }, []);

  const commitEditText = useCallback((nextText: string, fallbackText = displayValue) => {
    latestTextRef.current = nextText;
    const committedText = commitText(nextText);
    committedTextRef.current = committedText ?? fallbackText;
    setText(committedTextRef.current);
    dirtyRef.current = false;
  }, [commitText, displayValue]);

  const getLiveInputText = useCallback(() => {
    const input = inputNodeRef.current;
    if (!input) return latestTextRef.current;
    try {
      return input.editBuffer.getText();
    } catch {
      return latestTextRef.current;
    }
  }, []);

  const commitLiveInputText = useCallback(() => {
    const liveText = getLiveInputText();
    const nextText = typeof liveText === "string" ? liveText : latestTextRef.current;
    if (!dirtyRef.current && (nextText.trim() === "" || nextText === committedTextRef.current)) return;
    latestTextRef.current = nextText;
    const committedText = commitText(nextText);
    committedTextRef.current = committedText ?? displayValueRef.current;
    dirtyRef.current = false;
  }, [commitText, getLiveInputText]);

  useLayoutEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = active;
    if (!wasActive && active) {
      dirtyRef.current = false;
      latestTextRef.current = "";
      committedTextRef.current = displayValue;
      setText("");
      return;
    }
    if (wasActive && !active) {
      const nextText = dirtyRef.current ? latestTextRef.current : text;
      if (dirtyRef.current) {
        commitEditText(nextText);
      } else {
        committedTextRef.current = displayValue;
        setText(displayValue);
      }
      return;
    }
    if (!active) {
      latestTextRef.current = displayValue;
      committedTextRef.current = displayValue;
      setText(displayValue);
    }
  }, [active, commitEditText, displayValue, text]);

  useEffect(() => {
    if (!active) return;
    let animationFrame: number | null = null;
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    focusInput();
    queueMicrotask(focusInput);
    animationFrame = globalThis.requestAnimationFrame?.(focusInput) ?? null;
    timeouts.push(setTimeout(focusInput, 0), setTimeout(focusInput, 32));
    return () => {
      if (animationFrame !== null) globalThis.cancelAnimationFrame?.(animationFrame);
      for (const timeout of timeouts) clearTimeout(timeout);
    };
  }, [active, focusInput]);

  useLayoutEffect(() => {
    if (!active) return;
    return () => {
      commitLiveInputText();
    };
  }, [active, commitLiveInputText]);

  const handleSubmit = (nextText: string) => {
    commitEditText(nextText, nextText);
  };

  const handleBlur = (nextText: string) => {
    if (!dirtyRef.current && (nextText.trim() === "" || nextText === committedTextRef.current)) return;
    commitEditText(nextText, nextText);
  };

  return (
    <Box
      width={width}
      height={1}
      flexDirection="row"
      backgroundColor={active ? colors.selected : colors.panel}
      data-gloom-field-id={field.id}
      onMouseDown={() => {
        onFocus();
        focusInput();
      }}
    >
      <Text fg={active ? colors.selectedText : colors.textDim}>
        {truncateText(field.label, labelWidth).padEnd(labelWidth)}
      </Text>
      {active ? (
        <NumberField
          inputRef={inputNodeRef}
          focused={active}
          value={text}
          placeholder={displayValue}
          allowNegative={field.allowNegative}
          allowDecimal
          width={valueWidth}
          variant="plain"
          backgroundColor={colors.selected}
          textColor={colors.selectedText}
          placeholderColor={colors.textMuted}
          onMouseDown={onFocus}
          onChange={(nextText) => {
            dirtyRef.current = true;
            latestTextRef.current = nextText;
            setText(nextText);
          }}
          onSubmit={handleSubmit}
          onBlur={handleBlur}
        />
      ) : (
        <Box width={valueWidth} height={1} onMouseDown={() => {
          onFocus();
          focusInput();
        }}>
          <Text fg={colors.text}>{truncateText(displayValue, valueWidth)}</Text>
        </Box>
      )}
      {suffixWidth > 0 && (
        <Text fg={active ? colors.selectedText : colors.textDim}>%</Text>
      )}
    </Box>
  );
}

function MetricLine({
  label,
  value,
  width,
  color,
}: {
  label: string;
  value: string;
  width: number;
  color?: string;
}) {
  const labelWidth = Math.min(12, Math.max(8, Math.floor(width * 0.32)));
  const valueWidth = Math.max(8, width - labelWidth);
  return (
    <Box height={1} width={width} flexDirection="row" overflow="hidden">
      <Box width={labelWidth} flexShrink={0}>
        <Text fg={colors.textDim}>{label}</Text>
      </Box>
      <Box width={valueWidth} flexShrink={0}>
        <Text fg={color ?? colors.text} attributes={TextAttributes.BOLD}>
          {truncateText(value, valueWidth)}
        </Text>
      </Box>
    </Box>
  );
}

export function OptionsCalcPane({ focused, width, height }: PaneProps) {
  const ticker = usePaneTicker();
  const [inputs, setInputs] = usePaneStateValue<CalcInputs>("inputs", DEFAULT_INPUTS);
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [selectedFieldIndex, setSelectedFieldIndex] = useState(0);

  // Pre-fill spot from ticker market data on first load if spot is at default
  useEffect(() => {
    if (ticker?.financials?.quote?.price && inputs.spot === DEFAULT_INPUTS.spot) {
      setInputs({ ...inputs, spot: ticker.financials.quote.price });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker?.financials?.quote?.price]);

  const updateInput = useCallback((patch: Partial<CalcInputs>) => {
    setInputs((current) => ({ ...current, ...patch }));
  }, [setInputs]);

  const bsInputs: BSInputs = useMemo(() => ({
    spot: inputs.spot,
    strike: inputs.strike,
    timeToExpiry: inputs.daysToExpiry / DAYS_PER_YEAR,
    riskFreeRate: inputs.riskFreeRate / 100,
    volatility: inputs.volatility / 100,
    dividendYield: inputs.dividendYield / 100,
  }), [inputs]);

  const greeks = useMemo(
    () => blackScholes(bsInputs, inputs.type),
    [bsInputs, inputs.type],
  );

  const solvedIV = useMemo(() => {
    if (inputs.marketPrice == null || inputs.marketPrice <= 0) return null;
    return impliedVolatility(inputs.marketPrice, {
      spot: bsInputs.spot,
      strike: bsInputs.strike,
      timeToExpiry: bsInputs.timeToExpiry,
      riskFreeRate: bsInputs.riskFreeRate,
      dividendYield: bsInputs.dividendYield,
    }, inputs.type);
  }, [bsInputs, inputs.marketPrice, inputs.type]);

  const fields: FieldDef[] = useMemo(() => [
    {
      id: "spot",
      label: "Spot",
      value: inputs.spot,
      onValue: (value) => updateInput({ spot: value }),
      onClear: () => updateInput({ spot: 0 }),
    },
    {
      id: "strike",
      label: "Strike",
      value: inputs.strike,
      onValue: (value) => updateInput({ strike: value }),
      onClear: () => updateInput({ strike: 0 }),
    },
    {
      id: "days",
      label: "Days",
      value: inputs.daysToExpiry,
      onValue: (value) => updateInput({ daysToExpiry: value }),
      onClear: () => updateInput({ daysToExpiry: 0 }),
    },
    {
      id: "rate",
      label: "Rate",
      value: inputs.riskFreeRate,
      percent: true,
      onValue: (value) => updateInput({ riskFreeRate: value }),
      onClear: () => updateInput({ riskFreeRate: 0 }),
    },
    {
      id: "vol",
      label: "Vol",
      value: inputs.volatility,
      percent: true,
      onValue: (value) => updateInput({ volatility: value }),
      onClear: () => updateInput({ volatility: 0 }),
    },
    {
      id: "div",
      label: "Div yld",
      value: inputs.dividendYield,
      percent: true,
      onValue: (value) => updateInput({ dividendYield: value }),
      onClear: () => updateInput({ dividendYield: 0 }),
    },
  ], [inputs, updateInput]);

  const safeSelectedFieldIndex = Math.min(selectedFieldIndex, Math.max(0, fields.length - 1));

  const activateField = useCallback((fieldId: string | null, index?: number) => {
    if (typeof index === "number") setSelectedFieldIndex(index);
    setActiveFieldId(fieldId);
  }, []);

  useShortcut((event) => {
    if (!focused) return;
    if (event.ctrl || event.meta || event.super || event.alt || event.targetEditable) return;

    const key = event.key?.toLowerCase();
    if (key === "tab" && !event.shift) {
      event.preventDefault?.();
      event.stopPropagation?.();
      const nextIndex = (safeSelectedFieldIndex + 1) % fields.length;
      setSelectedFieldIndex(nextIndex);
      activateField(fields[nextIndex]!.id, nextIndex);
      return;
    }
    if (key === "enter" && !activeFieldId) {
      event.preventDefault?.();
      event.stopPropagation?.();
      activateField(fields[safeSelectedFieldIndex]?.id ?? null, safeSelectedFieldIndex);
    }
  }, { enabled: focused });

  usePaneFooter(OPTIONS_CALC_PANE_ID, () => {
    const info = solvedIV != null
      ? [{ id: "iv", parts: [{ text: `IV: ${(solvedIV * 100).toFixed(1)}%`, tone: "positive" as const }] }]
      : [];
    return {
      info,
      hints: [
        { id: "edit", key: "↵", label: "edit", onPress: () => activateField(fields[safeSelectedFieldIndex]?.id ?? null, safeSelectedFieldIndex) },
      ],
    };
  }, [activateField, fields, safeSelectedFieldIndex, solvedIV]);

  const fieldColumns = width >= 50 ? 2 : 1;
  const fieldWidth = Math.max(22, Math.floor((width - 2) / fieldColumns));
  const fieldRows = Math.ceil(fields.length / fieldColumns);
  const metricsWidth = width - 2;

  const fmtPrice = (v: number) => formatNumber(v, 4);
  const fmtPct = (v: number) => `${formatNumber(v * 100, 3)}%`;
  const fmtSigned = (v: number) => `${v >= 0 ? "+" : ""}${formatNumber(v, 4)}`;

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box height={1} paddingX={1} flexDirection="row">
        <Box flexGrow={1} overflow="hidden">
          <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
            {truncateText("Black-Scholes Calculator", Math.max(10, width - 16))}
          </Text>
        </Box>
        <SegmentedControl
          options={[
            { label: "Call", value: "call" },
            { label: "Put", value: "put" },
          ]}
          value={inputs.type}
          onChange={(value) => updateInput({ type: value as OptionType })}
          focused={focused && !activeFieldId}
        />
      </Box>

      <Box flexDirection="column" paddingX={1} height={fieldRows}>
        {Array.from({ length: fieldRows }, (_, rowIndex) => (
          <Box key={rowIndex} height={1} flexDirection="row">
            {fields.slice(rowIndex * fieldColumns, rowIndex * fieldColumns + fieldColumns).map((field, offset) => {
              const index = rowIndex * fieldColumns + offset;
              return (
                <InlineField
                  key={field.id}
                  field={field}
                  active={activeFieldId === field.id}
                  focused={focused}
                  width={fieldWidth}
                  onFocus={() => activateField(field.id, index)}
                />
              );
            })}
          </Box>
        ))}
      </Box>

      <Box height={1} paddingX={1}>
        <Text fg={colors.textMuted}>
          {truncateText(
            `T=${(bsInputs.timeToExpiry).toFixed(3)}y  European exercise`,
            Math.max(1, width - 2),
          )}
        </Text>
      </Box>

      <Box flexDirection="column" paddingX={1} flexGrow={1} overflow="hidden">
        <MetricLine label="Price" value={fmtPrice(greeks.price)} width={metricsWidth} color={colors.textBright} />
        <MetricLine label="Delta" value={fmtSigned(greeks.delta)} width={metricsWidth} />
        <MetricLine label="Gamma" value={fmtPrice(greeks.gamma)} width={metricsWidth} />
        <MetricLine label="Theta/d" value={fmtSigned(greeks.theta)} width={metricsWidth} />
        <MetricLine label="Vega/1%" value={fmtPrice(greeks.vega)} width={metricsWidth} />
        <MetricLine label="Rho/1%" value={fmtSigned(greeks.rho)} width={metricsWidth} />
      </Box>
    </Box>
  );
}
