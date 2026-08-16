import { type ComponentType, useMemo } from "react";
import { Box, Text, TextAttributes, useUiHost, type HostCheckboxProps } from "../../ui";
import { colors, hoverBg } from "../../theme/colors";
import { useRemoteUiNode } from "../../remote/semantic-tree";

export type CheckboxProps = HostCheckboxProps;

export function Checkbox({
  label,
  displayLabel,
  checked,
  onChange,
  disabled = false,
  active = false,
  description,
  width,
  variant = "default",
}: CheckboxProps) {
  const registration = useMemo(() => ({
    role: "checkbox" as const,
    label,
    disabled,
    actions: {
      toggle: () => {
        if (!disabled) onChange?.(!checked);
      },
      press: () => {
        if (!disabled) onChange?.(!checked);
      },
    },
    metadata: { checked, active, variant },
  }), [label, disabled, onChange, checked, active, variant]);
  useRemoteUiNode(registration);

  const HostCheckbox = useUiHost().Checkbox as ComponentType<CheckboxProps> | undefined;
  if (HostCheckbox) {
    return (
      <HostCheckbox
        label={label}
        displayLabel={displayLabel}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        active={active}
        description={description}
        width={width}
        variant={variant}
      />
    );
  }

  const marker = checked ? "\u2713" : " ";
  const visibleLabel = displayLabel ?? label;
  const fg = disabled ? colors.textMuted : active ? colors.textBright : colors.text;
  const descriptionWidth = typeof width === "number" ? Math.max(20, width - 2) : 28;
  return (
    <Box
      flexDirection="column"
      width={width}
      backgroundColor={active && !disabled ? hoverBg() : undefined}
      onMouseDown={(event?: { preventDefault?: () => void; stopPropagation?: () => void }) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (!disabled) onChange?.(!checked);
      }}
    >
      <Text fg={fg} attributes={active ? TextAttributes.BOLD : 0}>
        {`${active ? "> " : "  "}[${marker}] ${visibleLabel}`}
      </Text>
      {description ? (
        <Text fg={colors.textMuted} wrapText width={descriptionWidth}>
          {description}
        </Text>
      ) : null}
    </Box>
  );
}
