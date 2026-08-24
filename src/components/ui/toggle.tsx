import { Box, Text, TextAttributes, useUiHost } from "../../ui";
import { type ComponentType } from "react";
import { colors } from "../../theme/colors";
import { useShortcut } from "../../react/input";
import { isPlainKey } from "../../utils/keyboard";

interface SegmentedControlOption {
  label: string;
  value: string;
  disabled?: boolean;
}

export interface SegmentedControlProps {
  options: SegmentedControlOption[];
  value: string;
  onChange?: (value: string) => void;
  focused?: boolean;
  shortcutScope?: string;
  width?: number | "100%";
  wrap?: boolean;
}

export function SegmentedControl({
  options,
  value,
  onChange,
  focused = false,
  shortcutScope,
  width,
  wrap = false,
}: SegmentedControlProps) {
  const ui = useUiHost();
  const HostSegmentedControl = ui.SegmentedControl as ComponentType<SegmentedControlProps> | undefined;
  useShortcut((event) => {
    const direction = isPlainKey(event, "left")
      ? -1
      : isPlainKey(event, "right")
        ? 1
        : 0;
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();

    const enabled = options.filter((option) => !option.disabled);
    if (enabled.length === 0) return;
    const index = enabled.findIndex((option) => option.value === value);
    const nextIndex = index < 0
      ? 0
      : (index + direction + enabled.length) % enabled.length;
    const next = enabled[nextIndex];
    if (next && next.value !== value) onChange?.(next.value);
  }, {
    enabled: ui.kind !== "desktop-web" && focused && !!onChange,
    phase: "before",
    scope: shortcutScope,
  });

  if (HostSegmentedControl) {
    return (
      <HostSegmentedControl
        options={options}
        value={value}
        onChange={onChange}
      />
    );
  }

  return (
    <Box
      flexDirection="row"
      flexWrap={wrap ? "wrap" : "nowrap"}
      width={width}
      overflow="hidden"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Box
            key={option.value}
            backgroundColor={colors.panel}
            onMouseDown={() => {
              if (!option.disabled) onChange?.(option.value);
            }}
            cursor={option.disabled ? undefined : "pointer"}
          >
            <Text
              fg={option.disabled ? colors.textMuted : active ? colors.text : colors.textDim}
              attributes={active ? TextAttributes.BOLD : 0}
            >
              {` ${option.label} `}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
