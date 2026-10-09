import { useMemo } from "react";
import { usePaneFooter, usePaneLoadingSignal, type PaneFooterSegment, type PaneHint } from "./footer";

export { usePaneLoadingSignal };
import { useExternalLinkFooter } from "../../use-external-link-footer";
import { loadingErrorFooterInfo } from "../../data-table/table-pane";

const EMPTY_STATUS_INFO: PaneFooterSegment[] = [];

// `r` refreshes every pane, so it is global product knowledge and deliberately
// has no per-pane footer hint. Do not reintroduce one. See PR #589. Panes bind
// it with `usePaneRefreshKey`.

interface PaneStatusInfoOptions {
  /** In flight. Draws the body spinner. It is not a footer word. */
  loading?: boolean;
  error?: string | null;
  /**
   * Accepted so existing callers compile. The age token is the staleness.
   * Do not draw the word.
   */
  stale?: boolean;
  info?: readonly PaneFooterSegment[];
}

function buildPaneStatusInfo({
  loading = false,
  error,
  info = EMPTY_STATUS_INFO,
}: PaneStatusInfoOptions): PaneFooterSegment[] {
  return [...info, ...loadingErrorFooterInfo(loading, error)];
}

export function usePaneStatusFooter({
  registrationId,
  loading = false,
  error,
  info = EMPTY_STATUS_INFO,
  hints,
  enabled = true,
}: PaneStatusInfoOptions & {
  registrationId: string;
  hints?: PaneHint[];
  enabled?: boolean;
}) {
  usePaneLoadingSignal(enabled && loading);
  const statusInfo = useMemo(
    () => buildPaneStatusInfo({ loading, error, info }),
    [error, info, loading],
  );
  usePaneFooter(
    registrationId,
    () => enabled && (statusInfo.length > 0 || (hints?.length ?? 0) > 0)
      ? { info: statusInfo, hints }
      : null,
    [enabled, hints, registrationId, statusInfo],
  );
}

export function usePaneStatusLinkFooter({
  registrationId,
  focused,
  url,
  source,
  label,
  loading = false,
  error,
  info = EMPTY_STATUS_INFO,
  hints,
  trailingInfo,
  showOpenHint = false,
}: PaneStatusInfoOptions & {
  registrationId: string;
  focused: boolean;
  url: string | null | undefined;
  source?: string | null;
  label?: string;
  hints?: PaneHint[];
  trailingInfo?: PaneFooterSegment[];
  showOpenHint?: boolean;
}) {
  usePaneLoadingSignal(loading);
  const statusInfo = useMemo(
    () => buildPaneStatusInfo({ loading, error, info }),
    [error, info, loading],
  );
  return useExternalLinkFooter({
    registrationId,
    focused,
    url,
    source,
    label,
    info: statusInfo,
    hints,
    trailingInfo,
    showHint: showOpenHint,
  });
}
