import { useCallback, useMemo, useRef } from "react";
import { PaneTemplateInputStep } from "../../../components/pane-template-wizard";
import { useShortcut } from "../../../react/input";
import { useAppSelector } from "../../../state/app/context";
import type { ChartSpec } from "../../../time-series/types";
import { useDialog, useDialogState, type PromptContext } from "../../../ui/dialog";
import { usePluginRenderContext } from "../../runtime/context";
import { usePluginConfigState } from "../../runtime";
import {
  activePriceAlertsFor,
  addLevelAlert,
  PRICE_ALERTS_STORE,
} from "../alerts/levels";
import { formatAlertDescription } from "../alerts/alert-engine";
import {
  ALERT_LEVEL_COLOR,
  editPriceLevels,
  parsePriceLevels,
  PRICE_LEVELS_KEY,
  priceLevelListing,
  type PriceLevel,
  type PriceLevelEdit,
  type PriceLevelListing,
} from "./price-levels";

export interface DrawnPriceLevel {
  id: string;
  seriesId: string;
  value: number;
  color: string;
  /** False for an alert the chart draws but did not store. */
  editable: boolean;
}

export function useChartPriceLevels(spec: ChartSpec): {
  listing: PriceLevelListing | null;
  levels: readonly PriceLevel[];
  drawn: readonly DrawnPriceLevel[];
  listed: readonly { id: string; price: number }[];
  edit: (edit: PriceLevelEdit) => void;
  alertAtLevel: (price: number, currentPrice: number | null) => Promise<void>;
} {
  const { runtime } = usePluginRenderContext();
  const listing = useMemo(() => priceLevelListing(spec), [spec]);
  const [stored, setStored] = usePluginConfigState<unknown>(PRICE_LEVELS_KEY, null);
  const alertsJson = useAppSelector((state) => (
    state.config.pluginConfig[PRICE_ALERTS_STORE.pluginId]?.[PRICE_ALERTS_STORE.key]
  ));
  const alertsOn = useAppSelector((state) => !state.config.disabledPlugins.includes(PRICE_ALERTS_STORE.pluginId));
  const levels = useMemo(
    () => (listing ? parsePriceLevels(stored)[listing.key] ?? [] : []),
    [listing, stored],
  );
  const alerts = useMemo(
    () => (listing && alertsOn ? activePriceAlertsFor(alertsJson, listing) : []),
    [alertsJson, alertsOn, listing],
  );
  const drawn = useMemo<DrawnPriceLevel[]>(() => {
    if (!listing) return [];
    const alerted = new Set(alerts.map((alert) => alert.targetPrice));
    const storedPrices = new Set(levels.map((level) => level.price));
    const alertOnly = alerts.filter((alert) => !storedPrices.has(alert.targetPrice));
    return [
      ...levels.map((level) => ({
        id: level.id,
        seriesId: listing.seriesId,
        value: level.price,
        color: alerted.has(level.price) ? ALERT_LEVEL_COLOR : level.color,
        editable: true,
      })),
      ...alertOnly.map((alert) => ({
        id: `alert:${alert.id}`,
        seriesId: listing.seriesId,
        value: alert.targetPrice,
        color: ALERT_LEVEL_COLOR,
        editable: false,
      })),
    ];
  }, [alerts, levels, listing]);
  const listed = useMemo(
    () => drawn.map((level) => ({ id: level.id, price: level.value })),
    [drawn],
  );
  const listingRef = useRef(listing);
  listingRef.current = listing;
  const edit = useCallback((next: PriceLevelEdit) => {
    const key = listingRef.current?.key;
    if (!key) return;
    setStored((current: unknown) => {
      const store = parsePriceLevels(current);
      const edited = editPriceLevels(store, key, next);
      return edited === store ? current : edited;
    });
  }, [setStored]);
  const alertAtLevel = useCallback(async (price: number, currentPrice: number | null) => {
    const current = listingRef.current;
    if (!current || !alertsOn) return;
    const result = addLevelAlert(
      runtime.getConfigState<string>(PRICE_ALERTS_STORE.pluginId, PRICE_ALERTS_STORE.key),
      current,
      price,
      currentPrice,
    );
    if ("error" in result) {
      runtime.notify({ body: `Saved alerts could not be read: ${result.error}`, type: "error" });
      return;
    }
    if (result.created) {
      await runtime.setConfigState(PRICE_ALERTS_STORE.pluginId, PRICE_ALERTS_STORE.key, result.json);
    }
    runtime.notify({
      body: `${result.created ? "Alert set" : "Alert already set"}: ${formatAlertDescription(result.alert)}`,
      type: "success",
    });
  }, [alertsOn, runtime]);

  return { listing, levels, drawn, listed, edit, alertAtLevel };
}

/** Shift+H stores a price on the listing. The same price again removes it. */
export function usePriceLevelPrompt(options: {
  listing: PriceLevelListing | null;
  levels: readonly PriceLevel[];
  edit: (edit: PriceLevelEdit) => void;
  alertAtLevel: (price: number, currentPrice: number | null) => Promise<void>;
  currentPrice: number | null;
  enabled: boolean;
  onCapture?: (captured: boolean) => void;
}): void {
  const dialog = useDialog();
  const dialogOpen = useDialogState((state) => state.isOpen);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  useShortcut((event) => {
    const current = optionsRef.current;
    if (!current.enabled || !current.listing || dialogOpen) return;
    const key = (event.name ?? "").toLowerCase();
    if (!event.shift || key !== "h" || event.ctrl || event.meta || event.alt || event.super) return;
    event.preventDefault();
    event.stopPropagation();
    current.onCapture?.(true);
    void dialog.prompt<string>({
      closeOnClickOutside: true,
      content: (context: PromptContext<string>) => (
        <PaneTemplateInputStep
          {...context}
          step={{
            key: "level",
            label: "Price level",
            placeholder: "230.50",
            type: "text",
            body: ["Stored on this listing and drawn on its charts. Enter the same price again to remove it. A new level also sets a price alert."],
          }}
        />
      ),
    }).then((raw) => {
      const latest = optionsRef.current;
      const price = typeof raw === "string" ? Number(raw.trim()) : Number.NaN;
      if (!Number.isFinite(price)) return;
      const existing = latest.levels.find((level) => level.price === price);
      if (existing) {
        latest.edit({ kind: "remove", id: existing.id });
        return;
      }
      const id = `lvl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      latest.edit({ kind: "add", id, price });
      void latest.alertAtLevel(price, latest.currentPrice);
    }).catch(() => undefined).finally(() => {
      optionsRef.current.onCapture?.(false);
    });
  }, { enabled: options.enabled && !dialogOpen });
}
