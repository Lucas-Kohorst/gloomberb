import { useMemo } from "react";
import { usePaneFooter, usePaneLoadingSignal, type PaneFooterSegment, type PaneHint } from "./footer";
import { useExternalLinkFooter } from "../../use-external-link-footer";
import { loadingErrorFooterInfo } from "../../data-table/table-pane";

export { usePaneLoadingSignal };

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
  error,
  info = EMPTY_STATUS_INFO,
}: PaneStatusInfoOptions): PaneFooterSegment[] {
  return [...info, ...loadingErrorFooterInfo(false, error)];
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
    () => buildPaneStatusInfo({ error, info }),
    [error, info],
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
  showOpenHint = false,
}: PaneStatusInfoOptions & {
  registrationId: string;
  focused: boolean;
  url: string | null | undefined;
  source?: string | null;
  label?: string;
  hints?: PaneHint[];
  showOpenHint?: boolean;
}) {
  usePaneLoadingSignal(loading);
  const statusInfo = useMemo(
    () => buildPaneStatusInfo({ error, info }),
    [error, info],
  );
  return useExternalLinkFooter({
    registrationId,
    focused,
    url,
    source,
    label,
    info: statusInfo,
    hints,
    showHint: showOpenHint,
  });
}
