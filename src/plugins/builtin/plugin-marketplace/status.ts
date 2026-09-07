import { colors } from "../../../theme/colors";
import type { MarketplaceEntry } from "./model";
import { unsupportedLabel } from "./model";

export function statusOf(
  entry: MarketplaceEntry,
  installedNow: readonly string[],
): { text: string; color: string } {
  if (installedNow.includes(entry.id)) return { text: "restart to load", color: colors.warning };
  if (entry.loadError) return { text: "failed", color: colors.negative };
  const unsupported = unsupportedLabel(entry);
  if (unsupported) return { text: unsupported.toLowerCase(), color: colors.warning };
  if (entry.bundled) return { text: "included", color: colors.textDim };
  if (entry.installed) {
    return entry.enabled
      ? { text: "enabled", color: colors.positive }
      : { text: "disabled", color: colors.textDim };
  }
  return { text: "available", color: colors.textBright };
}
