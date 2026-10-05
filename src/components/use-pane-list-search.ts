import { useCallback, useRef, useState } from "react";
import { useShortcut } from "../react/input";
import type { InputRenderable } from "../ui";
import { isPlainKey } from "../utils/keyboard";
import type { PaneListSearchProps } from "./pane-list-chrome";
import type { TableViewKeyEvent } from "./table-view-shared";

export function usePaneListSearch({
  focused,
  enabled = true,
  value,
  onQueryChange,
  placeholder,
  label,
  debounceMs = 80,
  normalizeValue,
}: Pick<PaneListSearchProps, "value" | "onQueryChange" | "placeholder" | "label" | "debounceMs" | "normalizeValue"> & {
  focused: boolean;
  enabled?: boolean;
}) {
  const [searchFocused, setSearchFocused] = useState(false);
  const [focusToken, setFocusToken] = useState(0);
  const inputRef = useRef<InputRenderable | null>(null);
  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setFocusToken((current) => current + 1);
  }, []);
  const blurSearch = useCallback(() => setSearchFocused(false), []);
  const handleSearchKey = useCallback((event: TableViewKeyEvent) => {
    if (!enabled || event.defaultPrevented || event.propagationStopped || !isPlainKey(event, "/")) return false;
    event.preventDefault?.();
    event.stopPropagation?.();
    focusSearch();
    return true;
  }, [enabled, focusSearch]);

  useShortcut(handleSearchKey, { enabled: focused && enabled && !searchFocused });

  const search: PaneListSearchProps = {
    value,
    active: searchFocused,
    focusToken,
    inputRef,
    placeholder,
    label,
    debounceMs,
    normalizeValue,
    onFocus: focusSearch,
    onBlur: blurSearch,
    onNavigateDown: blurSearch,
    onQueryChange,
  };

  return { search, searchFocused, focusSearch, blurSearch, handleSearchKey };
}
