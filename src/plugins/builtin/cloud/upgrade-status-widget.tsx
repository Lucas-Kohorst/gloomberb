import { t, tf } from "../../../i18n";
import { useAppLanguage } from "../../../i18n/react";
import { useAppSelector } from "../../../state/app/context";
import { colors } from "../../../theme/colors";
import { Box, Text, useUiCapabilities } from "../../../ui";
import { useCloudPlanAction, useCloudUpgradeAction } from "../shared/cloud-upgrade";
import { usePlanAccess } from "../shared/plan-access";

/**
 * Global entitlement status: the trial countdown while Pro is on loan, or an
 * upgrade CTA for free accounts. Signed-out users already have sign-in
 * affordances next to it, and paying subscribers have nothing to report.
 */
export function CloudUpgradeStatusWidget() {
  useAppLanguage();
  const { nativePaneChrome = false } = useUiCapabilities();
  const cloudPluginDisabled = useAppSelector((state) => state.config.disabledPlugins).includes("gloomberb-cloud");
  const openUpgrade = useCloudUpgradeAction();
  const openPlan = useCloudPlanAction();
  const access = usePlanAccess();

  if (cloudPluginDisabled || !access.signedIn || !access.accountKnown || access.isPayingPro) return null;

  const trial = access.isTrialActive;
  const tone = trial ? colors.positive : colors.warning;

  return (
    <Box
      flexDirection="row"
      alignItems="center"
      paddingRight={nativePaneChrome ? 0 : 1}
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
        <Text fg={tone}>
          {nativePaneChrome ? t("upgrade") : ` ${t("upgrade")}`}
        </Text>
      )}
    </Box>
  );
}
