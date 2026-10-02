import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, ConfirmDialog, EmptyState, Spinner, loadingText, usePaneFooter, type PaneHint } from "../../../components";
import { apiClient, type CalendarFeed } from "../../../api-client";
import { ApiRequestError } from "../../../api-client/errors";
import { t } from "../../../i18n";
import { useAppLanguage } from "../../../i18n/react";
import { useThemeColors } from "../../../theme/theme-context";
import { Box, Text, useRendererHost } from "../../../ui";
import { useDialog, type PromptContext } from "../../../ui/dialog";
import { formatTimeAgo } from "../../../utils/format";

type Message = { tone: "info" | "success" | "error"; text: string };

function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError && error.status === 404) return t("Calendar links are not available yet.");
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * The Calendar tab of the account pane: one private link to subscribe to in
 * Google, Apple or Outlook Calendar. `c` copies it (creating it the first
 * time), `n` replaces it after a confirm. The link is never created on load.
 */
export function CalendarAccountTab({ width, sessionMarker }: { width: number; sessionMarker: string }) {
  const language = useAppLanguage();
  const colors = useThemeColors();
  const renderer = useRendererHost();
  const dialog = useDialog();
  const [feed, setFeed] = useState<CalendarFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [shownUrl, setShownUrl] = useState<string | null>(null);
  const busyRef = useRef(false);

  const load = useCallback(async (isCurrent: () => boolean = () => true) => {
    setLoading(true);
    setLoadError(null);
    try {
      const next = await apiClient.getCalendarFeed();
      if (isCurrent()) setFeed(next);
    } catch (error) {
      if (isCurrent()) setLoadError(errorText(error, t("Failed to load the calendar link.")));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let current = true;
    setFeed(null);
    setShownUrl(null);
    setMessage(null);
    void load(() => current);
    return () => {
      current = false;
    };
  }, [load, sessionMarker]);

  const copy = useCallback(async (url: string, copied: string) => {
    setShownUrl(url);
    try {
      await renderer.copyText(url);
      setMessage({ tone: "success", text: copied });
    } catch {
      setMessage({ tone: "info", text: t("Copy failed. Select the link below.") });
    }
  }, [renderer]);

  const run = useCallback(async (task: () => Promise<void>, failure: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await task();
    } catch (error) {
      setMessage({ tone: "error", text: errorText(error, failure) });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const copyLink = useCallback(() => run(async () => {
    const current = feed ?? await apiClient.ensureCalendarFeed();
    setFeed(current);
    setLoadError(null);
    await copy(current.url, t("Link copied."));
  }, t("Failed to create the calendar link.")), [copy, feed, run]);

  const regenerateLink = useCallback(async () => {
    if (!feed || busyRef.current) return;
    const confirmed = await dialog.prompt<boolean>({
      closeOnClickOutside: false,
      content: (context: PromptContext<boolean>) => (
        <ConfirmDialog
          {...context}
          title={t("Regenerate Link")}
          body={[
            t("Calendars using the current link stop updating."),
            t("Add the new link to keep them current."),
          ]}
          confirmLabel={t("Regenerate")}
          confirmVariant="danger"
        />
      ),
    }).catch(() => false);
    if (!confirmed) return;
    await run(async () => {
      const next = await apiClient.rotateCalendarFeed();
      setFeed(next);
      await copy(next.url, t("New link copied. The old one no longer works."));
    }, t("Failed to regenerate the calendar link."));
  }, [copy, dialog, feed, run]);

  const hints = useMemo<PaneHint[]>(() => {
    if (!feed && (loading || loadError)) return [];
    return [
      { id: "copy", key: "c", label: "opy link", onPress: () => { void copyLink(); }, disabled: busy },
      ...(feed
        ? [{ id: "regenerate", key: "n", label: "ew link", onPress: () => { void regenerateLink(); }, disabled: busy }]
        : []),
    ];
  }, [busy, copyLink, feed, language, loadError, loading, regenerateLink]);

  usePaneFooter("account-management:calendar", () => ({
    info: [
      ...(busy ? [{ id: "busy", parts: [{ text: t("working"), tone: "muted" as const }] }] : []),
      ...(message && !busy ? [{
        id: "status",
        parts: [{
          text: message.text,
          tone: message.tone === "error" ? "negative" as const : message.tone === "success" ? "positive" as const : "muted" as const,
        }],
      }] : []),
    ],
    hints,
  }), [busy, hints, language, message]);

  if (loading && !feed) return <Spinner label={loadingText(t("calendar link"))} />;

  if (loadError && !feed) {
    return (
      <Box flexDirection="column" width={width} gap={1}>
        <EmptyState fill={false} title={loadError} />
        <Button label={t("Retry")} onPress={() => { void load(); }} />
      </Box>
    );
  }

  if (!feed) {
    return (
      <Box flexDirection="column" width={width} gap={1}>
        <EmptyState fill={false} title={t("No calendar link yet.")} hint={t("Updates on its own.")} />
        <Button
          label={busy ? t("Creating...") : t("Copy Calendar Link")}
          variant="primary"
          onPress={() => { void copyLink(); }}
          disabled={busy}
        />
      </Box>
    );
  }

  const visibleUrl = shownUrl ?? feed.url;
  return (
    <Box flexDirection="column" width={width} gap={1}>
      <Text fg={colors.positive}>{`${t("Link")}  ${t("Active")}`}</Text>
      <Text fg={colors.text}>{`${t("Last read")}  ${feed.lastFetchedAt ? formatTimeAgo(feed.lastFetchedAt) : t("Not yet")}`}</Text>
      <Text fg={colors.text}>{visibleUrl}</Text>
    </Box>
  );
}
