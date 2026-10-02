import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, ScrollBox, Text } from "../../ui";
import { type PromptContext, useDialogContentSize, useDialogKeyboard } from "../../ui/dialog";
import { colors } from "../../theme/colors";
import { t } from "../../i18n";
import { isPlainKey } from "../../utils/keyboard";
import { displayWidth } from "../../utils/format";
import { wrapTextLines } from "../../utils/text-wrap";
import { DialogFrame } from "./frame";
import { ListView, type ListViewItem } from "./list-view";

export interface ChoiceDialogChoice {
  id: string;
  label: string;
  description?: string;
  detail?: string;
  disabled?: boolean;
}

export interface ChoiceDialogProps extends PromptContext<string> {
  title: string;
  choices: ChoiceDialogChoice[];
  selectedChoiceId?: string;
  footer?: string;
  bgColor?: string;
}

const MAX_VISIBLE_CHOICE_ROWS = 12;

function clampChoiceIndex(index: number, length: number): number {
  if (length <= 0) return -1;
  return Math.max(0, Math.min(length - 1, index));
}

function getChoiceDescription(choice: ChoiceDialogChoice | undefined): string {
  return choice?.description ?? "";
}

function getInitialChoiceIndex(choices: ChoiceDialogChoice[], selectedChoiceId: string | undefined): number {
  if (!selectedChoiceId) return 0;
  const selectedIndex = choices.findIndex((choice) => choice.id === selectedChoiceId);
  return selectedIndex >= 0 ? selectedIndex : 0;
}

function choiceDialogWidth(title: string, choices: ChoiceDialogChoice[]): number {
  const contentWidth = Math.max(
    displayWidth(title),
    ...choices.map((choice) => displayWidth(choice.label) + (choice.detail ? displayWidth(choice.detail) + 4 : 0)),
    ...choices.map((choice) => displayWidth(getChoiceDescription(choice))),
  );
  return Math.max(34, Math.min(76, contentWidth + 4));
}

export function ChoiceDialog({
  resolve,
  title,
  choices,
  selectedChoiceId,
  footer,
  bgColor = colors.bg,
}: ChoiceDialogProps) {
  const [index, setIndex] = useState(() =>
    clampChoiceIndex(getInitialChoiceIndex(choices, selectedChoiceId), choices.length)
  );
  const selectedIndex = clampChoiceIndex(index, choices.length);
  const cursorRef = useRef(selectedIndex);
  const selectIndex = useCallback((next: number) => {
    cursorRef.current = clampChoiceIndex(next, choices.length);
    setIndex(cursorRef.current);
  }, [choices.length]);
  const selectedChoice = selectedIndex >= 0 ? choices[selectedIndex] : undefined;
  const items = useMemo<ListViewItem[]>(() => choices.map((choice) => ({
    id: choice.id,
    label: choice.label,
    description: getChoiceDescription(choice),
    detail: choice.detail,
    disabled: choice.disabled,
  })), [choices]);
  const contentSize = useDialogContentSize();
  const preferredWidth = useMemo(() => choiceDialogWidth(title, choices), [choices, title]);
  const width = Math.min(preferredWidth, contentSize?.width ?? preferredWidth);
  const description = getChoiceDescription(selectedChoice);
  const bodyHeight = Math.max(1, (contentSize?.height ?? 20) - 2 - (footer ? 2 : 0));
  const descriptionHeight = description
    ? Math.min(wrapTextLines(description, width).length, 3, Math.max(0, bodyHeight - 2))
    : 0;
  const listHeight = Math.max(1, Math.min(
    Math.max(items.length, 1), MAX_VISIBLE_CHOICE_ROWS,
    bodyHeight - (descriptionHeight > 0 ? descriptionHeight + 1 : 0),
  ));

  useEffect(() => {
    selectIndex(cursorRef.current);
  }, [selectIndex]);

  const activateChoice = (choice: ChoiceDialogChoice | undefined) => {
    if (!choice || choice.disabled) return;
    resolve(choice.id);
  };

  useDialogKeyboard((event) => {
    event.stopPropagation();
    if (isPlainKey(event, "up", "k")) {
      selectIndex(cursorRef.current - 1);
    } else if (isPlainKey(event, "down", "j")) {
      selectIndex(cursorRef.current + 1);
    } else if (event.name === "enter" || event.name === "return") {
      activateChoice(choices[clampChoiceIndex(cursorRef.current, choices.length)]);
    } else if (event.name === "escape") {
      resolve("");
    }
  });

  return (
    <DialogFrame title={title} footer={footer} showTitleDivider={false}>
      <Box flexDirection="column" width={width}>
        <ListView
          items={items}
          selectedIndex={selectedIndex}
          bgColor={bgColor}
          emptyMessage={t("No choices.")}
          rowGap={0}
          surface="framed"
          height={listHeight}
          scrollable={items.length > listHeight}
          selectOnHover
          onSelect={selectIndex}
          onActivate={(_, nextIndex) => activateChoice(choices[nextIndex])}
        />
        {!contentSize ? <>
          <Box height={1} />
          <Text fg={colors.textDim}>{description}</Text>
        </> : descriptionHeight > 0 ? <>
          <Box height={1} />
          <ScrollBox key={selectedChoice?.id} height={descriptionHeight} scrollY focusable={false}>
            <Text fg={colors.textDim} wrapText wrapMode="word" width={width}>{description}</Text>
          </ScrollBox>
        </> : null}
      </Box>
    </DialogFrame>
  );
}
