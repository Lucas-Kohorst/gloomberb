import { useMemo } from "react";
import { usePaneFooter, type PaneHint } from "../../../components";
import { t } from "../../../i18n";
import { useAppLanguage } from "../../../i18n/react";

export function useAccountManagementFooter({
  busy,
  hasSession,
  message,
  saveProfile,
}: {
  busy: "profile" | "password" | "alerts" | "billing" | "delete" | null;
  hasSession: boolean;
  message: { tone: "info" | "success" | "error"; text: string } | null;
  saveProfile: () => Promise<void>;
}) {
  const language = useAppLanguage();
  const footerHints = useMemo<PaneHint[]>(() => [
    { id: "save", key: "Ctrl+S", label: t("save"), onPress: () => { void saveProfile(); }, disabled: !!busy || !hasSession },
  ], [busy, hasSession, language, saveProfile]);

  usePaneFooter("account-management", () => ({
    info: message
      ? [{ id: "status", parts: [{ text: message.text, tone: message.tone === "error" ? "negative" as const : message.tone === "success" ? "positive" as const : "muted" as const }] }]
      : [],
    hints: footerHints,
  }), [footerHints, language, message]);
}
