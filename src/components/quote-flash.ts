import { useEffect, useRef, useState } from "react";
import type { TickerFinancials } from "../types/financials";
import { getActiveQuoteDisplay } from "../market-data/market/status";

export type QuoteFlashDirection = "up" | "down" | "flat";

export const FLASH_DURATION_MS = 450;

export function resolveFlashDirection(previousPrice: number, nextPrice: number): QuoteFlashDirection {
  if (nextPrice > previousPrice) return "up";
  if (nextPrice < previousPrice) return "down";
  return "flat";
}

/** Diff two numeric maps and record the next prices. First sightings do not flash. */
export function collectNumberFlashes(
  previousPrices: Map<string, number>,
  nextValues: Iterable<readonly [string, number | null | undefined]>,
): { prices: Map<string, number>; flashes: Map<string, QuoteFlashDirection> } {
  const prices = new Map(previousPrices);
  const flashes = new Map<string, QuoteFlashDirection>();
  for (const [key, value] of nextValues) {
    if (value == null || !Number.isFinite(value)) continue;
    const previous = prices.get(key);
    if (previous != null && previous !== value) {
      flashes.set(key, resolveFlashDirection(previous, value));
    }
    prices.set(key, value);
  }
  return { prices, flashes };
}

export function numberFlashSignature(
  values: Iterable<readonly [string, number | null | undefined]>,
): string {
  const parts: string[] = [];
  for (const [key, value] of values) {
    if (value == null || !Number.isFinite(value)) continue;
    parts.push(`${key}:${value}`);
  }
  parts.sort();
  return parts.join("|");
}

function resolveFlashPrice(financials: TickerFinancials | null | undefined): number | null {
  return getActiveQuoteDisplay(financials?.quote)?.price ?? financials?.quote?.price ?? null;
}

export function useNumberFlashMap(
  values: Iterable<readonly [string, number | null | undefined]>,
  enabled: boolean,
): Map<string, QuoteFlashDirection> {
  const [flashSymbols, setFlashSymbols] = useState<Map<string, QuoteFlashDirection>>(new Map());
  const previousPricesRef = useRef<Map<string, number>>(new Map());
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const signature = numberFlashSignature(values);

  useEffect(() => {
    const { prices, flashes } = collectNumberFlashes(
      previousPricesRef.current,
      valuesRef.current,
    );
    previousPricesRef.current = prices;

    if (!enabled) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      setFlashSymbols((current) => (current.size === 0 ? current : new Map()));
      return;
    }

    if (flashes.size === 0) return;

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setFlashSymbols(flashes);
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setFlashSymbols(new Map());
    }, FLASH_DURATION_MS);
  }, [enabled, signature]);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  return flashSymbols;
}

export function useQuoteFlashMap(
  financialsMap: Map<string, TickerFinancials>,
  enabled: boolean,
): Map<string, QuoteFlashDirection> {
  const [flashSymbols, setFlashSymbols] = useState<Map<string, QuoteFlashDirection>>(new Map());
  const previousPricesRef = useRef<Map<string, number>>(new Map());
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const nextValues: Array<readonly [string, number | null]> = [];
    for (const [symbol, financials] of financialsMap) {
      nextValues.push([symbol, resolveFlashPrice(financials)]);
    }
    const { prices, flashes } = collectNumberFlashes(previousPricesRef.current, nextValues);
    previousPricesRef.current = prices;

    if (!enabled) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      setFlashSymbols((current) => (current.size === 0 ? current : new Map()));
      return;
    }

    if (flashes.size === 0) return;

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setFlashSymbols(flashes);
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setFlashSymbols(new Map());
    }, FLASH_DURATION_MS);
  }, [enabled, financialsMap]);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  return flashSymbols;
}

export function useQuoteFlashDirection(
  financials: TickerFinancials | null | undefined,
  enabled: boolean,
): QuoteFlashDirection | undefined {
  const [flashDirection, setFlashDirection] = useState<QuoteFlashDirection | undefined>();
  const previousPriceRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const price = resolveFlashPrice(financials);
    const previousPrice = previousPriceRef.current;
    if (price != null) {
      previousPriceRef.current = price;
    }

    if (!enabled) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      setFlashDirection(undefined);
      return;
    }

    if (price == null) return;
    if (previousPrice == null || previousPrice === price) return;

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setFlashDirection(resolveFlashDirection(previousPrice, price));
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setFlashDirection(undefined);
    }, FLASH_DURATION_MS);
  }, [enabled, financials]);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  return flashDirection;
}
