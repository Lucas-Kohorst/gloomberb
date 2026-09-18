import { type ReactNode, type RefObject } from "react";
import { Box, type InputRenderable } from "../ui";
import { InputSearchBar } from "./input-search-bar";
import { Tabs, type TabsProps } from "./ui/tabs";

export interface PaneListChromeTab {
  label: string;
  value: string;
  disabled?: boolean;
}

export interface PaneListSearchProps {
  value: string;
  active: boolean;
  focusToken: number;
  inputRef: RefObject<InputRenderable | null>;
  placeholder: string;
  debounceMs?: number;
  glyph?: string;
  width?: number;
  normalizeValue?: (value: string) => string;
  onFocus: () => void;
  onBlur: () => void;
  onNavigateDown?: () => void;
  onQueryChange: (query: string) => void;
}

export function paneListChromeRows(options: {
  tabs?: boolean;
  search?: boolean;
}): number {
  return (options.tabs ? 1 : 0) + (options.search ? 1 : 0);
}

/**
 * Shared list-pane chrome: optional tabs, then `/` search, then the body.
 * Adjacent indices is the gold — clickable header sort lives on the table,
 * not here. Do not put the pane title in this slice; the window header
 * already names the pane.
 */
export function PaneListChrome({
  width,
  height,
  focused,
  tabs,
  activeValue,
  onSelect,
  tabVariant = "underline",
  tabCompact = true,
  tabScrollable,
  search,
  trailing,
  children,
}: {
  width: number;
  height?: number;
  focused: boolean;
  tabs?: readonly PaneListChromeTab[];
  activeValue?: string | null;
  onSelect?: (value: string) => void;
  tabVariant?: TabsProps["variant"];
  tabCompact?: boolean;
  tabScrollable?: boolean;
  search?: PaneListSearchProps | null;
  trailing?: ReactNode;
  children?: ReactNode;
}) {
  const showTabs = (tabs?.length ?? 0) > 0 && activeValue != null && !!onSelect;
  const headerHeight = paneListChromeRows({ tabs: showTabs, search: !!search });
  const header = (
    <PaneListChromeHeader
      width={width}
      focused={focused}
      tabs={showTabs ? tabs : undefined}
      activeValue={activeValue}
      onSelect={onSelect}
      tabVariant={tabVariant}
      tabCompact={tabCompact}
      tabScrollable={tabScrollable}
      search={search}
      trailing={trailing}
      searchActive={!!search?.active}
    />
  );

  if (height == null) return header;

  const bodyHeight = Math.max(1, height - headerHeight);
  return (
    <Box flexDirection="column" width={width} height={height}>
      {header}
      <Box
        height={bodyHeight}
        width={width}
        flexGrow={1}
        flexBasis={0}
        minHeight={0}
        overflow="hidden"
      >
        {children}
      </Box>
    </Box>
  );
}

function PaneListChromeHeader({
  width,
  focused,
  tabs,
  activeValue,
  onSelect,
  tabVariant,
  tabCompact,
  tabScrollable,
  search,
  trailing,
  searchActive,
}: {
  width: number;
  focused: boolean;
  tabs?: readonly PaneListChromeTab[];
  activeValue?: string | null;
  onSelect?: (value: string) => void;
  tabVariant: TabsProps["variant"];
  tabCompact: boolean;
  tabScrollable?: boolean;
  search?: PaneListSearchProps | null;
  trailing?: ReactNode;
  searchActive: boolean;
}) {
  const tabRow = tabs && onSelect ? (
    <Box height={1} width={width}>
      <Tabs
        tabs={[...tabs]}
        activeValue={activeValue ?? null}
        onSelect={onSelect}
        compact={tabCompact}
        variant={tabVariant}
        scrollable={tabScrollable}
        focused={focused && !searchActive}
      />
    </Box>
  ) : null;
  const searchRow = search ? (
    <PaneListSearchRow
      width={width}
      focused={focused}
      search={search}
      trailing={trailing}
    />
  ) : null;

  if (tabRow && searchRow) {
    return (
      <Box flexDirection="column" width={width} height={2}>
        {tabRow}
        {searchRow}
      </Box>
    );
  }
  return tabRow ?? searchRow;
}

function PaneListSearchRow({
  width,
  focused,
  search,
  trailing,
}: {
  width: number;
  focused: boolean;
  search: PaneListSearchProps;
  trailing?: ReactNode;
}) {
  const searchWidth = search.width ?? (trailing ? Math.max(18, Math.floor(width * 0.28)) : width);
  const bar = (
    <InputSearchBar
      value={search.value}
      focused={focused}
      active={search.active}
      width={searchWidth}
      focusToken={search.focusToken}
      inputRef={search.inputRef}
      placeholder={search.placeholder}
      debounceMs={search.debounceMs ?? 80}
      glyph={search.glyph}
      normalizeValue={search.normalizeValue}
      onNavigateDown={search.onNavigateDown}
      onFocus={search.onFocus}
      onBlur={search.onBlur}
      onQueryChange={search.onQueryChange}
    />
  );
  if (!trailing) return bar;
  return (
    <Box flexDirection="row" height={1} width={width} paddingX={1} gap={2}>
      {bar}
      <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
        {trailing}
      </Box>
    </Box>
  );
}
