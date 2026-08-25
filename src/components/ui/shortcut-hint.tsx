import { StyledText, Text, TextAttributes, useUiCapabilities } from "../../ui";
import { colors } from "../../theme/colors";
import { useRef } from "react";
import {
  getShortcutHintWidth,
  normalizeShortcutHint,
} from "./shortcut-hint-format";

export {
  getShortcutHintWidth,
  normalizeShortcutHint,
  shortcutHintDisplayText,
} from "./shortcut-hint-format";

type ShortcutHintMouseEvent = {
  pixelX?: number;
  pixelY?: number;
  stopPropagation?: () => void;
  preventDefault?: () => void;
};

export interface ShortcutHintProps {
  hotkey: string;
  label: string;
  prefix?: string;
  disabled?: boolean;
  dataGloomRole?: string;
  onPress?: (event?: ShortcutHintMouseEvent) => void;
}

function stopMouseEvent(event?: ShortcutHintMouseEvent) {
  event?.stopPropagation?.();
  event?.preventDefault?.();
}

export function ShortcutHint({
  hotkey,
  label,
  prefix = "",
  disabled = false,
  dataGloomRole,
  onPress,
}: ShortcutHintProps) {
  const { nativePaneChrome = false } = useUiCapabilities();
  const interactive = !!onPress && !disabled;
  const keyColor = disabled ? colors.textMuted : colors.textBright;
  const labelColor = disabled ? colors.textMuted : colors.textDim;
  const hint = normalizeShortcutHint(hotkey, label);
  const keyText = `[${hint.hotkey}]`;
  const triggerMouseDownRef = useRef(false);
  const startPress = (event?: ShortcutHintMouseEvent) => {
    triggerMouseDownRef.current = true;
    stopMouseEvent(event);
  };
  const finishPress = (event?: ShortcutHintMouseEvent) => {
    const startedOnTrigger = triggerMouseDownRef.current;
    triggerMouseDownRef.current = false;
    if (startedOnTrigger) onPress?.(event);
    else stopMouseEvent(event);
  };

  return (
    <Text
      {...(nativePaneChrome ? {} : { width: getShortcutHintWidth(hotkey, label, prefix) })}
      content={new StyledText([
        ...(prefix ? [{ text: prefix, fg: labelColor }] : []),
        { text: keyText, fg: keyColor },
        ...(hint.glue ? [{ text: hint.glue, fg: labelColor }] : []),
        { text: hint.label, fg: labelColor },
      ])}
      fg={disabled ? colors.textMuted : colors.textDim}
      attributes={interactive ? TextAttributes.BOLD : 0}
      onMouseDown={interactive ? startPress : undefined}
      onMouseUp={interactive ? finishPress : undefined}
      {...(dataGloomRole ? { "data-gloom-role": dataGloomRole } : {})}
    />
  );
}
