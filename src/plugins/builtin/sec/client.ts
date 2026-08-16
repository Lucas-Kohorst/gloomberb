import { SecEdgarClient } from "../../../sources/sec-edgar";
import type { SecFilingItem } from "../../../types/data-provider";
import { withConnectionRequest } from "../connections/register";

const SEC_BROWSER_LIMIT = 50;
const client = new SecEdgarClient();

export function loadSecBrowserFilings(query: string): Promise<SecFilingItem[]> {
  const normalized = query.trim();
  return withConnectionRequest("sec-edgar", "fetch", () => (
    normalized
      ? client.searchFilings(normalized, SEC_BROWSER_LIMIT)
      : client.getLatestFilings(SEC_BROWSER_LIMIT)
  ));
}
