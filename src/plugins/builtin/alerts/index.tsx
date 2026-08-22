import type { GloomPlugin } from "../../../types/plugin";
import { formatMarketPrice } from "../../../market-data/market/format";
import {
  createAlert,
  evaluateAlert,
  evaluateExDivAlert,
  evaluateHaltedAlert,
  evaluateShortFloatAlert,
  formatAlertDescription,
  utcDaysUntil,
} from "./alert-engine";
import {
  parseAlertCommandValues,
  parseAlertShortcutValues,
} from "./command";
import { isPriceAlertCondition } from "./types";
import type { AlertRule } from "./types";
import { POLL_INTERVAL_MS } from "./constants";
import { AlertsPane } from "./pane";
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
import { fetchMarketHalts } from "../market-halts/client";
import { fetchShortInterest } from "../short-interest/client";
import { fetchExDividendDate } from "../dividend-yield/client";

let pollInterval: ReturnType<typeof setInterval> | null = null;
let pollInFlight = false;

const SI_CACHE_MS = 60 * 60 * 1000;
const EXDIV_CACHE_MS = 6 * 60 * 60 * 1000;
const shortFloatCache = new Map<string, { at: number; value: number | null }>();
const exDivCache = new Map<string, { at: number; value: Date | null }>();

async function loadCached<T>(
  cache: Map<string, { at: number; value: T }>,
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function loadUnique<T>(
  symbols: string[],
  load: (symbol: string) => Promise<T>,
): Promise<{ values: Map<string, T>; errors: Map<string, unknown> }> {
  const values = new Map<string, T>();
  const errors = new Map<string, unknown>();
  const results = await Promise.all(symbols.map(async (symbol) => {
    try {
      return { symbol, value: await load(symbol) };
    } catch (error) {
      return { symbol, error };
    }
  }));
  for (const result of results) {
    if ("error" in result) errors.set(result.symbol, result.error);
    else values.set(result.symbol, result.value);
  }
  return { values, errors };
}

export const alertsPlugin: GloomPlugin = {
  id: "alerts",
  name: "Alerts",
  version: "1.0.0",
  description: "Price, halt, short-interest, and ex-div alerts with desktop notifications",
  toggleable: true,

  setup(ctx) {
    ctx.registerCommand({
      id: "set-alert",
      label: "Add Alert",
      description: "Create an alert from a symbol, condition, and target",
      keywords: ["add", "set", "alert", "price", "trigger", "notify", "alarm", "watch", "halt", "short", "dividend"],
      category: "data",
      shortcut: "SA",
      shortcutArg: {
        placeholder: "AAPL above 200 / AAPL halted / AAPL short 5",
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
          ],
        },
        {
          key: "price",
          label: "Target",
          placeholder: "200.00 / 5% / 7d",
          type: "number",
        },
      ],
      async execute(values) {
        const input = parseAlertCommandValues(values);
        if (!input) throw new Error("Use a symbol, condition, and target.");

        const alert = createAlert(input.symbol, input.condition, input.price);
        if (isPriceAlertCondition(input.condition)) {
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

    const markTriggered = (alert: AlertRule, detail: string, metric: number) => {
      alert.status = "triggered";
      alert.triggeredAt = Date.now();
      alert.lastCheckedPrice = metric;
      alert.lastCheckedAt = Date.now();
      alert.lastCheckError = undefined;
      ctx.log.info("poll: TRIGGERED", { symbol: alert.symbol, condition: alert.condition, detail });
      ctx.notify({
        body: `${formatAlertDescription(alert)} triggered (${detail})`,
        type: "success",
        desktop: "always",
        persistent: true,
        sound: "Glass",
      });
    };

    const poll = async () => {
      if (pollInFlight) return;
      pollInFlight = true;
      try {
        const alerts = loadAlerts(ctx);
        if (alerts.length === 0) return;

        const activeAlerts = alerts.filter((a) => a.status === "active");
        if (activeAlerts.length === 0) return;

        ctx.log.info("poll", { total: alerts.length, active: activeAlerts.length });

        let changed = false;
        const haltAlerts = activeAlerts.filter((alert) => alert.condition === "halted");
        const shortAlerts = activeAlerts.filter((alert) => alert.condition === "short_float");
        const exDivAlerts = activeAlerts.filter((alert) => alert.condition === "ex_div");
        const priceAlerts = activeAlerts.filter((alert) => isPriceAlertCondition(alert.condition));
        const now = new Date();

        const [haltResult, shortResult, exDivResult] = await Promise.all([
          haltAlerts.length === 0
            ? Promise.resolve(null)
            : fetchMarketHalts().then((halts) => ({
              tickers: new Set(halts.filter((halt) => halt.status === "active").map((halt) => halt.ticker.toUpperCase())),
            })).catch((error: unknown) => ({ error })),
          shortAlerts.length === 0
            ? Promise.resolve(null)
            : loadUnique([...new Set(shortAlerts.map((alert) => alert.symbol))], (symbol) =>
              loadCached(shortFloatCache, symbol, SI_CACHE_MS, async () => {
                const rows = await fetchShortInterest(symbol);
                return rows.at(-1)?.shortPercentFloat ?? null;
              })),
          exDivAlerts.length === 0
            ? Promise.resolve(null)
            : loadUnique([...new Set(exDivAlerts.map((alert) => alert.symbol))], (symbol) =>
              loadCached(exDivCache, symbol, EXDIV_CACHE_MS, () => fetchExDividendDate(symbol))),
        ]);

        if (haltResult && "error" in haltResult) {
          for (const alert of haltAlerts) {
            Object.assign(alert, quoteErrorAlertFields(createQuoteErrorMessage(alert.symbol, haltResult.error)));
          }
          changed = true;
        } else if (haltResult) {
          for (const alert of haltAlerts) {
            const halted = evaluateHaltedAlert(alert, haltResult.tickers);
            alert.lastCheckedPrice = halted ? 1 : 0;
            alert.lastCheckedAt = Date.now();
            alert.lastCheckError = undefined;
            if (halted) markTriggered(alert, "active halt", 1);
            changed = true;
          }
        }

        if (shortResult) {
          for (const alert of shortAlerts) {
            const error = shortResult.errors.get(alert.symbol);
            if (error) {
              Object.assign(alert, quoteErrorAlertFields(createQuoteErrorMessage(alert.symbol, error)));
              changed = true;
              continue;
            }
            if (!shortResult.values.has(alert.symbol)) continue;
            const pct = shortResult.values.get(alert.symbol) ?? null;
            if (pct == null) {
              Object.assign(alert, quoteErrorAlertFields(`No short % float for "${alert.symbol}".`));
              changed = true;
              continue;
            }
            alert.lastCheckedPrice = pct;
            alert.lastCheckedAt = Date.now();
            alert.lastCheckError = undefined;
            if (evaluateShortFloatAlert(alert, pct)) markTriggered(alert, `${pct.toFixed(1)}% of float`, pct);
            changed = true;
          }
        }

        if (exDivResult) {
          for (const alert of exDivAlerts) {
            const error = exDivResult.errors.get(alert.symbol);
            if (error) {
              Object.assign(alert, quoteErrorAlertFields(createQuoteErrorMessage(alert.symbol, error)));
              changed = true;
              continue;
            }
            if (!exDivResult.values.has(alert.symbol)) continue;
            const exDate = exDivResult.values.get(alert.symbol) ?? null;
            if (!exDate) {
              Object.assign(alert, quoteErrorAlertFields(`No ex-div date for "${alert.symbol}".`));
              changed = true;
              continue;
            }
            const days = utcDaysUntil(exDate, now);
            alert.lastCheckedPrice = days;
            alert.lastCheckedAt = Date.now();
            alert.lastCheckError = undefined;
            if (evaluateExDivAlert(alert, exDate, now)) markTriggered(alert, `${days}d to ex-div`, days);
            changed = true;
          }
        }

        const quoteResults = await Promise.all(priceAlerts.map(async (alert) => {
          try {
            const quote = await resolveAlertQuote(ctx.marketData, alert.symbol, alert.exchange);
            return { alert, quote };
          } catch (error) {
            return { alert, error };
          }
        }));
        for (const result of quoteResults) {
          if ("error" in result && result.error) {
            ctx.log.error("poll: error", { symbol: result.alert.symbol, error: String(result.error) });
            Object.assign(result.alert, quoteErrorAlertFields(createQuoteErrorMessage(result.alert.symbol, result.error)));
            changed = true;
            continue;
          }
          const quote = "quote" in result ? result.quote : null;
          if (!quote || typeof quote.price !== "number") {
            ctx.log.warn("poll: no quote", { symbol: result.alert.symbol });
            Object.assign(result.alert, quoteErrorAlertFields(`No quote found for "${result.alert.symbol}".`));
            changed = true;
            continue;
          }
          if (evaluateAlert(result.alert, quote.price)) {
            markTriggered(result.alert, formatMarketPrice(quote.price, { minimumFractionDigits: 2 }), quote.price);
          }
          Object.assign(result.alert, quoteAlertFields(quote));
          changed = true;
        }

        if (changed) saveAlerts(ctx, alerts);
      } finally {
        pollInFlight = false;
      }
    };

    poll();
    pollInterval = setInterval(poll, POLL_INTERVAL_MS);

    ctx.registerPane({
      id: "alerts",
      name: "Alerts",
      icon: "A",
      component: AlertsPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 82, height: 20 },
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
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    pollInFlight = false;
  },
};
