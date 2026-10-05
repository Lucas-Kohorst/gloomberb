import type { ReactNode } from "react";
import { Box, Text } from "../../../ui";
import { ChoiceDialog, ConfirmDialog } from "../../../components";
import { colors } from "../../../theme/colors";
import { type DialogApi, type PromptContext } from "../../../ui/dialog";

export function Notice({ children, tone = "warning" }: { children: ReactNode; tone?: "warning" | "negative" }) {
  return (
    <Text fg={tone === "negative" ? colors.negative : colors.warning} wrapText>
      {children}
    </Text>
  );
}

export function KeyValueRow({
  label,
  value,
  detail,
  labelWidth = 24,
}: {
  label: string;
  value: string;
  detail?: string;
  labelWidth?: number;
}) {
  return (
    <Box flexDirection="row" gap={1}>
      <Box width={labelWidth} flexShrink={0}>
        <Text fg={colors.textDim}>{label}</Text>
      </Box>
      <Text>{value}</Text>
      {detail ? <Text fg={colors.textDim}>{detail}</Text> : null}
    </Box>
  );
}

export async function chooseOption(
  dialog: DialogApi,
  title: string,
  value: string,
  options: readonly { value: string; label: string }[],
): Promise<string | undefined> {
  const next = await dialog.prompt<string>({
    closeOnClickOutside: true,
    content: (context: PromptContext<string>) => (
      <ChoiceDialog
        {...context}
        title={title}
        selectedChoiceId={value}
        choices={options.map((option) => ({ id: option.value, label: option.label }))}
      />
    ),
  }).catch(() => undefined);
  return next || undefined;
}

export async function confirmDelete(dialog: DialogApi, name: string): Promise<boolean> {
  const confirmed = await dialog.prompt<boolean>({
    closeOnClickOutside: false,
    content: (context: PromptContext<boolean>) => (
      <ConfirmDialog
        {...context}
        title="Delete saved screen?"
        body={[name]}
        confirmLabel="Delete"
      />
    ),
  }).catch(() => false);
  return confirmed === true;
}
