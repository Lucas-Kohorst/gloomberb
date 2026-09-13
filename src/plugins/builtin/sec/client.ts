import { SecEdgarClient } from "../../../sources/sec-edgar";
import type { SecFilingItem } from "../../../types/data-provider";
import { withConnectionRequest } from "../connections/register";

const SEC_BROWSER_LIMIT = 50;
const client = new SecEdgarClient();

export function loadSecBrowserFilings(
  query: string,
  options: { forms?: readonly string[]; windowDays?: number } = {},
): Promise<SecFilingItem[]> {
  const normalized = query.trim();
  const forms = options.forms && options.forms.length > 0 ? options.forms : undefined;
  return withConnectionRequest("sec-edgar", "fetch", () => (
    normalized
      ? client.searchFilings(normalized, SEC_BROWSER_LIMIT, { forms, windowDays: options.windowDays })
      : client.getLatestFilings(SEC_BROWSER_LIMIT, { forms, windowDays: options.windowDays })
  ));
}
