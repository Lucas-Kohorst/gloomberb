import { useCallback, useMemo, useRef } from "react";
import { Button, ChoiceDialog } from "../../../components";
import { Box, Text, TextAttributes } from "../../../ui";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import { useDialog, type PromptContext } from "../../../ui/dialog";
import { colors } from "../../../theme/colors";
import { FONT_FAMILIES, getFontFamily } from "../../../theme/font-family";
import { getTheme } from "../../../theme/themes";
import { clampFontSize, MAX_FONT_SIZE_PX, MIN_FONT_SIZE_PX } from "../../../theme/font-scale";
import { t, tf } from "../../../i18n";
import { openNativeSelect, type NativeSelectElement } from "../../../components/ui/native-select";
import { SelectRow } from "./form-components";
import {
  cycleChoice,
  fontFamilyChoices,
  fontSizeBoundsLabel,
  nextFontSize,
  themeChoices,
} from "./display";
import type { AccountFieldKey } from "./model";

export function DisplayTab({
  activeField,
  focused,
  fontFamily,
  fontSize,
  isDesktop,
  setActiveField,
  setFontFamily,
  setFontSize,
  setTheme,
  theme,
  width,
}: {
  activeField: AccountFieldKey;
  focused: boolean;
  fontFamily: string;
  fontSize: number;
  isDesktop: boolean;
  setActiveField: (field: AccountFieldKey) => void;
  setFontFamily: (id: string) => void;
  setFontSize: (size: number) => void;
  setTheme: (id: string) => void;
  theme: string;
  width: number;
}) {
  const dialog = useDialog();
  const themeSelectRef = useRef<NativeSelectElement | null>(null);
  const fontSelectRef = useRef<NativeSelectElement | null>(null);
  const themes = useMemo(() => themeChoices(), []);
  const families = useMemo(() => fontFamilyChoices(), []);
  const size = clampFontSize(fontSize);
  const bound = fontSizeBoundsLabel(size);

  const openThemePicker = useCallback(async () => {
    setActiveField("themeAction");
    if (isDesktop) {
      openNativeSelect(themeSelectRef.current);
      return;
    }
    const selected = await dialog.prompt<string>({
      closeOnClickOutside: true,
      content: (context: PromptContext<string>) => (
        <ChoiceDialog
          {...context}
          title={t("Theme")}
          choices={themes.map((choice) => ({
            id: choice.id,
            label: choice.label,
            description: choice.description,
          }))}
          selectedChoiceId={theme}
        />
      ),
    }).catch(() => null);
    if (selected) setTheme(selected);
  }, [dialog, isDesktop, setActiveField, setTheme, theme, themes]);

  const openFontPicker = useCallback(async () => {
    setActiveField("fontFamilyAction");
    if (isDesktop) {
      openNativeSelect(fontSelectRef.current);
      return;
    }
    const selected = await dialog.prompt<string>({
      closeOnClickOutside: true,
      content: (context: PromptContext<string>) => (
        <ChoiceDialog
          {...context}
          title={t("Font")}
          choices={families.map((choice) => ({
            id: choice.id,
            label: choice.label,
            description: choice.description,
          }))}
          selectedChoiceId={fontFamily}
        />
      ),
    }).catch(() => null);
    if (selected) setFontFamily(selected);
  }, [dialog, families, fontFamily, isDesktop, setActiveField, setFontFamily]);

  const bumpSize = useCallback((delta: number) => {
    setActiveField("fontSizeAction");
    setFontSize(nextFontSize(size, delta));
  }, [setActiveField, setFontSize, size]);

  useShortcut((event) => {
    if (!focused) return;
    if (!event.targetEditable && activeField === "themeAction" && isPlainKey(event, "space", "enter", "return")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      void openThemePicker();
      return;
    }
    if (!event.targetEditable && activeField === "fontFamilyAction" && isPlainKey(event, "space", "enter", "return")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      void openFontPicker();
    }
  }, { allowEditable: true });

  return (
    <>
      <Text fg={colors.textMuted} wrapText width={width}>
        {t("Theme, typeface, and size apply to web and desktop. The terminal keeps the emulator font.")}
      </Text>
      <SelectRow
        label={t("Theme")}
        value={theme}
        options={themes.map((choice) => ({
          value: choice.id,
          label: choice.label,
          description: choice.description,
        }))}
        active={activeField === "themeAction"}
        width={width}
        selectRef={(element) => {
          themeSelectRef.current = element;
        }}
        onFocus={() => {
          setActiveField("themeAction");
          if (!isDesktop) void openThemePicker();
        }}
        onChange={setTheme}
      />
      <Text fg={colors.textDim} wrapText width={width}>
        {getTheme(theme).description || getTheme(theme).name}
      </Text>
      <SelectRow
        label={t("Font")}
        value={fontFamily}
        options={families.map((choice) => ({
          value: choice.id,
          label: choice.label,
          description: choice.description,
        }))}
        active={activeField === "fontFamilyAction"}
        width={width}
        selectRef={(element) => {
          fontSelectRef.current = element;
        }}
        onFocus={() => {
          setActiveField("fontFamilyAction");
          if (!isDesktop) void openFontPicker();
        }}
        onChange={setFontFamily}
      />
      <Text fg={colors.textDim} wrapText width={width}>
        {getFontFamily(fontFamily).description}
      </Text>
      <Box
        height={1}
        width={width}
        flexDirection="row"
        alignItems="center"
        gap={1}
        onMouseDown={() => setActiveField("fontSizeAction")}
      >
        <Text
          width={16}
          fg={activeField === "fontSizeAction" ? colors.textBright : colors.textDim}
          attributes={activeField === "fontSizeAction" ? TextAttributes.BOLD : 0}
        >
          {activeField === "fontSizeAction" ? `> ${t("Size")}` : `  ${t("Size")}`}
        </Text>
        <Button
          label="-"
          width={5}
          disabled={size <= MIN_FONT_SIZE_PX}
          onPress={() => bumpSize(-1)}
        />
        <Text fg={colors.textBright} width={8}>
          {tf("{size}px", { size })}
        </Text>
        <Button
          label="+"
          width={5}
          disabled={size >= MAX_FONT_SIZE_PX}
          onPress={() => bumpSize(1)}
        />
        {bound ? <Text fg={colors.textMuted}>{bound}</Text> : null}
      </Box>
      <Text fg={colors.textMuted} wrapText width={width}>
        {t("FONT+ / FONT- in the command bar scale the same size.")}
      </Text>
    </>
  );
}

export function cycleDisplayFieldValue(
  field: AccountFieldKey,
  delta: number,
  current: { theme: string; fontFamily: string; fontSize: number },
): { theme?: string; fontFamily?: string; fontSize?: number } | null {
  if (field === "themeAction") {
    return { theme: cycleChoice(themeChoices().map((choice) => choice.id), current.theme, delta) };
  }
  if (field === "fontFamilyAction") {
    return { fontFamily: cycleChoice(Object.keys(FONT_FAMILIES), current.fontFamily, delta) };
  }
  if (field === "fontSizeAction") {
    return { fontSize: nextFontSize(current.fontSize, delta) };
  }
  return null;
}
