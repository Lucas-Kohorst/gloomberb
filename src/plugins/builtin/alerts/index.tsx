import type { GloomPlugin, GloomPluginContext } from "../../../types/plugin";
import type { Quote } from "../../../types/financials";
import { formatMarketPrice } from "../../../market-data/market/format";
import { tf } from "../../../i18n";
import { getSharedNewsService } from "../../../news/hooks";
import {
  createAlert,
  evaluateAlert,
  evaluateExDivAlert,
  evaluateHaltedAlert,
  evaluateShortFloatAlert,
  formatAlertDescription,
  resolveAlertSnooze,
  snoozeAlert,
  utcDaysUntil,
} from "./alert-engine";
import {
  parseAlertCommandValues,
  parseAlertShortcutValues,
  parseWeatherAlertCommandValues,
} from "./command";
import { POLL_INTERVAL_MS, POLL_SECONDS_KEY, SNOOZE_DURATION_MS, SNOOZE_MINUTES } from "./constants";
import { appendAlertHistory, createAlertHistoryEntry } from "./history";
import { setAlertHandler } from "./alert-registry";
import { AlertsPane } from "./pane";
import {
  createQuoteErrorMessage,
  quoteAlertFields,
  quoteErrorAlertFields,
  resolveAlertQuote,
} from "./quotes";
import {
  loadAlertHistory,
  loadAlerts,
  saveAlertHistory,
  saveAlerts,
} from "./storage";
import { canonicalWeatherStationId } from "../weather/stations";
import { evaluateWeatherAlert } from "./weather-alert";
import type { WeatherAlertCondition } from "./weather";
import { isPriceAlertCondition } from "./types";
import { isQuoteAlertCondition } from "./types";
import { evaluateNewsMentionAlert, evaluateQuoteCondition } from "./condition-evaluators";

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollInFlight = false;

/**
 * Snoozes a stored alert by id (the notification's secondary action). The
 * confirmation toast separates a snooze from a plain toast dismissal.
 */
function snoozeStoredAlert(ctx: GloomPluginContext, id: string, description: string): void {
  const alerts = loadAlerts(ctx);
  let snoozed = false;
  const next = alerts.map((alert) => {
    if (alert.id !== id) return alert;
    snoozed = true;
    return snoozeAlert(alert, SNOOZE_DURATION_MS);
  });
  saveAlerts(ctx, next);
  if (snoozed) {
    ctx.notify({
      body: `${description} snoozed ${SNOOZE_MINUTES}m`,
      type: "info",
    });
  }
}

export const alertsPlugin: GloomPlugin = {
  id: "alerts",
  name: "Alerts",
  version: "1.0.0",
  description: "Price, halt, short-interest, and ex-div alerts with desktop notifications",
  toggleable: true,

  setup(ctx) {
    setAlertHandler((options) => {
      const existing = loadAlerts(ctx);
      existing.push({
        id: `alert-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        symbol: options.symbol.toUpperCase(),
        condition: options.condition,
        targetPrice: options.targetPrice ?? 0,
        ...(options.targetText ? { targetText: options.targetText } : {}),
        ...(options.message ? { message: options.message } : {}),
        createdAt: Date.now(),
        status: "active",
      });
      saveAlerts(ctx, existing);
    });

    ctx.registerCommand({
      id: "set-alert",
      label: "Add Alert",
      description: "Create an alert from a symbol, condition, and target",
      keywords: ["add", "set", "alert", "price", "trigger", "notify", "alarm", "watch", "halt", "short", "dividend", "day", "volume", "news", "mention"],
      category: "data",
      shortcut: "SA",
      shortcutArg: {
        placeholder: "AAPL above 200 / AAPL day 5 / AAPL volume 3 / AAPL news merger",
        kind: "ticker",
        parse: parseAlertShortcutValues,
      },
      wizardLayout: "form",
      wizard: [
        {
          key: "symbol",
          label: "Symbol",
          placeholder: "AAPL",
          type: "text",
        },
        {
          key: "condition",
          label: "Condition",
          type: "select",
          options: [
            { label: "Above", value: "above" },
            { label: "Below", value: "below" },
            { label: "Crosses", value: "crosses" },
            { label: "Halted", value: "halted" },
            { label: "Short % float", value: "short_float" },
            { label: "Ex-div in days", value: "ex_div" },
            { label: "Day move %", value: "pct_day" },
            { label: "Volume spike × average", value: "volume_spike" },
            { label: "News mentions keyword", value: "news_mention" },
          ],
        },
        {
          key: "price",
          label: "Target",
          placeholder: "200.00 / 5% / 7d / 3×",
          type: "number",
        },
        {
          key: "keyword",
          label: "Keyword",
          placeholder: "merger",
          type: "text",
          dependsOn: { key: "condition", value: "news_mention" },
        },
      ],
      async execute(values) {
        const input = parseAlertCommandValues(values);
        if (!input) throw new Error("Use a symbol, condition, and target.");

        const alert = createAlert(input.symbol, input.condition, input.price);
        if (input.targetText) alert.targetText = input.targetText;
        if (isQuoteAlertCondition(input.condition)) {
          const quote = await resolveAlertQuote(ctx.marketData, input.symbol);
          Object.assign(alert, quoteAlertFields(quote));
          alert.symbol = quote.symbol || input.symbol;
        }

        const existing = loadAlerts(ctx);
        existing.push(alert);
        saveAlerts(ctx, existing);

        ctx.notify({
          body: isPriceAlertCondition(input.condition) && alert.lastCheckedPrice != null
            ? `Alert set: ${formatAlertDescription(alert)} (current ${formatMarketPrice(alert.lastCheckedPrice, { minimumFractionDigits: 2 })})`
            : `Alert set: ${formatAlertDescription(alert)}`,
          type: "success",
        });
      },
    });

    ctx.registerCommand({
      id: "set-weather-alert",
      label: "Add Weather Alert",
      description: "Alert on a weather observation, report finalization, source age, or TWC/NWS disagreement",
      keywords: ["weather", "temperature", "rain", "precipitation", "climate", "station", "alert"],
      category: "data",
      shortcut: "WA",
      wizardLayout: "form",
      wizard: [
        { key: "station", label: "Station", placeholder: "LAX / KLAS", type: "text" },
        { key: "condition", label: "Condition", type: "select", options: [
          { label: "Crosses above target", value: "above" },
          { label: "Crosses below target", value: "below" },
          { label: "Report becomes final", value: "final" },
          { label: "TWC source stale (minutes)", value: "stale" },
          { label: "TWC / NWS differ by target", value: "discrepancy" },
        ] },
        { key: "metric", label: "Metric", type: "select", options: [
          { label: "Daily high (°F)", value: "high" },
          { label: "Daily low (°F)", value: "low" },
          { label: "Precipitation (in)", value: "precip" },
          { label: "Hourly temperature (°F)", value: "hourly" },
        ] },
        { key: "target", label: "Target", placeholder: "85 / 15 minutes / 2", type: "number" },
      ],
      async execute(values) {
        const input = parseWeatherAlertCommandValues(values);
        const stationId = input && canonicalWeatherStationId(input.stationId);
        if (!input || !stationId) throw new Error("Choose a station, condition, metric where applicable, and target.");
        const weatherCondition: Exclude<WeatherAlertCondition, { kind: "market-probability" } | { kind: "market-spread" }> = input.condition === "observed-threshold-crossing"
          ? {
            kind: "observed-threshold-crossing",
            metric: input.metric!,
            threshold: input.target!,
            direction: values?.condition === "below" ? "below" : "above",
          }
          : input.condition === "stale-source"
            ? { kind: "stale-source", sourceId: "twc-kalshi", maxAgeMs: input.target! * 60_000 }
            : input.condition === "preliminary-to-final"
              ? { kind: "preliminary-to-final", metric: input.metric, sourceId: "twc-kalshi" }
              : { kind: "source-discrepancy", metric: input.metric!, maxDifference: input.target! };
        const alert = createAlert(stationId, "weather", 0);
        alert.weather = { stationId, condition: weatherCondition };
        alert.message = input.condition === "stale-source"
          ? `${stationId} TWC stale > ${input.target}m`
          : input.condition === "preliminary-to-final"
            ? `${stationId} ${input.metric} report final`
            : input.condition === "source-discrepancy"
              ? `${stationId} ${input.metric} TWC/NWS differs > ${input.target}`
              : `${stationId} ${input.metric} crosses ${values?.condition} ${input.target}`;
        const existing = loadAlerts(ctx);
        existing.push(alert);
        saveAlerts(ctx, existing);
        ctx.notify({ body: `Alert set: ${alert.message}`, type: "success" });
      },
    });

    const poll = async () => {
      if (pollInFlight) return;
      pollInFlight = true;
      try {
        const alerts = loadAlerts(ctx);
        if (alerts.length === 0) return;

        const activeAlerts = alerts.filter((a) => a.status === "active");
        if (activeAlerts.length === 0) return;

        ctx.log.info("poll", { total: alerts.length, active: activeAlerts.length });

      // One batched pass over the distinct symbols: the alerts pane reads the same
      // persisted store, so this is the only place that talks to the provider.
      const quoteKeys = [...new Set(activeAlerts
        .filter((alert) => isQuoteAlertCondition(alert.condition))
        .map((alert) => `${alert.symbol}\0${alert.exchange ?? ""}`))];
      const results = await Promise.all(quoteKeys.map(async (key): Promise<[string, Quote | string]> => {
        const [symbol, exchange = ""] = key.split("\0");
        try {
          return [key, await resolveAlertQuote(ctx.marketData, symbol ?? "", exchange)];
        } catch (err) {
          ctx.log.warn("poll: no quote", { symbol, exchange, error: String(err) });
          return [key, createQuoteErrorMessage(symbol ?? "", err)];
        }
      }));
      const quotes = new Map<string, Quote | string>(results);

      const now = Date.now();
      let changed = false;
      for (const alert of alerts) {
        if (alert.status !== "active") continue;
        const quote = quotes.get(`${alert.symbol}\0${alert.exchange ?? ""}`);
        if (quote === undefined) continue;
        if (typeof quote === "string") {
          Object.assign(alert, quoteErrorAlertFields(quote));
          changed = true;
          continue;
        }

        const snooze = resolveAlertSnooze(alert, now);
        if (snooze === "snoozed") {
          // Evaluation is held, but quote fields keep refreshing so the pane
          // stays live and `crosses` re-arms on a current baseline.
          Object.assign(alert, quoteAlertFields(quote));
          changed = true;
          continue;
        }
        if (snooze === "rearmed") changed = true;

        const triggered = evaluateAlert(alert, quote.price) || evaluateQuoteCondition(alert, quote);
        if (triggered) {
          alert.status = "triggered";
          const triggeredAt = Date.now();
          alert.triggeredAt = triggeredAt;
          const description = formatAlertDescription(alert);
          saveAlertHistory(ctx, appendAlertHistory(
            loadAlertHistory(ctx),
            createAlertHistoryEntry(alert, description, triggeredAt, quote.price),
          ));
          ctx.log.info("poll: TRIGGERED", { symbol: alert.symbol, price: quote.price });
          const triggerValue = alert.condition === "pct_day"
            ? `${Math.abs(quote.changePercent).toFixed(1)}%`
            : alert.condition === "volume_spike" && quote.averageVolume && quote.averageVolume > 0
              ? `${((quote.volume ?? 0) / quote.averageVolume).toFixed(1)}×`
              : String(quote.price);
          ctx.notify({
            body: `${description} triggered at ${triggerValue}`,
            type: "success",
            desktop: "always",
            persistent: true,
            sound: "Glass",
            action: {
              label: "Open",
              onClick: () => ctx.showPane("alerts"),
            },
            secondaryAction: {
              label: tf("Snooze {minutes}m", { minutes: SNOOZE_MINUTES }),
              onClick: () => snoozeStoredAlert(ctx, alert.id, formatAlertDescription(alert)),
            },
          });
        }
        Object.assign(alert, quoteAlertFields(quote));
        if (alert.condition === "pct_day") alert.lastCheckedPrice = quote.changePercent;
        if (alert.condition === "volume_spike" && quote.averageVolume && quote.averageVolume > 0) {
          alert.lastCheckedPrice = (quote.volume ?? 0) / quote.averageVolume;
        }
        changed = true;
      }

      const newsAlerts = alerts.filter((alert) => alert.status === "active" && alert.condition === "news_mention");
      const newsService = getSharedNewsService();
      if (newsService && newsAlerts.length > 0) {
        const newsByKey = new Map(await Promise.all(
          [...new Set(newsAlerts.map((alert) => `${alert.symbol}\0${alert.exchange ?? ""}`))].map(async (key) => {
            const [ticker, exchange = ""] = key.split("\0");
            const state = await newsService.load({
              feed: "ticker",
              ticker,
              exchange,
              tickerTier: "primary",
              limit: 25,
            });
            return [key, state.articles] as const;
          }),
        ));
        for (const alert of newsAlerts) {
          const snooze = resolveAlertSnooze(alert, now);
          if (snooze === "snoozed") continue;
          if (snooze === "rearmed") changed = true;
          const evaluation = evaluateNewsMentionAlert(
            alert,
            newsByKey.get(`${alert.symbol}\0${alert.exchange ?? ""}`) ?? [],
          );
          if (evaluation.lastSeenArticleId) {
            alert.lastSeenArticleId = evaluation.lastSeenArticleId;
            alert.lastSeenArticlePublishedAt = evaluation.lastSeenArticlePublishedAt;
            alert.lastCheckedAt = Date.now();
            changed = true;
          }
          if (!evaluation.triggered) continue;
          alert.status = "triggered";
          const triggeredAt = Date.now();
          alert.triggeredAt = triggeredAt;
          const description = formatAlertDescription(alert);
          saveAlertHistory(ctx, appendAlertHistory(
            loadAlertHistory(ctx),
            createAlertHistoryEntry(alert, description, triggeredAt),
          ));
          ctx.log.info("poll: TRIGGERED", { symbol: alert.symbol, condition: alert.condition });
          ctx.notify({
            body: `${description} triggered`,
            type: "success",
            desktop: "always",
            persistent: true,
            sound: "Glass",
            action: { label: "Open", onClick: () => ctx.showPane("alerts") },
            secondaryAction: {
              label: tf("Snooze {minutes}m", { minutes: SNOOZE_MINUTES }),
              onClick: () => snoozeStoredAlert(ctx, alert.id, description),
            },
          });
          changed = true;
        }
      }

      // Evaluate custom alert conditions registered by other plugins.
      const customConditions = new Map(
        ctx.listAlertConditions().map((c) => [c.id, c]),
      );
      const builtinConditions = new Set(["above", "below", "crosses", "halted", "short_float", "ex_div", "weather", "pct_day", "volume_spike", "news_mention"]);
      if (customConditions.size > 0) {
        const controller = new AbortController();
        for (const alert of alerts) {
          if (alert.status !== "active") continue;
          if (builtinConditions.has(alert.condition)) continue;
          const def = customConditions.get(alert.condition);
          if (!def) continue;
          const snooze = resolveAlertSnooze(alert, now);
          if (snooze === "snoozed") continue;
          if (snooze === "rearmed") changed = true;
          try {
            const triggered = await def.evaluate({
              symbol: alert.symbol,
              targetPrice: alert.targetPrice,
              ...(alert.targetText ? { targetText: alert.targetText } : {}),
              ...(alert.message ? { message: alert.message } : {}),
            }, controller.signal);
            if (triggered) {
              alert.status = "triggered";
              const triggeredAt = Date.now();
              alert.triggeredAt = triggeredAt;
              const description = def.formatDescription?.({
                symbol: alert.symbol,
                targetPrice: alert.targetPrice,
                ...(alert.targetText ? { targetText: alert.targetText } : {}),
                ...(alert.message ? { message: alert.message } : {}),
              }) ?? formatAlertDescription(alert);
              saveAlertHistory(ctx, appendAlertHistory(
                loadAlertHistory(ctx),
                createAlertHistoryEntry(alert, description, triggeredAt),
              ));
              ctx.log.info("poll: TRIGGERED (custom)", { symbol: alert.symbol, condition: alert.condition });
              ctx.notify({
                body: `${description} triggered`,
                type: "success",
                desktop: "always",
                persistent: true,
                sound: "Glass",
                action: {
                  label: "Open",
                  onClick: () => ctx.showPane("alerts"),
                },
                secondaryAction: {
                  label: tf("Snooze {minutes}m", { minutes: SNOOZE_MINUTES }),
                  onClick: () => snoozeStoredAlert(ctx, alert.id, description),
                },
              });
              changed = true;
            }
          } catch (err) {
            ctx.log.warn("poll: custom evaluate failed", { condition: alert.condition, error: String(err) });
          }
        }
      }

        if (changed) saveAlerts(ctx, alerts);
      } finally {
        pollInFlight = false;
      }
    };

    // Re-armed each cycle so a change to the pane's Check interval setting takes
    // effect on the next tick without a restart.
    const scheduleNextPoll = () => {
      const seconds = Number(ctx.paneSettings?.get<string>("alerts", POLL_SECONDS_KEY));
      const delay = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : POLL_INTERVAL_MS;
      pollTimer = setTimeout(() => {
        void poll().finally(scheduleNextPoll);
      }, delay);
    };

    void poll().finally(scheduleNextPoll);

    ctx.registerPane({
      id: "alerts",
      name: "Alerts",
      icon: "A",
      component: AlertsPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 82, height: 20 },
      settings: {
        title: "Alerts Settings",
        fields: [
          {
            key: POLL_SECONDS_KEY,
            label: "Check interval",
            description: "How often active alerts are re-quoted.",
            type: "select",
            options: [
              { value: "15", label: "15 seconds" },
              { value: "30", label: "30 seconds" },
              { value: "60", label: "1 minute" },
              { value: "300", label: "5 minutes" },
            ],
          },
        ],
      },
    });

    ctx.registerPaneTemplate({
      id: "alerts-pane",
      paneId: "alerts",
      label: "Alerts",
      description: "Price, halt, short-interest, and ex-div alerts",
      keywords: ["alerts", "price", "trigger", "alarm", "watch", "notify"],
      shortcut: { prefix: "ALRT" },
    });
  },

  dispose() {
    setAlertHandler(null);
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    pollInFlight = false;
  },
};
