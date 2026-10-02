import { useMemo } from "react";
import { useShortcut } from "../../react/input";
import { isPlainKey } from "../../utils/keyboard";
import { Tabs } from "../ui/tabs";

export function ChartRangeTabs<T extends string>({
  choices,
  value,
  onSelect,
  focused,
  keyboardShortcuts = true,
}: {
  choices: readonly { value: T; disabled?: boolean }[];
  value: T | null;
  onSelect: (value: T) => void;
  focused: boolean;
  keyboardShortcuts?: boolean;
}) {
  const tabs = useMemo(() => choices.map((choice, index) => ({
    ...choice,
    label: `${index + 1}:${choice.value}`,
  })), [choices]);
  useShortcut((event) => {
    if (!focused || event.targetEditable || event.defaultPrevented || event.propagationStopped) return;
    if (!isPlainKey(event, event.name ?? "")) return;
    const index = Number(event.name) - 1;
    const choice = Number.isInteger(index) ? choices[index] : undefined;
    if (!choice || choice.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(choice.value);
  }, { enabled: focused && keyboardShortcuts });

  return (
    <Tabs
      tabs={tabs}
      activeValue={value}
      onSelect={(next) => {
        const choice = choices.find((entry) => entry.value === next);
        if (choice && !choice.disabled) onSelect(choice.value);
      }}
      compact dense variant="bare" focused={focused} keyboardNavigation={false}
    />
  );
}
