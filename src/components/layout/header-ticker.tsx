import { useCallback, useRef, useState, type RefObject } from "react";
import { Box, Input, type InputRenderable } from "../../ui";
import { blendHex } from "../../theme/colors";
import { useThemeColors } from "../../theme/theme-context";
import { useAppDispatch, useAppSelector } from "../../state/app/context";
import { useAppInputCapture } from "../../state/app/input-capture";
import { selectFocusedPaneId } from "../../state/selectors-ui";
import { findPaneInstance } from "../../types/config";
import { buildHeaderTickerSearchLaunch, HEADER_TICKER_PLACEHOLDER } from "./header-ticker";

export { buildHeaderTickerSearchLaunch, HEADER_TICKER_PLACEHOLDER } from "./header-ticker";

export function HeaderTickerSlot() {
  const colors = useThemeColors();
  const dispatch = useAppDispatch();
  const focusedPaneId = useAppSelector(selectFocusedPaneId);
  const layout = useAppSelector((state) => state.config.layout);
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<InputRenderable | null>(null);
  useAppInputCapture(focused);

  const submit = useCallback((raw?: string) => {
    const focusedPane = focusedPaneId ? findPaneInstance(layout, focusedPaneId) : null;
    const query = typeof raw === "string" ? raw : value;
    dispatch({
      type: "SET_COMMAND_BAR",
      open: true,
      query: "",
      launch: buildHeaderTickerSearchLaunch(query, focusedPane),
    });
    setValue("");
    setFocused(false);
    inputRef.current?.blur?.();
  }, [dispatch, focusedPaneId, layout, value]);

  const stopHeaderDrag = useCallback((event?: { preventDefault?: () => void; stopPropagation?: () => void }) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
  }, []);

  const placeholderColor = blendHex(colors.headerText, colors.header, 0.55);
  const borderColor = focused
    ? blendHex(colors.border, colors.headerText, 0.55)
    : blendHex(colors.border, colors.headerText, 0.28);

  return (
    <Box
      height={1}
      flexDirection="row"
      alignItems="center"
      data-gloom-role="header-ticker-slot"
      data-gloom-interactive="true"
      className="electrobun-webkit-app-region-no-drag"
      onMouseDown={(event: any) => {
        stopHeaderDrag(event);
        inputRef.current?.focus?.();
      }}
      style={{
        border: `1px solid ${borderColor}`,
        borderRadius: 5,
        paddingInline: 8,
        minWidth: 132,
        backgroundColor: blendHex(colors.header, colors.headerText, focused ? 0.14 : 0.08),
        cursor: "text",
      }}
    >
      <Input
        ref={inputRef as RefObject<InputRenderable>}
        value={value}
        placeholder={HEADER_TICKER_PLACEHOLDER}
        placeholderColor={placeholderColor}
        textColor={colors.headerText}
        focusedTextColor={colors.headerText}
        backgroundColor="transparent"
        focusedBackgroundColor="transparent"
        cursorColor={colors.headerText}
        width={16}
        aria-label="Ticker"
        data-gloom-role="header-ticker-input"
        style={{ fontSize: 12, fontWeight: 600 }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onInput={setValue}
        onChange={setValue}
        onSubmit={submit}
        onEscape={() => {
          setValue("");
          setFocused(false);
          inputRef.current?.blur?.();
        }}
      />
    </Box>
  );
}
