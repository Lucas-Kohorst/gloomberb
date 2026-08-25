import { Box, Text } from "../../../../ui";
import { useState, type ReactNode } from "react";
import { colors } from "../../../../theme/colors";
import { ChoiceDialog } from "../../../ui/choice-dialog";
import { Popover } from "../../../ui/popover";
import type { DialogApi } from "../../../../ui/dialog";
import type { PaneFooterSelectMenu } from "./model";

export const FOOTER_SELECT_MENU_TITLE = "Refresh interval";

export async function openFooterSelectMenu(
  dialog: DialogApi | null,
  menu: PaneFooterSelectMenu,
): Promise<void> {
  if (!dialog) return;
  const selected = await dialog.prompt<string>({
    closeOnClickOutside: true,
    content: (context) => (
      <ChoiceDialog
        {...context}
        title={FOOTER_SELECT_MENU_TITLE}
        choices={menu.options.map((option) => ({
          id: option.value,
          label: option.label,
        }))}
        selectedChoiceId={menu.value}
      />
    ),
  }).catch(() => null);
  if (selected) menu.onSelect(selected);
}

function FooterSelectMenuList({
  menu,
  onClose,
}: {
  menu: PaneFooterSelectMenu;
  onClose: () => void;
}) {
  const [hoveredValue, setHoveredValue] = useState<string | null>(null);

  return (
    <Box
      flexDirection="column"
      data-gloom-role="pane-footer-select-menu"
      style={{
        padding: "4px 0",
        minWidth: 148,
      }}
    >
      {menu.options.map((option) => {
        const selected = option.value === menu.value;
        const hovered = hoveredValue === option.value;
        return (
          <Box
            key={option.value}
            height={1}
            flexDirection="row"
            alignItems="center"
            backgroundColor={hovered || selected ? colors.selected : "transparent"}
            onMouseOver={() => setHoveredValue(option.value)}
            onMouseOut={() => setHoveredValue((current) => (current === option.value ? null : current))}
            onMouseDown={(event: { stopPropagation?: () => void; preventDefault?: () => void }) => {
              event.stopPropagation?.();
              event.preventDefault?.();
              menu.onSelect(option.value);
              onClose();
            }}
            data-gloom-interactive="true"
            data-gloom-role="pane-footer-select-option"
            style={{
              cursor: "pointer",
              padding: "4px 10px",
              borderRadius: 4,
            }}
          >
            <Text fg={hovered || selected ? colors.selectedText : colors.text}>
              {option.label}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

export function FooterSelectMenuPopover({
  open,
  onOpenChange,
  menu,
  trigger,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  menu: PaneFooterSelectMenu;
  trigger: ReactNode;
}) {
  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      trigger={trigger}
      placement="bottom-end"
      minWidth={148}
      maxWidth={240}
      label={FOOTER_SELECT_MENU_TITLE}
    >
      <FooterSelectMenuList menu={menu} onClose={() => onOpenChange(false)} />
    </Popover>
  );
}
