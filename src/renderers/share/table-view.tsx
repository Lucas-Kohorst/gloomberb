/** @jsxImportSource react */
/**
 * A shared list is a handoff, not a public document.
 *
 * Articles, filings, and charts stay on this page. A whole pane (markets,
 * a watchlist, a screen) opens in the terminal, where sort and live data
 * already work.
 */

import type { TableSharePayload } from "../../shares/payload";
import { ShareShell, formatShareTimestamp } from "./shell";

export function TableShareView({
  payload,
  openInTerminalHref,
}: {
  payload: TableSharePayload;
  openInTerminalHref?: string | null;
}) {
  const captured = formatShareTimestamp(payload.capturedAt);
  const count = payload.truncatedFrom
    ? `First ${payload.rows.length} of ${payload.truncatedFrom} rows.`
    : `${payload.rows.length} ${payload.rows.length === 1 ? "row" : "rows"}.`;

  return (
    <ShareShell
      tone="handoff"
      title={payload.title}
      pitch="This list opens in Gloom, where it stays sortable and live."
      footer={captured ? <span>Snapshot {captured}</span> : null}
      openInTerminalHref={openInTerminalHref}
    >
      <p className="share-handoff-count">{count}</p>
    </ShareShell>
  );
}
