/**
 * Terminal-side view of share URLs.
 *
 * The payload model and URL shapes live in `src/shares`, which the slim share
 * page also imports; this module is only the part that needs a browser location.
 */

import { getBrowserLocation } from "../../../utils/browser-location";
import { decodeArticleSharePayload } from "../../../shares/payload";
import { parseShortShareId } from "../../../shares/routes";

export {
  SHARE_HOSTED_ORIGIN,
  buildShortShareUrl,
  buildTerminalShareUrl,
  parseShortShareId,
} from "../../../shares/routes";
export type { ChartSharePayload, ShareKind, TableSharePayload } from "../../../shares/payload";

/**
 * Returns true when the current browser location is a public share that should
 * bypass the login/onboarding gate.
 *
 * Three shapes qualify:
 *  - `/article?a={encoded}` — inline article share
 *  - `/s/{shortId}` — stored share of any kind
 *  - `/?gloomberb=gloomberb://{share|article}...` — the hand-off the slim share
 *    page uses for "open in terminal"
 *
 * The last one matters as much as the others: the share page is what a stranger
 * lands on, and sending them from there into an onboarding wall would undo the
 * point of the link. Short IDs are accepted on shape alone so the bypass costs
 * no network call during bootstrap.
 */
export function isPublicShareLocation(): boolean {
  const location = getBrowserLocation();
  if (!location) return false;
  const { pathname, search } = location;
  const params = new URLSearchParams(search);

  if (isPublicShareDeepLink(params.get("gloomberb"))) return true;

  if (pathname === "/article") {
    const encoded = params.get("a");
    return encoded != null && decodeArticleSharePayload(encoded) !== null;
  }

  return parseShortShareId(pathname) !== null;
}

function isPublicShareDeepLink(value: string | null): boolean {
  if (!value) return false;
  return /^gloomberb:\/\/(share|article)\b/.test(value);
}
