import { isHostedWebClient } from "../../../shared/hosted-api";
import { httpFetch } from "../../../utils/http-transport";
import { readProcessEnv } from "../../../utils/process-env";
import { fetchByokViaProxy } from "../byok/request";
import { withConnectionRequest } from "../connections/register";
import { fixtureSearchParams, oddsSearchParams, resolveOddsScope } from "./query";
import {
  OPTICODDS_API_BASE_URL,
  OPTICODDS_CONNECTION_ID,
  OPTICODDS_FIXTURE_LIMIT,
  type OddsRow,
} from "./types";

let resolveApiKey: () => string | undefined = () => readProcessEnv("OPTICODDS_API_KEY");

export function setOpticOddsApiKeyResolver(resolver: () => string | undefined): void {
  resolveApiKey = resolver;
}

export function resolveOpticOddsApiKey(): string | undefined {
  return resolveApiKey()?.trim() || readProcessEnv("OPTICODDS_API_KEY");
}

function apiErrorMessage(status: number, body: string): string {
  let detail = "";
  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
    if (typeof parsed.error === "string") detail = parsed.error;
    else if (typeof parsed.message === "string") detail = parsed.message;
  } catch {
    detail = body.trim();
  }
  const suffix = detail ? `: ${detail.slice(0, 180)}` : "";
  return `OpticOdds request failed (${status})${suffix}`;
}

async function opticGet(path: string, params: URLSearchParams, key: string, signal?: AbortSignal): Promise<unknown> {
  const url = `${OPTICODDS_API_BASE_URL}${path}?${params.toString()}`;
  const headers = {
    Accept: "application/json",
    "X-Api-Key": key,
  };
  if (isHostedWebClient()) {
    const proxied = await fetchByokViaProxy(url, headers);
    if (!proxied.ok) throw new Error(apiErrorMessage(proxied.status, proxied.body));
    return JSON.parse(proxied.body) as unknown;
  }
  const response = await httpFetch(url, { method: "GET", headers, signal });
  const body = await response.text();
  if (!response.ok) throw new Error(apiErrorMessage(response.status, body));
  return JSON.parse(body) as unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function dataRows(payload: unknown): Record<string, unknown>[] {
  const record = asRecord(payload);
  const data = record?.data;
  if (!Array.isArray(data)) return [];
  return data.filter((row): row is Record<string, unknown> => !!asRecord(row));
}

function named(value: unknown): string {
  const record = asRecord(value);
  return asString(record?.name) || asString(value);
}

interface FixtureSummary {
  id: string;
  home: string;
  away: string;
  start: string;
  label: string;
}

function parseFixture(row: Record<string, unknown>): FixtureSummary | null {
  const id = asString(row.id);
  if (!id) return null;
  const home = asString(row.home_team_display);
  const away = asString(row.away_team_display);
  const league = named(row.league);
  const sport = named(row.sport);
  return {
    id,
    home,
    away,
    start: asString(row.start_date),
    label: `${away} ${home} ${league} ${sport}`.toLowerCase(),
  };
}

function openableUrl(value: unknown): string | null {
  const desktop = asString(asRecord(value)?.desktop);
  if (!desktop.startsWith("https://")) return null;
  if (desktop.includes("<")) return null;
  return desktop;
}

function parseOdds(payload: unknown): OddsRow[] {
  const rows: OddsRow[] = [];
  for (const fixture of dataRows(payload)) {
    const fixtureId = asString(fixture.id);
    const home = asString(fixture.home_team_display);
    const away = asString(fixture.away_team_display);
    const start = asString(fixture.start_date);
    const startMs = Date.parse(start);
    const matchup = away && home ? `${away} @ ${home}` : home || away || fixtureId;
    const odds = Array.isArray(fixture.odds) ? fixture.odds : [];
    for (const entry of odds) {
      const odd = asRecord(entry);
      if (!odd) continue;
      const selection = asString(odd.selection) || asString(odd.name);
      const sportsbook = asString(odd.sportsbook);
      const price = typeof odd.price === "number" && Number.isFinite(odd.price) ? odd.price : null;
      const id = asString(odd.id) || `${fixtureId}:${sportsbook}:${selection}:${price ?? ""}`;
      rows.push({
        id,
        fixtureId,
        matchup,
        start,
        startMs: Number.isNaN(startMs) ? 0 : startMs,
        sportsbook,
        selection,
        price,
        url: openableUrl(odd.deep_link),
      });
    }
  }
  return rows;
}

export async function loadOpticOdds(query: string, signal?: AbortSignal): Promise<OddsRow[]> {
  const key = resolveOpticOddsApiKey();
  if (!key) {
    throw new Error("OpticOdds API key missing. Add it in Account Management on the Keys tab.");
  }
  const scope = resolveOddsScope(query);
  return withConnectionRequest(OPTICODDS_CONNECTION_ID, "odds", async () => {
    let fixtureIds: string[] = [];
    if (scope.fixtureId) {
      fixtureIds = [scope.fixtureId];
    } else {
      const payload = await opticGet("/fixtures/active", fixtureSearchParams(scope), key, signal);
      const text = scope.text?.toLowerCase();
      fixtureIds = dataRows(payload)
        .map(parseFixture)
        .filter((fixture): fixture is FixtureSummary => !!fixture)
        .filter((fixture) => !text || fixture.label.includes(text))
        .slice(0, OPTICODDS_FIXTURE_LIMIT)
        .map((fixture) => fixture.id);
    }
    if (fixtureIds.length === 0) return [];
    const odds = await opticGet("/fixtures/odds", oddsSearchParams(fixtureIds), key, signal);
    return parseOdds(odds);
  });
}
