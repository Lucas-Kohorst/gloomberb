import { Box } from "../ui";
import { Tabs, type TabsProps } from "./ui/tabs";

export interface PaneTabHeaderTab {
  label: string;
  value: string;
  disabled?: boolean;
}

export function PaneTabHeader({
  width,
  focused,
  tabs,
  activeValue,
  onSelect,
  scrollable = false,
}: {
  width: number;
  focused: boolean;
  tabs: readonly PaneTabHeaderTab[];
  activeValue: string | null;
  onSelect: (value: string) => void;
  scrollable?: boolean;
}) {
  return (
    <Box width={width} height={1} flexShrink={0} data-gloom-role="pane-tab-header">
      <Tabs
        tabs={[...tabs]}
        activeValue={activeValue}
        onSelect={onSelect}
        focused={focused}
        compact
        variant="underline"
        scrollable={scrollable}
      />
    </Box>
  );
}

export type { TabsProps };
