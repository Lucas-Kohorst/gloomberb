import { useMemo } from "react";
import { Box, useUiHost } from "../../../ui";
import { t } from "../../../i18n";
import { useAppLanguage } from "../../../i18n/react";
import type { ListViewItem } from "../../ui";
import { OnboardingChoiceList } from "../onboarding-frame";
import { accountChoiceIds } from "./model";

export function AccountChooserPanel({
  choiceIdx,
  requireAccount = false,
  onChoiceSelect,
  onChoiceActivate,
}: {
  choiceIdx: number;
  requireAccount?: boolean;
  onChoiceSelect: (index: number) => void;
  onChoiceActivate: (index: number) => void;
}) {
  const language = useAppLanguage();
  const desktop = useUiHost().kind === "desktop-web";
  const choiceIds = accountChoiceIds(requireAccount);
  const labels: Record<string, string> = {
    qr: t("Scan QR with the mobile app"),
    signup: t("Sign up free"),
    login: t("Log in"),
    skip: t("Not now"),
  };
  const descriptions: Record<string, string> = {
    qr: t("Approve from your phone, no typing"),
    signup: t("Create an account, then verify your email"),
    login: t("Use an existing account"),
    skip: t("Keep this workspace local for now"),
  };
  const choices = useMemo<ListViewItem[]>(() => (
    choiceIds.map((id) => ({ id, label: labels[id]!, description: descriptions[id]! }))
  ), [language, requireAccount]);
  return (
    <Box flexDirection="column" paddingX={desktop ? 0 : 2} style={desktop ? { marginTop: 10 } : undefined}>
      <OnboardingChoiceList
        items={choices}
        selectedIndex={choiceIdx}
        onSelect={onChoiceSelect}
        onActivate={onChoiceActivate}
      />
    </Box>
  );
}
