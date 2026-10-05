import { useCallback, useEffect, useState, type RefObject } from "react";
import { Box, Input, Text, type InputRenderable } from "../ui";
import { colors } from "../theme/colors";
import { useAppInputCapture } from "../state/app/input-capture";
import { useShortcut } from "../react/input";
import { isPlainArrowDown, stopSearchFocusNavigation } from "../utils/search-focus-navigation";
import { t, tf } from "../i18n";

/** Placeholders are hints like "title or source", which do not name the field on their own. */
function searchInputLabel(placeholder: string): string {
  const hint = placeholder.trim().replace(/(\.\.\.|…)$/, "").trim();
  if (!hint) return t("Search");
  if (/^(search|filter|find)\b/i.test(hint)) return hint;
  return tf("Search {hint}", { hint });
}

export function InputSearchBar({
  value,
  focused,
  active,
  width,
  focusToken,
  inputRef,
  placeholder,
  label,
  debounceMs,
  glyph = "/",
  appearance = "strip",
  normalizeValue = identity,
  onNavigateDown,
  onFocus,
  onBlur,
  onQueryChange,
  onSubmit,
}: {
  value: string;
  focused: boolean;
  active: boolean;
  width: number | "100%";
  focusToken: number;
  inputRef: RefObject<InputRenderable | null>;
  placeholder: string;
  /** Accessible name for the field; derived from the placeholder when omitted. */
  label?: string;
  debounceMs: number;
  /** Leading marker; override when a pane shows more than one field. */
  glyph?: string;
  /** `plain` drops the strip background and glyph for a host that draws its own field. */
  appearance?: "strip" | "plain";
  normalizeValue?: (value: string) => string;
  onNavigateDown?: () => void;
  onFocus: () => void;
  onBlur: () => void;
  onQueryChange: (query: string) => void;
  onSubmit?: (query: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useAppInputCapture(focused && active);

  useShortcut((event) => {
    if (!onNavigateDown || !isPlainArrowDown(event)) return;
    stopSearchFocusNavigation(event);
    onNavigateDown();
  }, {
    allowEditable: true,
    enabled: focused && active && !!onNavigateDown,
    phase: "before",
  });

  // A focused input consumes every key, so Escape has to be intercepted before
  // it reaches the field. Without this there is no way back out of a search.
  useShortcut((event) => {
    if (event.name !== "escape") return;
    stopSearchFocusNavigation(event);
    setDraft("");
    onQueryChange("");
    onBlur();
  }, {
    allowEditable: true,
    enabled: focused && active,
    phase: "before",
  });

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (focused && active) inputRef.current?.focus?.();
  }, [active, focused, focusToken, inputRef]);

  useEffect(() => {
    if (debounceMs <= 0) return;
    if (normalizeValue(draft) === normalizeValue(value)) return;
    const timer = setTimeout(() => {
      onQueryChange(draft);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [debounceMs, draft, normalizeValue, onQueryChange, value]);

  const commitNow = useCallback((nextValue: string) => {
    onQueryChange(nextValue);
    onSubmit?.(nextValue);
    onBlur();
  }, [onBlur, onQueryChange, onSubmit]);

  const handleDraft = useCallback((nextValue: string) => {
    setDraft(nextValue);
    if (debounceMs <= 0) onQueryChange(nextValue);
  }, [debounceMs, onQueryChange]);

  return (
    <Box
      height={1}
      width={width}
      flexDirection="row"
      backgroundColor={appearance === "plain" ? undefined : colors.panel}
      onMouseDown={(event: any) => {
        event.preventDefault?.();
        event.stopPropagation?.();
        onFocus();
        inputRef.current?.focus?.();
      }}
    >
      {appearance === "strip" && <Text fg={active ? colors.textBright : colors.textDim}>{glyph}</Text>}
      {appearance === "strip" && <Box width={1} />}
      <Input
        ref={inputRef}
        value={draft}
        focused={focused && active}
        placeholder={placeholder}
        aria-label={label ?? searchInputLabel(placeholder)}
        placeholderColor={colors.textDim}
        textColor={colors.text}
        focusedTextColor={colors.text}
        backgroundColor={appearance === "plain" ? "transparent" : colors.panel}
        focusedBackgroundColor={appearance === "plain" ? "transparent" : colors.panel}
        cursorColor={colors.textBright}
        flexGrow={1}
        onFocus={onFocus}
        onBlur={onBlur}
        onInput={handleDraft}
        onChange={handleDraft}
        onSubmit={commitNow}
      />
    </Box>
  );
}

function identity(value: string): string {
  return value;
}
