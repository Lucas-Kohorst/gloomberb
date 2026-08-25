import { useEffect, useState } from "react";
import { apiClient } from "../../../api-client";
import { t, tf } from "../../../i18n";
import { useAppLanguage } from "../../../i18n/react";
import { useAppSelector } from "../../../state/app/context";
import { colors, hoverBg } from "../../../theme/colors";
import { Box, Text, useUiCapabilities } from "../../../ui";
import { chatController, type ChatController } from "../chat/controller";
import { useCloudPlanAction, useCloudUpgradeAction } from "../shared/cloud-upgrade";
import { resolvePlanAccess } from "../shared/plan-access";

interface CloudUpgradeStatusWidgetProps {
  controller?: Pick<ChatController, "getSnapshot" | "subscribe">;
}

/**
 * Global entitlement status: the trial countdown while Pro is on loan, or an
 * upgrade CTA for free accounts. Signed-out users already have sign-in
 * affordances next to it, and paying subscribers have nothing to report.
 */
export function CloudUpgradeStatusWidget({ controller = chatController }: CloudUpgradeStatusWidgetProps) {
  useAppLanguage();
  const { nativePaneChrome = false } = useUiCapabilities();
  const cloudPluginDisabled = useAppSelector((state) => state.config.disabledPlugins).includes("gloomberb-cloud");
  const openUpgrade = useCloudUpgradeAction();
  const openPlan = useCloudPlanAction();
  const [access, setAccess] = useState(() => resolvePlanAccess(apiClient.getCurrentUser()));
  const [hovered, setHovered] = useState(false);

  useEffect(
    // The chat widget already drives session refreshes; this only follows them.
    () => controller.subscribe(() => setAccess(resolvePlanAccess(apiClient.getCurrentUser()))),
    [controller],
  );

  if (cloudPluginDisabled || !access.signedIn || access.isPayingPro) return null;

  const trial = access.isTrialActive;
  const tone = trial ? colors.positive : colors.warning;

  return (
    <Box
      flexDirection="row"
      alignItems="center"
      paddingRight={nativePaneChrome ? 0 : 1}
      backgroundColor={hovered ? hoverBg() : undefined}
      onMouseOver={() => setHovered((current) => (current ? current : true))}
      onMouseOut={() => setHovered((current) => (current ? false : current))}
      onMouseDown={trial ? openPlan : openUpgrade}
      data-gloom-role="status-upgrade"
      data-gloom-interactive="true"
      {...(nativePaneChrome ? {
        style: { cursor: "pointer", gap: 6, borderRadius: 4, paddingInline: 2 },
      } : {})}
    >
      {trial ? (
        <Text fg={tone}>{tf("Pro trial {days}d", { days: access.trialDaysLeft })}</Text>
      ) : (
        <Text fg={hovered ? colors.textBright : tone}>
          {nativePaneChrome ? t("upgrade") : ` ${t("upgrade")}`}
        </Text>
      )}
    </Box>
  );
}
