import { loadingText } from "../../../components/ui/status-copy";
import { formatObservationAge } from "../../../utils/datetime-format";

export function briefFooterInfo(input: {
  loading?: boolean;
  error?: string | null;
  stale?: boolean;
  asOf?: string | null;
}): string {
  if (input.loading) return loadingText();
  const error = input.error?.trim();
  if (error) return error;
  const age = formatObservationAge(input.asOf);
  if (age) return age;
  return input.stale ? "" : "Live";
}
