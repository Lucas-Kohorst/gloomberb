import { useEffect, type ReactNode } from "react";
import { t } from "../../i18n";
import { useShortcut, type KeyEventLike } from "../../react/input";
import { useThemeColors } from "../../theme/theme-context";
import { Box, Text, TextAttributes } from "../../ui";
import { isPlainKey } from "../../utils/keyboard";
import { PaneSidebarRow } from "../layout/pane/sidebar";

/** Wider than the generic pane sidebar so plugin and layout names stay readable. */
export function marketplaceSidebarWidth(width: number): number {
  return Math.min(36, Math.max(26, Math.floor(width * 0.28)));
}

/**
 * Direction a list-navigation key moves the selection. `j`/`k` only count
 * outside the search field so typing those letters still filters.
 */
function selectionStep(event: KeyEventLike): 1 | -1 | 0 {
  const fromSearch = event.targetEditable === true;
  if (isPlainKey(event, "down") || (!fromSearch && isPlainKey(event, "j"))) return 1;
  if (isPlainKey(event, "up") || (!fromSearch && isPlainKey(event, "k"))) return -1;
  return 0;
}

/**
 * Up/down (and j/k outside the search field) step the sidebar selection in
 * rendered order. Registered as a pane shortcut rather than a DOM handler so it
 * works the moment the pane opens, before anything inside it holds focus; the
 * sidebar's own roving focus takes over once a row is focused.
 */
export function useMarketplaceListNavigation({
  enabled,
  scope,
  items,
  selectedId,
  select,
}: {
  enabled: boolean;
  scope: string;
  items: ReadonlyArray<{ id: string }>;
  selectedId: string | null;
  select: (id: string) => void;
}): void {
  useShortcut((event) => {
    const step = selectionStep(event);
    if (!step || items.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const index = Math.max(0, items.findIndex((item) => item.id === selectedId));
    const next = items[Math.max(0, Math.min(index + step, items.length - 1))];
    if (next) select(next.id);
  }, { enabled, allowEditable: true, scope });
}

/**
 * Keyboard selection can land on a row below the sidebar's visible area, so
 * the current row is scrolled into view after every selection change. The
 * host `Box` ref exposes cell bounds rather than the element, which is why
 * this queries the DOM by role instead of holding a ref.
 */
export function useScrollMarketplaceRowIntoView(rowRole: string, selectedId: string | null | undefined): void {
  useEffect(() => {
    if (!selectedId || typeof document === "undefined") return;
    const row = document.querySelector<HTMLElement>(`[data-gloom-role="${rowRole}"][aria-current="true"]`);
    row?.scrollIntoView?.({ block: "nearest" });
  }, [rowRole, selectedId]);
}

export function MarketplaceSection({
  title,
  count,
  flush = false,
}: {
  title: string;
  count: number;
  flush?: boolean;
}) {
  const colors = useThemeColors();
  return (
    <Box
      height={1}
      flexDirection="row"
      alignItems="center"
      paddingX={1}
      marginTop={flush ? 0 : 1}
      flexShrink={0}
    >
      <Text fg={colors.textMuted} attributes={TextAttributes.BOLD}>
        {`${t(title).toUpperCase()} ${count}`}
      </Text>
    </Box>
  );
}

export function MarketplaceNote({ children }: { children: ReactNode }) {
  const colors = useThemeColors();
  return (
    <Box flexDirection="row" paddingX={1} flexShrink={0}>
      <Text fg={colors.textDim} wrapText>{children}</Text>
    </Box>
  );
}

export function MarketplaceActionRow({
  label,
  onPress,
  rowRole,
}: {
  label: string;
  onPress: () => void;
  rowRole: string;
}) {
  return (
    <PaneSidebarRow active={false} ariaLabel={label} onSelect={onPress}>
      {({ foregroundColor, listWidth, onMouseDown }) => (
        <Box
          width={listWidth}
          height={1}
          flexDirection="row"
          role="button"
          tabIndex={0}
          aria-label={label}
          data-gloom-role={rowRole}
          data-gloom-interactive="true"
          onMouseDown={onMouseDown}
          onKeyDown={(event: { key?: string; preventDefault?: () => void; stopPropagation?: () => void }) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault?.();
            event.stopPropagation?.();
            onPress();
          }}
          style={{ cursor: "pointer" }}
        >
          <Text fg={foregroundColor}>{`  ${label}`}</Text>
        </Box>
      )}
    </PaneSidebarRow>
  );
}
