import { Box, Span, Text, TextAttributes, useUiCapabilities } from "../../../../ui";
import { useCallback, useRef, useState } from "react";
import { colors, blendHex } from "../../../../theme/colors";
import { ShortcutHint } from "../../../ui/shortcut-hint";
import {
  packFooterHintRows,
  PANE_FOOTER_HINT_GAP,
  totalHintsWidth,
  measurePaneFooterHintRows,
} from "./hint-layout";
import { useRemoteUiNode } from "../../../../remote/semantic-tree";
import { useOptionalDialog } from "../../../../ui/dialog";
import {
  EMPTY_FOOTER,
  hasPaneFooterContent,
  type CombinedPaneFooter,
  type PaneFooterPressEvent,
  type PaneFooterPart,
  type PaneFooterSegment,
  type PaneHint,
} from "./model";
import { FooterSelectMenuPopover, openFooterSelectMenu } from "./select-menu";

export {
  clipPaneFooterInfo,
  hasPaneFooterContent,
  PANE_FOOTER_INFO_MAX_CHARS,
  type CombinedPaneFooter,
  type PaneFooterPressEvent,
  type PaneFooterSelectMenu,
  type PaneFooterSelectOption,
  type PaneFooterSegment,
  type PaneHint,
} from "./model";
export { measurePaneFooterHintRows } from "./hint-layout";
export {
  PaneFooterProvider,
  PaneFooterScope,
  usePaneFooter,
  usePaneHints,
} from "./registration";

function footerToneColor(part: PaneFooterPart): string {
  if (part.color) return part.color;
  switch (part.tone) {
    case "label":
      return colors.textDim;
    case "muted":
      return colors.textMuted;
    case "positive":
      return colors.positive;
    case "negative":
      return colors.negative;
    case "warning":
      return colors.warning;
    case "value":
    default:
      return colors.text;
  }
}

function stopMouseEvent(event?: { stopPropagation?: () => void; preventDefault?: () => void }) {
  event?.stopPropagation?.();
  event?.preventDefault?.();
}

function isOpenMenuKey(event: { key?: string; name?: string }): boolean {
  const key = (event.key ?? event.name ?? "").toLowerCase();
  return key === "enter" || key === "return" || key === " " || key === "space";
}

function SegmentView({ segment }: { segment: PaneFooterSegment }) {
  const { nativePaneChrome } = useUiCapabilities();
  const dialog = useOptionalDialog();
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = segment.menu;
  const interactive = (!!segment.onPress || !!menu) && !segment.disabled;
  const handlePress = useCallback(() => {
    if (segment.disabled) return;
    if (menu) {
      if (nativePaneChrome) {
        setMenuOpen((open) => !open);
        return;
      }
      void openFooterSelectMenu(dialog, menu);
      return;
    }
    segment.onPress?.();
  }, [dialog, menu, nativePaneChrome, segment]);
  useRemoteUiNode(interactive ? {
    role: "pane-footer-segment",
    label: segment.parts.map((part) => part.text).join(" "),
    disabled: segment.disabled,
    actions: {
      press: handlePress,
    },
    metadata: { id: segment.id, hasMenu: !!menu },
  } : null);
  const attributes = segment.parts.some((part) => part.bold) || interactive ? TextAttributes.BOLD : 0;
  const triggerMouseDownRef = useRef(false);
  const startSegmentPress = (event?: { stopPropagation?: () => void; preventDefault?: () => void }) => {
    triggerMouseDownRef.current = true;
    stopMouseEvent(event);
  };
  const finishSegmentPress = (event?: { stopPropagation?: () => void; preventDefault?: () => void }) => {
    const startedOnTrigger = triggerMouseDownRef.current;
    triggerMouseDownRef.current = false;
    if (startedOnTrigger) handlePress();
    else stopMouseEvent(event);
  };
  const handleKeyDown = (event: { key?: string; name?: string; preventDefault?: () => void; stopPropagation?: () => void }) => {
    if (!interactive || !isOpenMenuKey(event)) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    handlePress();
  };

  const chip = (
    <Text
      fg={segment.disabled ? colors.textMuted : colors.textDim}
      attributes={attributes}
      onMouseDown={interactive ? startSegmentPress : undefined}
      onMouseUp={interactive ? finishSegmentPress : undefined}
      onKeyDown={interactive && nativePaneChrome ? handleKeyDown : undefined}
      role={interactive && nativePaneChrome ? "button" : undefined}
      tabIndex={interactive && nativePaneChrome ? 0 : undefined}
      aria-haspopup={menu && nativePaneChrome ? "listbox" : undefined}
      aria-expanded={menu && nativePaneChrome ? (menuOpen ? "true" : "false") : undefined}
      aria-label={menu && nativePaneChrome ? "Refresh interval" : undefined}
      {...(interactive ? { "data-gloom-interactive": "true" } : {})}
      {...(menu ? { "data-gloom-role": "pane-footer-select" } : {})}
      {...(nativePaneChrome && interactive ? {
        style: { cursor: "pointer" },
      } : {})}
    >
      {segment.parts.map((part, index) => (
        <Span
          key={`${segment.id}:part:${index}`}
          fg={segment.disabled ? colors.textMuted : footerToneColor(part)}
          attributes={part.bold ? TextAttributes.BOLD : 0}
        >
          {index > 0 ? " " : ""}{part.text}
        </Span>
      ))}
    </Text>
  );

  if (menu && nativePaneChrome) {
    return (
      <FooterSelectMenuPopover
        open={menuOpen}
        onOpenChange={setMenuOpen}
        menu={menu}
        trigger={chip}
      />
    );
  }

  return chip;
}

function segmentTextLength(segment: PaneFooterSegment): number {
  return segment.parts.reduce((total, part, index) => total + (index > 0 ? 1 : 0) + part.text.length, 0);
}

function totalTrailingInfoWidth(segments: PaneFooterSegment[]): number {
  if (segments.length === 0) return 0;
  return segments.reduce((total, segment, index) => {
    return total + (index > 0 ? 1 : 0) + segmentTextLength(segment);
  }, 0);
}

function HintView({ hint, prefixSpace }: { hint: PaneHint; prefixSpace: boolean }) {
  useRemoteUiNode({
    role: "pane-hint",
    label: `${hint.key}${hint.label}`,
    disabled: hint.disabled,
    actions: {
      press: hint.onPress ? () => hint.onPress?.() : undefined,
    },
    metadata: {
      id: hint.id,
      key: hint.key,
      label: hint.label,
    },
  });
  return (
    <ShortcutHint
      hotkey={hint.key}
      label={hint.label}
      prefix={prefixSpace ? " ".repeat(PANE_FOOTER_HINT_GAP) : ""}
      disabled={hint.disabled}
      dataGloomRole="pane-hint"
      onPress={hint.onPress}
    />
  );
}

function InfoSegments({
  segments,
  width,
}: {
  segments: PaneFooterSegment[];
  width?: number;
}) {
  if (segments.length === 0) return null;
  return (
    <Box
      flexDirection="row"
      overflow="hidden"
      flexShrink={1}
      {...(width != null ? { width } : {})}
    >
      {segments.map((segment, index) => (
        <Box key={segment.id} flexDirection="row" marginRight={index === segments.length - 1 ? 0 : 1}>
          <SegmentView segment={segment} />
        </Box>
      ))}
    </Box>
  );
}

function TrailingSegments({
  segments,
  width,
  marginLeft = 0,
}: {
  segments: PaneFooterSegment[];
  width?: number;
  marginLeft?: number;
}) {
  if (segments.length === 0) return null;
  return (
    <Box
      flexDirection="row"
      justifyContent="flex-end"
      flexShrink={0}
      overflow="hidden"
      marginLeft={marginLeft}
      {...(width != null ? { width } : {})}
    >
      {segments.map((segment, index) => (
        <Box key={segment.id} flexDirection="row" marginRight={index === segments.length - 1 ? 0 : 1}>
          <SegmentView segment={segment} />
        </Box>
      ))}
    </Box>
  );
}

function HintRow({
  hints,
  nativePaneChrome,
  width,
}: {
  hints: PaneHint[];
  nativePaneChrome: boolean;
  width?: number;
}) {
  if (hints.length === 0) return null;
  return (
    <Box
      flexDirection="row"
      justifyContent="flex-end"
      alignItems="center"
      flexWrap={nativePaneChrome ? "wrap" : undefined}
      flexShrink={nativePaneChrome ? 1 : 0}
      overflow={nativePaneChrome ? undefined : "hidden"}
      data-gloom-role="pane-footer-hints"
      {...(!nativePaneChrome && width != null ? { width } : {})}
    >
      {hints.map((hint, index) => (
        <Box key={hint.id} flexDirection="row" flexShrink={0}>
          <HintView hint={hint} prefixSpace={!nativePaneChrome && index > 0} />
        </Box>
      ))}
    </Box>
  );
}

function FooterContent({
  footer,
  focused,
  width,
  showBackground = true,
}: {
  footer: CombinedPaneFooter;
  focused: boolean;
  width?: number;
  showBackground?: boolean;
}) {
  const { nativePaneChrome = false } = useUiCapabilities();
  const hasInfo = footer.info.length > 0;
  const trailingInfo = footer.trailingInfo ?? [];
  const hasTrailingInfo = trailingInfo.length > 0;
  const visibleHints = focused ? footer.hints.filter((hint) => !hint.disabled) : [];
  const hasHints = visibleHints.length > 0;
  const dividerColor = focused ? colors.borderFocused : colors.border;
  const backgroundColor = showBackground ? blendHex(colors.bg, dividerColor, focused ? 0.12 : 0.06) : undefined;
  const availableWidth = width && width > 0 ? Math.floor(width) : null;
  const trailingGap = hasHints && hasTrailingInfo ? 1 : 0;
  const trailingWidth = hasTrailingInfo
    ? Math.min(availableWidth ?? totalTrailingInfoWidth(trailingInfo), totalTrailingInfoWidth(trailingInfo))
    : 0;
  const hintRows = nativePaneChrome || availableWidth == null
    ? (hasHints ? [visibleHints] : [])
    : packFooterHintRows(visibleHints, Math.max(1, availableWidth - trailingWidth - trailingGap));
  const primaryHints = hintRows[0] ?? [];
  const overflowHints = hintRows.slice(1).flat();
  const primaryHintsWidth = primaryHints.length > 0
    ? Math.min(availableWidth ?? totalHintsWidth(primaryHints), totalHintsWidth(primaryHints))
    : 0;
  const rightWidth = primaryHintsWidth + trailingWidth + trailingGap;
  const infoWidth = availableWidth !== null && hasInfo
    ? Math.max(0, availableWidth - rightWidth)
    : undefined;
  const rowCount = nativePaneChrome ? 1 : Math.max(1, hintRows.length);

  if (!hasInfo && !hasHints && !hasTrailingInfo) {
    return <Box flexGrow={1} height={1} />;
  }

  return (
    <Box
      height={nativePaneChrome ? undefined : rowCount}
      flexGrow={1}
      flexDirection="column"
      overflow={nativePaneChrome ? undefined : "hidden"}
      {...(nativePaneChrome ? {
        style: { minHeight: 0 },
      } : {})}
    >
      <Box
        height={nativePaneChrome ? undefined : 1}
        flexGrow={nativePaneChrome ? 1 : 0}
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        overflow={nativePaneChrome ? undefined : "hidden"}
      >
        <InfoSegments segments={footer.info} width={infoWidth} />
        {(hasHints || hasTrailingInfo) && (
          <>
            <Box flexGrow={1} />
            <HintRow
              hints={nativePaneChrome ? visibleHints : primaryHints}
              nativePaneChrome={nativePaneChrome}
              width={!nativePaneChrome && availableWidth !== null ? primaryHintsWidth : undefined}
            />
            <TrailingSegments
              segments={trailingInfo}
              width={availableWidth !== null ? trailingWidth : undefined}
              marginLeft={hasHints ? 1 : 0}
            />
          </>
        )}
      </Box>
      {!nativePaneChrome && overflowHints.length > 0 && (
        <Box height={1} flexDirection="row" justifyContent="flex-end" overflow="hidden">
          <Box flexGrow={1} />
          <HintRow hints={overflowHints} nativePaneChrome={false} />
        </Box>
      )}
    </Box>
  );
}

export function PaneFooterBar({
  footer = EMPTY_FOOTER,
  focused,
  width = 0,
  reserveRight = 0,
  showBorder = false,
}: {
  footer?: CombinedPaneFooter | null;
  focused: boolean;
  width?: number;
  reserveRight?: number;
  showBorder?: boolean;
}) {
  const { nativePaneChrome } = useUiCapabilities();
  const resolvedFooter = footer ?? EMPTY_FOOTER;
  const empty = !hasPaneFooterContent(resolvedFooter);
  const borderColor = focused ? colors.borderFocused : colors.border;
  const topBorderColor = colors.border;
  const nativeBackgroundColor = empty
    ? "transparent"
    : focused
      ? blendHex(colors.bg, colors.borderFocused, 0.06)
      : blendHex(colors.panel, colors.border, 0.12);
  const reservedRight = Math.max(0, reserveRight);
  const rightPadding = reservedRight > 0 ? reservedRight : 1;
  const contentWidth = nativePaneChrome
    ? (width > 0 ? Math.max(0, Math.floor(width) - rightPadding - 1) : 0)
    : Math.max(0, Math.floor(width) - 1 - reservedRight - (reservedRight > 0 ? 0 : 1));
  const footerRows = nativePaneChrome
    ? 1
    : measurePaneFooterHintRows(resolvedFooter, contentWidth, { focused, nativePaneChrome: false });

  if (nativePaneChrome) {
    return (
      <Box
        flexDirection="row"
        paddingLeft={1}
        paddingRight={rightPadding}
        alignItems="center"
        data-gloom-role="pane-footer"
        data-focused={focused ? "true" : "false"}
        data-empty={empty ? "true" : "false"}
        style={{
          "--pane-footer-border-color": empty ? "transparent" : topBorderColor,
          borderTop: `1px solid ${empty ? "transparent" : topBorderColor}`,
          backgroundColor: nativeBackgroundColor,
          boxShadow: empty ? "none" : `inset 0 1px 0 ${blendHex(nativeBackgroundColor, colors.textBright, 0.03)}`,
        }}
      >
        <FooterContent
          footer={resolvedFooter}
          focused={focused}
          width={contentWidth || undefined}
          showBackground={false}
        />
      </Box>
    );
  }

  if (focused || showBorder) {
    const terminalContentWidth = Math.max(0, Math.floor(width) - 1 - reservedRight - (reservedRight > 0 ? 0 : 1));
    return (
      <Box height={footerRows} width={width} flexDirection="row" data-gloom-role="pane-footer" data-focused={focused ? "true" : "false"} data-empty={empty ? "true" : "false"}>
        <Box width={1} height={footerRows} flexDirection="column">
          {Array.from({ length: Math.max(0, footerRows - 1) }, (_, index) => (
            <Text key={`l:${index}`} fg={borderColor} selectable={false}>│</Text>
          ))}
          <Text fg={borderColor} selectable={false}>└</Text>
        </Box>
        <Box width={terminalContentWidth} height={footerRows} overflow="hidden">
          {empty
            ? <Text fg={borderColor} selectable={false}>{"─".repeat(terminalContentWidth)}</Text>
            : <FooterContent footer={resolvedFooter} focused={focused} width={terminalContentWidth} />}
        </Box>
        {reservedRight === 0 && (
          <Box width={1} height={footerRows} flexDirection="column">
            {Array.from({ length: Math.max(0, footerRows - 1) }, (_, index) => (
              <Text key={`r:${index}`} fg={borderColor} selectable={false}>│</Text>
            ))}
            <Text fg={borderColor} selectable={false}>┘</Text>
          </Box>
        )}
      </Box>
    );
  }

  const unfocusedWidth = Math.max(0, Math.floor(width) - reservedRight);
  return (
    <Box height={footerRows} width={width} flexDirection="row" data-gloom-role="pane-footer" data-focused="false" data-empty={empty ? "true" : "false"}>
      <Box width={unfocusedWidth} height={footerRows} overflow="hidden">
        <FooterContent footer={resolvedFooter} focused={false} width={unfocusedWidth} />
      </Box>
    </Box>
  );
}
