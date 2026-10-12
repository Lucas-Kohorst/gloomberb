import { startCatalystAlerts } from "./catalysts";
import { RESEARCH_LABELS, researchWizardFields, createResearchAlert } from "./research-builder";
import { newYorkToday } from "../earnings/board-model";
import { checkScheduledEventAlertsNow, startScheduledEventAlerts } from "./scheduled-check";
import { scheduledEventSources } from "./scheduled-sources";
import {
  eventDateUnavailableMessage,
  lookupScheduledDates,
  noUpcomingEventMessage,
  parseLeadDays,
  readScheduledRule,
  scheduledTargetKey,
} from "./scheduled";
import { isResearchAlertKind, MAX_LEAD_DAYS } from "./research-rules";
import { EVENT_ALERTS_KEY, EVENT_ALERT_TEMPLATES, MAX_EVENT_ALERTS, createEventAlert, readEventAlerts } from "./events";
import { formatMarketPrice } from "../../../market-data/market/format";
import { settleTypedListingKey } from "../../../tickers/listing-venues";
import { parsePublicTickerKey } from "../../../utils/exchanges";
import type { Fundamentals, Quote } from "../../../types/financials";
import type { GloomPlugin, GloomPluginContext } from "../../../types/plugin";
import { fetchMarketHalts } from "../market-halts/client";
import { resolveHaltStatus, type HaltRecord } from "../market-halts/model";
import {
  createAlert,
  evaluateAlert,
  evaluateExDivAlert,
  evaluateHaltedAlert,
  evaluatePctDayAlert,
  evaluateShortFloatAlert,
  formatAlertDescription,
  isAlertSnoozed,
  parseExDividendDate,
  resolveAlertSnooze,
  shortFloatPercent,
  snoozeAlert,
  utcDaysUntil,
} from "./alert-engine";
import {
  parseAlertCommandValues,
  parseAlertShortcutValues,
} from "./command";
import { POLL_INTERVAL_MS, POLL_SECONDS_KEY, SNOOZE_DURATION_MS, SNOOZE_MINUTES } from "./constants";
import { AlertsPane } from "./pane";
import { alertsCliCommand } from "./cli";
import {
  createQuoteErrorMessage,
  quoteAlertFields,
  quoteErrorAlertFields,
  resolveAlertQuote,
} from "./quotes";
import {
  loadAlerts,
  saveAlerts,
} from "./storage";
import { createAlertQuoteStream, readStreamedAlertQuote, type AlertQuoteStream } from "./live";
import { isPriceAlertCondition, isQuoteAlertCondition, type AlertRule } from "./types";

type FundSnapshot = Pick<Fundamentals, "shortPercentOfFloat" | "exDividendDate">;

function alertKey(alert: Pick<AlertRule, "symbol" | "exchange">): string {
  return `${alert.symbol}\0${alert.exchange ?? ""}`;
}

function haltedTickerSet(records: readonly HaltRecord[], now: number): Set<string> {
  const symbols = new Set<string>();
  for (const record of records) {
    if (resolveHaltStatus(record, now) === "halted") symbols.add(record.symbol.toUpperCase());
  }
  return symbols;
}

/** Null when the feed cannot be read. An empty set is a quiet tape, which must not fire. */
async function loadHaltedSymbols(ctx: GloomPluginContext): Promise<ReadonlySet<string> | null> {
  try {
    const records = await fetchMarketHalts(ctx.connectionHealth);
    return haltedTickerSet(records, Date.now());
  } catch (err) {
    ctx.log.warn("poll: halt feed unavailable", { error: String(err) });
    return null;
  }
}

function quoteTriggerText(alert: AlertRule, quote: Quote): string {
  if (alert.condition === "pct_day" && Number.isFinite(quote.changePercent)) {
    return `${Math.abs(quote.changePercent).toFixed(1)}%`;
  }
  return formatMarketPrice(quote.price, { minimumFractionDigits: 2 });
}

/** Snoozes a stored alert by id (the notification's secondary action). */
function snoozeStoredAlert(ctx: GloomPluginContext, id: string): void {
  const alerts = loadAlerts(ctx);
  const alert = alerts.find((entry) => entry.id === id);
  if (!alert) return;
  const description = formatAlertDescription(alert);
  saveAlerts(ctx, alerts.map((entry) => entry.id === id ? snoozeAlert(entry, SNOOZE_DURATION_MS) : entry));
  alertStream?.sync();
  ctx.notify({
    body: `${description} snoozed ${SNOOZE_MINUTES}m`,
    type: "info",
    source: "alerts",
  });
}

let catalystAlertsStop: (() => void) | null = null;
let scheduledAlertsStop: (() => void) | null = null;
let pollGeneration = 0;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let alertStream: AlertQuoteStream | null = null;

/**
 * Streamed checks judge every tick in memory; the last-checked fields they
 * leave behind are written at most this often, or at once when an alert
 * triggers or first gets a baseline.
 */
const STREAM_PERSIST_MS = 60_000;

export const alertsPlugin: GloomPlugin = {
  id: "alerts",
  name: "Alerts",
  version: "1.0.0",
  description: "Price, market and filing event alerts",
  toggleable: true,
  cliCommands: [alertsCliCommand],

  setup(ctx) {
    const generation = ++pollGeneration;
    catalystAlertsStop?.();
    catalystAlertsStop = startCatalystAlerts(ctx);
    scheduledAlertsStop?.();
    scheduledAlertsStop = startScheduledEventAlerts(ctx, scheduledEventSources(ctx.marketData));
    const notifyTriggered = (alert: AlertRule, at?: string) => {
      const description = formatAlertDescription(alert);
      ctx.notify({
        body: at ? `${description} triggered at ${at}` : `${description} triggered`,
        type: "success",
        refId: `price:${alert.id}`,
        source: "alerts",
        desktop: "always",
        persistent: true,
        sound: "Glass",
        action: {
          label: "Open",
          onClick: () => ctx.showPane("alerts"),
        },
        secondaryAction: {
          label: `Snooze ${SNOOZE_MINUTES}m`,
          onClick: () => snoozeStoredAlert(ctx, alert.id),
        },
      });
    };

    // The last price each alert was judged on by the stream. `crosses` needs
    // it tick to tick, and writing it to the store on every tick would churn
    // the saved config.
    const streamedBaselines = new Map<string, number>();
    let lastStreamPersistAt = 0;
    const evaluateStreamed = () => {
      if (generation !== pollGeneration) return;
      const alerts = loadAlerts(ctx);
      const now = Date.now();
      let persist = false;
      let touched = false;
      for (const alert of alerts) {
        if (alert.status !== "active" || !isQuoteAlertCondition(alert.condition)) continue;
        const quote = readStreamedAlertQuote(alert, undefined, now);
        if (!quote) continue;
        const snooze = resolveAlertSnooze(alert, now);
        if (snooze === "rearmed") persist = true;
        // A re-armed or new alert has no stored baseline: judge nothing on this
        // tick and store one at once, so `crosses` never compares against a
        // price from before the edit. A snooze keeps that baseline moving so
        // the move during the window does not fire when the window ends.
        const stored = alert.lastCheckedPrice;
        const previous = stored == null ? undefined : streamedBaselines.get(alert.id) ?? stored;
        if (stored == null) persist = true;
        if (snooze !== "snoozed") {
          const triggered = alert.condition === "pct_day"
            ? evaluatePctDayAlert(alert, quote.changePercent)
            : evaluateAlert({ ...alert, lastCheckedPrice: previous }, quote.price);
          if (triggered) {
            alert.status = "triggered";
            alert.triggeredAt = now;
            ctx.log.info("stream: TRIGGERED", { symbol: alert.symbol, price: quote.price, condition: alert.condition });
            notifyTriggered(alert, quoteTriggerText(alert, quote));
            persist = true;
          }
        }
        streamedBaselines.set(alert.id, alert.condition === "pct_day" ? quote.changePercent : quote.price);
        Object.assign(alert, quoteAlertFields(quote, now));
        if (alert.condition === "pct_day") {
          alert.lastCheckedPrice = Number.isFinite(quote.changePercent) ? quote.changePercent : undefined;
        }
        touched = true;
      }
      if (!persist && !(touched && now - lastStreamPersistAt >= STREAM_PERSIST_MS)) return;
      lastStreamPersistAt = now;
      saveAlerts(ctx, alerts);
      if (persist) alertStream?.sync();
    };
    alertStream?.dispose();
    alertStream = createAlertQuoteStream({ readAlerts: () => loadAlerts(ctx), onQuotes: evaluateStreamed });
    ctx.registerCommand({
      id: "set-alert",
      label: "Add Alert",
      description: "Create an alert from a symbol, condition, and target",
      keywords: ["add", "set", "alert", "price", "trigger", "notify", "alarm", "watch", "halt", "short", "dividend", "ex-div", "day"],
      category: "data",
      shortcut: "SA",
      shortcutArg: {
        placeholder: "AAPL above 200 / AAPL halted / AAPL day 5",
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
            { label: "Ex-div in days", value: "ex_div" },
            { label: "Day move %", value: "pct_day" },
            { label: "Short % float", value: "short_float" },
          ],
        },
        {
          key: "price",
          label: "Target",
          placeholder: "200.00 / 5% / 7d",
          type: "number",
          required: false,
        },
      ],
      async execute(values) {
        const input = parseAlertCommandValues(values);
        if (!input) throw new Error("Use a symbol, condition, and non-negative target. Halted does not need one.");
        // 7203:TSE, typed or from a link, is the venue its symbol trades on, as `alerts add` reads it.
        const settled = (await settleTypedListingKey(input.symbol, { store: ctx.tickerRepository, dataProvider: ctx.marketData })).toUpperCase();
        const listing = parsePublicTickerKey(settled);
        const alert = createAlert(listing.symbol, input.condition, input.price, listing.exchange);
        let currentPrice: number | null = null;
        if (isQuoteAlertCondition(input.condition)) {
          const quote = await resolveAlertQuote(ctx.marketData, settled);
          Object.assign(alert, quoteAlertFields(quote));
          alert.symbol = quote.symbol || listing.symbol;
          if (input.condition === "pct_day" && Number.isFinite(quote.changePercent)) {
            alert.lastCheckedPrice = quote.changePercent;
          }
          if (isPriceAlertCondition(input.condition)) currentPrice = alert.lastCheckedPrice ?? null;
        }
        const existing = loadAlerts(ctx);
        existing.push(alert);
        saveAlerts(ctx, existing);
        alertStream?.sync();

        ctx.notify({
          body: currentPrice != null
            ? `Alert set: ${formatAlertDescription(alert)} (current ${formatMarketPrice(currentPrice, { minimumFractionDigits: 2 })})`
            : `Alert set: ${formatAlertDescription(alert)}`,
          type: "success",
        });
      },
    });

    ctx.registerCommand({
      id: "set-event-alert",
      label: "Add Event Alert",
      description: "Create an alert before earnings, CPI or FOMC, or for filings, news and market moves",
      keywords: ["alert", "event", "congress", "13f", "fund", "member", "follow", "earnings", "cpi", "fomc", "days before"],
      category: "data",
      wizardLayout: "form",
      wizard: [
        {
          key: "event",
          label: "Event",
          type: "select",
          defaultValue: "congress-watched",
          options: [...Object.entries(RESEARCH_LABELS).map(([value,label]) => ({value,label})), ...EVENT_ALERT_TEMPLATES.map((entry) => ({ label: entry.label, value: entry.id }))],
        },
        ...EVENT_ALERT_TEMPLATES.filter((entry) => entry.field != null).map((entry) => ({
          key: entry.id,
          label: entry.field!,
          placeholder: entry.placeholder,
          type: "text" as const,
          required: true,
          dependsOn: { key: "event", value: entry.id },
        })),
        ...researchWizardFields,
      ],
      async execute(values = {}) {
        const event = values?.event || "congress-watched";
        const initial = readEventAlerts(ctx.configState.get<string>(EVENT_ALERTS_KEY) || "[]");
        if (initial.error) throw new Error(initial.error);
        if (initial.rules.length >= MAX_EVENT_ALERTS)
          throw new Error("Keep at most 40 event alerts.");
        // Earnings and macro events alert before a date: one has to be known, or the rule would never go off.
        const scheduled = event === "earnings_date" || event === "macro_event";
        if (scheduled && parseLeadDays(values[`${event}:leadDays`]) == null)
          throw new Error(`Days before must be a whole number from 1 to ${MAX_LEAD_DAYS}.`);
        let rule = isResearchAlertKind(event) ? createResearchAlert(event, values) : createEventAlert(event, values?.[event] || "");
        const target = scheduled ? readScheduledRule(rule)?.target : null;
        if (target) {
          const lookup = (await lookupScheduledDates([target], scheduledEventSources(ctx.marketData), newYorkToday()))
            .get(scheduledTargetKey(target));
          if (!lookup || "error" in lookup) throw new Error(eventDateUnavailableMessage(target, lookup?.error ?? "no answer"));
          if (!lookup.date) throw new Error(noUpcomingEventMessage(target));
          rule = { ...rule, eventDate: lookup.date };
        }
        // Read again: the lookup took a while and the rules may have changed meanwhile.
        const result = scheduled ? readEventAlerts(ctx.configState.get<string>(EVENT_ALERTS_KEY) || "[]") : initial;
        if (result.error) throw new Error(result.error);
        if (
          result.rules.some(
            (existing) =>
              existing.kind === rule.kind &&
              existing.target === rule.target &&
              existing.value.toLowerCase() === rule.value.toLowerCase(),
          )
        )
          throw new Error("This event is already followed.");
        await ctx.configState.set(EVENT_ALERTS_KEY, JSON.stringify([...result.rules, rule]));
        ctx.notify({ body: "Event alert saved.", type: "success" });
        if (scheduled) checkScheduledEventAlertsNow();
      },
    });

    // The poll carries whatever the stream does not: symbols the feed has not
    // delivered lately, every symbol while the app is hidden, and halt or
    // fundamentals checks, which a quote stream cannot answer.
    const poll = async () => {
      alertStream?.sync();
      const loaded = loadAlerts(ctx);
      const active = loaded.filter((alert) => alert.status === "active");
      const quoteAlerts = active.filter((alert) => isQuoteAlertCondition(alert.condition) && !readStreamedAlertQuote(alert));
      const fundamentalAlerts = active.filter((alert) => alert.condition === "short_float" || alert.condition === "ex_div");
      const haltDue = active.some((alert) => alert.condition === "halted" && !isAlertSnoozed(alert));
      const fundamentalsDue = fundamentalAlerts.some((alert) => !isAlertSnoozed(alert));
      if (quoteAlerts.length === 0 && !fundamentalsDue && !haltDue) return;

      ctx.log.info("poll", { quotes: quoteAlerts.length, fundamentals: fundamentalAlerts.length, halts: haltDue });

      // One batched pass over the distinct symbols: the alerts pane reads the same
      // persisted store, so this is the only place that talks to the provider.
      const quoteKeys = [...new Set(quoteAlerts.map(alertKey))];
      const fundKeys = [...new Set(fundamentalAlerts.filter((alert) => !isAlertSnoozed(alert)).map(alertKey))];
      const [quoteResults, fundResults, haltSymbols] = await Promise.all([
        Promise.all(quoteKeys.map(async (key): Promise<[string, Quote | string]> => {
          const [symbol, exchange = ""] = key.split("\0");
          try {
            return [key, await resolveAlertQuote(ctx.marketData, symbol ?? "", exchange)];
          } catch (err) {
            ctx.log.warn("poll: no quote", { symbol, exchange, error: String(err) });
            return [key, createQuoteErrorMessage(symbol ?? "", err)];
          }
        })),
        Promise.all(fundKeys.map(async (key): Promise<[string, FundSnapshot | string]> => {
          const [symbol, exchange = ""] = key.split("\0");
          try {
            const financials = await ctx.marketData.getTickerFinancials(symbol ?? "", exchange);
            return [key, financials.fundamentals ?? {}];
          } catch (err) {
            ctx.log.warn("poll: no fundamentals", { symbol, exchange, error: String(err) });
            return [key, "Fundamentals unavailable"];
          }
        })),
        haltDue ? loadHaltedSymbols(ctx) : Promise.resolve(undefined),
      ]);
      if (generation !== pollGeneration) return;
      const quotes = new Map(quoteResults);
      const fundamentals = new Map(fundResults);

      // Read the store again: the stream or the pane may have changed an alert
      // while the quotes were in flight, and an alert must trigger only once.
      const alerts = loadAlerts(ctx);
      const now = Date.now();
      let changed = false;
      const arm = (alert: AlertRule): boolean => {
        const snooze = resolveAlertSnooze(alert, now);
        if (snooze === "rearmed") changed = true;
        return snooze !== "snoozed";
      };
      const markTriggered = (alert: AlertRule, at?: string) => {
        alert.status = "triggered";
        alert.triggeredAt = now;
        ctx.log.info("poll: TRIGGERED", { symbol: alert.symbol, condition: alert.condition });
        notifyTriggered(alert, at);
      };

      for (const alert of alerts) {
        if (alert.status !== "active") continue;
        const key = alertKey(alert);

        if (isQuoteAlertCondition(alert.condition)) {
          if (readStreamedAlertQuote(alert, undefined, now)) continue;
          const quote = quotes.get(key);
          if (quote === undefined) continue;
          if (typeof quote === "string") {
            Object.assign(alert, quoteErrorAlertFields(quote));
            changed = true;
            continue;
          }
          if (!arm(alert)) {
            Object.assign(alert, quoteAlertFields(quote, now));
            if (alert.condition === "pct_day" && Number.isFinite(quote.changePercent)) {
              alert.lastCheckedPrice = quote.changePercent;
            }
            changed = true;
            continue;
          }
          const triggered = alert.condition === "pct_day"
            ? evaluatePctDayAlert(alert, quote.changePercent)
            : evaluateAlert(alert, quote.price);
          if (triggered) markTriggered(alert, quoteTriggerText(alert, quote));
          streamedBaselines.delete(alert.id);
          Object.assign(alert, quoteAlertFields(quote, now));
          if (alert.condition === "pct_day") {
            alert.lastCheckedPrice = Number.isFinite(quote.changePercent) ? quote.changePercent : undefined;
          }
          changed = true;
          continue;
        }

        if (alert.condition !== "halted" && alert.condition !== "short_float" && alert.condition !== "ex_div") continue;
        if (!arm(alert)) continue;

        if (alert.condition === "halted") {
          // A missing feed is not an empty tape: do not treat it as "not halted" and do not fire.
          if (haltSymbols == null) {
            if (haltSymbols === null) {
              Object.assign(alert, quoteErrorAlertFields("Halt status unavailable"));
              changed = true;
            }
            continue;
          }
          const halted = evaluateHaltedAlert(alert, haltSymbols);
          alert.lastCheckedPrice = halted ? 1 : 0;
          alert.lastCheckedAt = now;
          alert.lastCheckError = undefined;
          changed = true;
          if (halted) markTriggered(alert);
          continue;
        }

        const snapshot = fundamentals.get(key);
        if (snapshot === undefined) continue;
        if (typeof snapshot === "string") {
          Object.assign(alert, quoteErrorAlertFields(snapshot));
          changed = true;
          continue;
        }

        alert.lastCheckedAt = now;
        alert.lastCheckError = undefined;
        changed = true;
        if (alert.condition === "short_float") {
          const fraction = snapshot.shortPercentOfFloat;
          const triggered = evaluateShortFloatAlert(alert, fraction);
          if (fraction != null && Number.isFinite(fraction)) alert.lastCheckedPrice = shortFloatPercent(fraction);
          else delete alert.lastCheckedPrice;
          if (triggered && fraction != null && Number.isFinite(fraction)) {
            markTriggered(alert, `${shortFloatPercent(fraction).toFixed(1)}%`);
          }
          continue;
        }

        const exDate = parseExDividendDate(snapshot.exDividendDate);
        if (exDate) alert.lastCheckedPrice = utcDaysUntil(exDate, new Date(now));
        else delete alert.lastCheckedPrice;
        if (evaluateExDivAlert(alert, exDate, new Date(now))) markTriggered(alert);
      }

      if (changed) saveAlerts(ctx, alerts);
    };

    // Re-armed each cycle so a change to the pane's Check interval setting takes
    // effect on the next tick without a restart.
    const scheduleNextPoll = () => {
      if (generation !== pollGeneration) return;
      const seconds = Number(ctx.paneSettings?.get<string>("alerts", POLL_SECONDS_KEY));
      const delay = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : POLL_INTERVAL_MS;
      pollTimer = setTimeout(() => {
        void poll().finally(scheduleNextPoll);
      }, delay);
    };

    void poll().finally(scheduleNextPoll);

    ctx.registerPane({
      id: "alerts",
      reportFreshness: { source: "Your alerts", status: "not-a-feed", basis: "your alert rules" },
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
      description: "Price, market and filing event alerts",
      keywords: ["alerts", "price", "trigger", "alarm", "watch", "notify"],
      shortcut: { prefix: "ALRT" },
    });
  },

  dispose() {
    catalystAlertsStop?.();
    catalystAlertsStop = null;
    scheduledAlertsStop?.();
    scheduledAlertsStop = null;
    pollGeneration += 1;
    alertStream?.dispose();
    alertStream = null;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  },
};
