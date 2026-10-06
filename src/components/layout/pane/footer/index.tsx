import { Box, Span, Text, TextAttributes, useUiCapabilities } from "../../../../ui";
import { useCallback, useRef, useState } from "react";
import { colors, blendHex } from "../../../../theme/colors";
import { t } from "../../../../i18n";
import { ShortcutHint } from "../../../ui/shortcut-hint";
import { Button } from "../../../ui/button";
import { ChoiceDialog } from "../../../ui/choice-dialog";
import { useRemoteUiNode } from "../../../../remote/semantic-tree";
import { useOptionalDialog, type PromptContext } from "../../../../ui/dialog";
import { nativePaneFooterRows } from "../sizing";
import { FooterSelectMenuPopover, openFooterSelectMenu } from "./select-menu";
import {
  EMPTY_FOOTER,
  hasPaneFooterContent,
  layoutPaneFooterHintRow,
  totalHintsWidth,
  type CombinedPaneFooter,
  type PaneFooterPart,
  type PaneFooterSegment,
  type PaneHint,
} from "./model";

export {
  hasPaneFooterContent,
  type CombinedPaneFooter,
  type PaneFooterPressEvent,
  type PaneFooterSegment,
  type PaneHint,
} from "./model";
export { getPaneFooter, PaneFooterKeys } from "./keyboard";
export {
  PaneFooterProvider,
  PaneFooterScope,
  usePaneFooter,
  usePaneMenuItems,
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

/** The key the terminal draws after a segment that has its own shortcut (`warning[!]`). */
function terminalSegmentKey(segment: PaneFooterSegment, focused: boolean): string {
  return focused && segment.shortcut && segment.onPress && !segment.disabled
    ? `[${segment.shortcut}]`
    : "";
}

/** Columns an icon segment keeps when hints crowd the footer. */
function iconSegmentReserve(segment: PaneFooterSegment, focused: boolean, nativePaneChrome: boolean): number {
  if (!segment.icon) return 0;
  return nativePaneChrome ? 3 : Math.max(3, 1 + terminalSegmentKey(segment, focused).length);
}

function SegmentView({ segment, focused }: { segment: PaneFooterSegment; focused: boolean }) {
  const { nativePaneChrome } = useUiCapabilities();
  const dialog = useOptionalDialog();
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = segment.menu;
  const interactive = (!!segment.onPress || !!menu) && !segment.disabled;
  const keyText = nativePaneChrome ? "" : terminalSegmentKey(segment, focused);
  const label = segment.label ?? segment.parts.map((part) => part.text).join(" ");
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
    label,
    disabled: segment.disabled,
    actions: {
      press: handlePress,
    },
    metadata: { id: segment.id, title: segment.title, shortcut: segment.shortcut, hasMenu: !!menu },
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

  const chip = (
    <Text
      fg={segment.disabled ? colors.textMuted : colors.textDim}
      attributes={attributes}
      aria-label={menu ? segment.label ?? "Refresh interval" : segment.label}
      // The desktop shows a status the row clipped in full on hover.
      title={segment.title ?? label}
      cursor={interactive ? "pointer" : undefined}
      onMouseDown={interactive ? startSegmentPress : undefined}
      onMouseUp={interactive ? finishSegmentPress : undefined}
      {...(interactive ? { "data-gloom-interactive": "true" } : {})}
      {...(menu ? { "data-gloom-role": "pane-footer-select" } : {})}
    >
      {[
        ...segment.parts.map((part, index) => (
          <Span
            key={`${segment.id}:part:${index}`}
            fg={segment.disabled ? colors.textMuted : footerToneColor(part)}
            attributes={part.bold ? TextAttributes.BOLD : 0}
            // A leading space collapses under the footer's nowrap rule. The gap
            // is a margin, one character, the same between parts and segments.
            style={nativePaneChrome && index > 0 ? { marginLeft: "1ch" } : undefined}
          >
            {index > 0 && !nativePaneChrome ? " " : ""}{part.text}
          </Span>
        )),
        ...(keyText
          ? [<Span key={`${segment.id}:key`} fg={colors.textBright} attributes={TextAttributes.BOLD}>{keyText}</Span>]
          : []),
      ]}
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

/** One footer segment. The gap after it matches the gap between parts: one character. */
function FooterSegment({
  segment,
  focused,
  gapAfter,
  nativePaneChrome,
}: {
  segment: PaneFooterSegment;
  focused: boolean;
  gapAfter: boolean;
  nativePaneChrome: boolean;
}) {
  return (
    <Box
      flexDirection="row"
      flexShrink={0}
      {...(nativePaneChrome
        ? (gapAfter ? { style: { marginRight: "1ch" } } : {})
        : { marginRight: gapAfter ? 1 : 0 })}
    >
      <SegmentView segment={segment} focused={focused} />
    </Box>
  );
}

function usePaneHintRemoteNode(hint: PaneHint) {
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
}

function HintView({ hint, prefixSpace }: { hint: PaneHint; prefixSpace: boolean }) {
  usePaneHintRemoteNode(hint);
  return (
    <ShortcutHint
      hotkey={hint.key}
      label={hint.label}
      prefix={prefixSpace ? " " : ""}
      disabled={hint.disabled}
      dataGloomRole="pane-hint"
      onPress={hint.onPress}
    />
  );
}

/** A hint behind More stays a remote control target, as it was when it only clipped. */
function OverflowHintNode({ hint }: { hint: PaneHint }) {
  usePaneHintRemoteNode(hint);
  return null;
}

function FooterOverflowMenu({ hints, width, label }: { hints: PaneHint[]; width: number; label: string }) {
  const dialog = useOptionalDialog();
  const open = () => {
    if (!dialog || hints.length === 0) return;
    void dialog.prompt<string>({
      closeOnClickOutside: true,
      content: (context: PromptContext<string>) => (
        <ChoiceDialog
          {...context}
          title={t("Pane actions")}
          choices={hints.map((hint, index) => ({
            id: String(index),
            label: `[${hint.key}]${hint.label}`,
            disabled: !hint.onPress,
          }))}
        />
      ),
    }).then((selected) => {
      if (selected) hints[Number(selected)]?.onPress?.();
    }, () => {});
  };
  return (
    <>
      <Button label={label} width={width} variant="plain" stopPropagation onPress={open} />
      {hints.map((hint) => <OverflowHintNode key={hint.id} hint={hint} />)}
    </>
  );
}

function FooterContent({
  footer,
  focused,
  width,
  showBackground = true,
  nativePaneChrome = false,
}: {
  footer: CombinedPaneFooter;
  focused: boolean;
  width?: number;
  showBackground?: boolean;
  nativePaneChrome?: boolean;
}) {
  const trailingInfo = footer.trailingInfo ?? [];
  const hasInfo = footer.info.length > 0;
  const hasTrailing = trailingInfo.length > 0;
  const actionableHints = focused ? footer.hints.filter((hint) => !hint.disabled) : [];
  const dividerColor = focused ? colors.borderFocused : colors.border;
  const backgroundColor = showBackground ? blendHex(colors.bg, dividerColor, focused ? 0.12 : 0.06) : undefined;
  const availableWidth = width && width > 0 ? Math.floor(width) : null;
  const iconReserve = footer.info.reduce((total, segment) => total + iconSegmentReserve(segment, focused, nativePaneChrome), 0);
  const row = availableWidth !== null
    ? layoutPaneFooterHintRow({ ...footer, hints: actionableHints }, availableWidth, iconReserve)
    : null;
  const shownHints = row?.hints ?? actionableHints;
  const overflowHints = row?.overflow ?? [];
  const hasHints = shownHints.length > 0 || overflowHints.length > 0;
  const hintsWidth = hasHints ? (row?.hintsWidth ?? totalHintsWidth(shownHints)) : 0;
  const infoWidth = availableWidth !== null && hasInfo
    ? (row?.infoWidth ?? Math.max(0, availableWidth - hintsWidth))
    : undefined;

  if (!hasInfo && !hasHints && !hasTrailing) {
    return <Box flexGrow={1} height={1} />;
  }

  return (
    <Box
      height={1}
      flexGrow={1}
      flexShrink={1}
      minWidth={0}
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
      backgroundColor={backgroundColor}
    >
      {hasInfo && (
        <Box
          flexDirection="row"
          flexShrink={1}
          minWidth={0}
          {...(nativePaneChrome ? {} : {
            overflow: "hidden" as const,
            ...(infoWidth != null ? { width: infoWidth } : {}),
          })}
        >
          {footer.info.map((segment, index) => (
            <FooterSegment
              key={segment.id}
              segment={segment}
              focused={focused}
              gapAfter={index !== footer.info.length - 1}
              nativePaneChrome={nativePaneChrome}
            />
          ))}
        </Box>
      )}
      {(hasHints || hasTrailing) && (
        <>
          <Box flexGrow={1} />
          {hasHints && (
            <Box
              flexDirection="row"
              justifyContent="flex-end"
              flexShrink={0}
              {...(nativePaneChrome ? {} : availableWidth !== null ? { width: hintsWidth } : { flexGrow: 1 })}
            >
              {shownHints.map((hint, index) => (
                <Box key={hint.id} flexDirection="row">
                  <HintView hint={hint} prefixSpace={index > 0} />
                </Box>
              ))}
              {overflowHints.length > 0 && row && (
                <Box marginLeft={shownHints.length > 0 ? 1 : 0} flexShrink={0}>
                  <FooterOverflowMenu hints={overflowHints} width={row.moreWidth} label={row.moreLabel} />
                </Box>
              )}
            </Box>
          )}
          {hasTrailing && (
            <Box
              flexDirection="row"
              flexShrink={0}
              marginLeft={hasHints ? 1 : 0}
              {...(nativePaneChrome ? { style: hasHints ? { marginLeft: "1ch" } : undefined } : {})}
            >
              {trailingInfo.map((segment, index) => (
                <FooterSegment
                  key={segment.id}
                  segment={segment}
                  focused={focused}
                  gapAfter={index !== trailingInfo.length - 1}
                  nativePaneChrome={nativePaneChrome}
                />
              ))}
            </Box>
          )}
        </>
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
  // Two cells clear of the left edge, three on the right so the last glyph
  // clears the pane border. Floating panes also keep the resize-handle reserve.
  const leftPadding = 2;
  const rightPadding = reservedRight + 3;

  if (nativePaneChrome) {
    return (
      <Box
        height={nativePaneFooterRows()}
        flexDirection="row"
        paddingLeft={leftPadding}
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
          width={width > 0 ? Math.max(0, Math.floor(width) - rightPadding - leftPadding) : undefined}
          showBackground={false}
          nativePaneChrome
        />
      </Box>
    );
  }

  if (focused || showBorder) {
    const contentWidth = Math.max(0, Math.floor(width) - 1 - reservedRight - (reservedRight > 0 ? 0 : 1));
    return (
      <Box height={1} width={width} flexDirection="row" data-gloom-role="pane-footer" data-focused={focused ? "true" : "false"} data-empty={empty ? "true" : "false"}>
        <Text fg={borderColor} selectable={false}>└</Text>
        <Box width={contentWidth} height={1} overflow="hidden">
          {empty
            ? <Text fg={borderColor} selectable={false}>{"─".repeat(contentWidth)}</Text>
            : <FooterContent footer={resolvedFooter} focused={focused} width={contentWidth} />}
        </Box>
        {reservedRight === 0 && <Text fg={borderColor} selectable={false}>┘</Text>}
      </Box>
    );
  }

  const contentWidth = Math.max(0, Math.floor(width) - reservedRight);
  return (
    <Box height={1} width={width} flexDirection="row" data-gloom-role="pane-footer" data-focused="false" data-empty={empty ? "true" : "false"}>
      <Box width={contentWidth} height={1} overflow="hidden">
        <FooterContent footer={resolvedFooter} focused={false} width={contentWidth} />
      </Box>
    </Box>
  );
}
