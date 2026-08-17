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
 * Two shapes qualify:
 *  - `/article?a={encoded}` — inline article share
 *  - `/s/{shortId}` — stored share of any kind
 *
 * The slim share page's "open in terminal" hand-off (`/?gloomberb=...`) is
 * deliberately not a bypass. Logged-out visitors must sign up or log in;
 * logged-in users already skip the wizard via `onboardingComplete`. Short IDs
 * are accepted on shape alone so the bypass costs no network call during
 * bootstrap.
 */
export function isPublicShareLocation(): boolean {
  const location = getBrowserLocation();
  if (!location) return false;
  const { pathname, search } = location;
  const params = new URLSearchParams(search);

  if (pathname === "/article") {
    const encoded = params.get("a");
    return encoded != null && decodeArticleSharePayload(encoded) !== null;
  }

  return parseShortShareId(pathname) !== null;
}

/**
 * True when the slim share page sent the visitor into the terminal via
 * "open in terminal" (`/?gloomberb=gloomberb://{share|article}...`).
 *
 * Distinct from `isPublicShareLocation`: the share document stays public, but
 * this hand-off is the terminal SPA and should gate on an account.
 */
export function isShareTerminalHandoff(): boolean {
  const location = getBrowserLocation();
  if (!location) return false;
  return isShareDeepLink(new URLSearchParams(location.search).get("gloomberb"));
}

function isShareDeepLink(value: string | null): boolean {
  if (!value) return false;
  return /^gloomberb:\/\/(share|article)\b/.test(value);
}
