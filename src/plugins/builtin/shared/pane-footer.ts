import { useMemo } from "react";
import {
  useExternalLinkFooter,
  usePaneFooter,
  type PaneFooterSegment,
  type PaneHint,
} from "../../../components";
import { useShortcut } from "../../../react/input";
import { isPlainKeyboardEvent } from "../../../utils/keyboard";

/** Canonical pane-footer action keys. Search is `/`; refresh is `r`; open is `o`. */
export const PANE_FOOTER_ACTION_KEYS = {
  search: "/",
  refresh: "r",
  open: "o",
} as const;

export function paneSearchHint(
  onPress: () => void,
  extra?: Pick<PaneHint, "disabled">,
): PaneHint {
  return { id: "search", key: PANE_FOOTER_ACTION_KEYS.search, label: "search", onPress, ...extra };
}

export function paneRefreshHint(
  onPress: () => void,
  extra?: Pick<PaneHint, "disabled">,
): PaneHint {
  return { id: "refresh", key: PANE_FOOTER_ACTION_KEYS.refresh, label: "efresh", onPress, ...extra };
}

const EMPTY_STATUS_INFO: PaneFooterSegment[] = [];
const EMPTY_TRAILING_INFO: PaneFooterSegment[] = [];
const EMPTY_HINTS: PaneHint[] = [];

function buildPaneStatusInfo({
  loading = false,
  error,
  info = EMPTY_STATUS_INFO,
}: {
  loading?: boolean;
  error?: string | null;
  info?: readonly PaneFooterSegment[];
}): PaneFooterSegment[] {
  return [
    ...info,
    ...(loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
    ...(error ? [{ id: "error", parts: [{ text: error, tone: "warning" as const }] }] : []),
  ];
}

function isBindableHintKey(key: string): boolean {
  if (key === "/") return true;
  return key.length === 1;
}

export function usePaneFooterHintBindings(
  focused: boolean,
  hints: readonly PaneHint[] | undefined,
  options?: { skipKeys?: ReadonlySet<string> },
): void {
  const skipKeys = options?.skipKeys;
  const bindable = (hints ?? EMPTY_HINTS).filter((hint) => (
    !hint.disabled
    && !!hint.onPress
    && isBindableHintKey(hint.key)
    && !skipKeys?.has(hint.key.toLowerCase())
  ));
  useShortcut((event) => {
    if (!focused || event.targetEditable) return;
    // Shifted letters are a different action (Shift+R is not [r]efresh).
    if (!isPlainKeyboardEvent(event)) return;
    const key = (event.name ?? event.key ?? event.sequence ?? "").toLowerCase();
    if (!key) return;
    const hint = bindable.find((candidate) => candidate.key.toLowerCase() === key);
    if (!hint?.onPress) return;
    event.stopPropagation?.();
    event.preventDefault?.();
    hint.onPress();
  }, { enabled: focused && bindable.length > 0 });
}

export function usePaneStatusFooter({
  registrationId,
  loading = false,
  error,
  info = EMPTY_STATUS_INFO,
  trailingInfo = EMPTY_TRAILING_INFO,
  hints,
  focused = false,
  enabled = true,
}: {
  registrationId: string;
  loading?: boolean;
  error?: string | null;
  info?: readonly PaneFooterSegment[];
  trailingInfo?: readonly PaneFooterSegment[];
  hints?: PaneHint[];
  focused?: boolean;
  enabled?: boolean;
}) {
  const statusInfo = useMemo(
    () => buildPaneStatusInfo({ loading, error, info }),
    [error, info, loading],
  );
  const trailing = useMemo(
    () => (trailingInfo.length > 0 ? [...trailingInfo] : EMPTY_TRAILING_INFO),
    [trailingInfo],
  );
  usePaneFooterHintBindings(focused, hints);
  usePaneFooter(
    registrationId,
    () => enabled && (statusInfo.length > 0 || trailing.length > 0 || (hints?.length ?? 0) > 0)
      ? { info: statusInfo, trailingInfo: trailing, hints }
      : null,
    [enabled, hints, registrationId, statusInfo, trailing],
  );
}

const OPEN_HINT_KEYS = new Set(["o"]);

export function usePaneStatusLinkFooter({
  registrationId,
  focused,
  url,
  source,
  label,
  loading = false,
  error,
  info = EMPTY_STATUS_INFO,
  trailingInfo,
  hints,
  trailingHints,
  showOpenHint = false,
}: {
  registrationId: string;
  focused: boolean;
  url: string | null | undefined;
  source?: string | null;
  label?: string;
  loading?: boolean;
  error?: string | null;
  info?: readonly PaneFooterSegment[];
  trailingInfo?: readonly PaneFooterSegment[];
  hints?: PaneHint[];
  trailingHints?: PaneHint[];
  showOpenHint?: boolean;
}) {
  const statusInfo = useMemo(
    () => buildPaneStatusInfo({ loading, error, info }),
    [error, info, loading],
  );
  const trailing = useMemo(
    () => (trailingInfo && trailingInfo.length > 0 ? [...trailingInfo] : EMPTY_TRAILING_INFO),
    [trailingInfo],
  );
  const boundHints = useMemo(
    () => [...(hints ?? EMPTY_HINTS), ...(trailingHints ?? EMPTY_HINTS)],
    [hints, trailingHints],
  );
  usePaneFooterHintBindings(focused, boundHints, { skipKeys: OPEN_HINT_KEYS });
  return useExternalLinkFooter({
    registrationId,
    focused,
    url,
    source,
    label,
    info: statusInfo,
    trailingInfo: trailing,
    hints,
    trailingHints,
    showHint: showOpenHint,
  });
}
