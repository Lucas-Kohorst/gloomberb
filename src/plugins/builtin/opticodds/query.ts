import { OPTICODDS_SPORTSBOOKS } from "./types";

/**
 * OpticOdds rejects `/fixtures` and `/fixtures/active` unless the query has at
 * least one of sport, league, or fixture id, and `/fixtures/odds` unless it
 * has a fixture_id (or team/player id) plus a sportsbook. A bare search string
 * is not one of those filters.
 */
export interface OddsScope {
  sport?: string;
  league?: string;
  fixtureId?: string;
  /** Applied to the rows after a filtered request. Never sent on its own. */
  text?: string;
}

interface LeagueDef {
  id: string;
  sport: string;
  aliases: readonly string[];
}

interface SportDef {
  id: string;
  defaultLeague: string;
  aliases: readonly string[];
}

/** The board the pane opens on: NFL is in season and always has moneylines. */
export const DEFAULT_ODDS_SCOPE: OddsScope = { sport: "football", league: "nfl" };

const LEAGUES: readonly LeagueDef[] = [
  { id: "nfl", sport: "football", aliases: ["nfl"] },
  { id: "ncaaf", sport: "football", aliases: ["ncaaf", "college football"] },
  { id: "nba", sport: "basketball", aliases: ["nba"] },
  { id: "wnba", sport: "basketball", aliases: ["wnba"] },
  { id: "ncaab", sport: "basketball", aliases: ["ncaab", "college basketball"] },
  { id: "mlb", sport: "baseball", aliases: ["mlb"] },
  { id: "nhl", sport: "hockey", aliases: ["nhl"] },
  { id: "ufc", sport: "mma", aliases: ["ufc", "mma"] },
  { id: "england_-_premier_league", sport: "soccer", aliases: ["epl", "premier league"] },
  { id: "spain_-_la_liga", sport: "soccer", aliases: ["la liga", "laliga"] },
  { id: "germany_-_bundesliga", sport: "soccer", aliases: ["bundesliga"] },
  { id: "italy_-_serie_a", sport: "soccer", aliases: ["serie a"] },
  { id: "france_-_ligue_1", sport: "soccer", aliases: ["ligue 1"] },
  { id: "atp", sport: "tennis", aliases: ["atp"] },
  { id: "pga", sport: "golf", aliases: ["pga"] },
];

const SPORTS: readonly SportDef[] = [
  { id: "football", defaultLeague: "nfl", aliases: ["football", "american football"] },
  { id: "basketball", defaultLeague: "nba", aliases: ["basketball"] },
  { id: "baseball", defaultLeague: "mlb", aliases: ["baseball"] },
  { id: "hockey", defaultLeague: "nhl", aliases: ["hockey"] },
  { id: "soccer", defaultLeague: "england_-_premier_league", aliases: ["soccer"] },
  { id: "tennis", defaultLeague: "atp", aliases: ["tennis"] },
  { id: "golf", defaultLeague: "pga", aliases: ["golf"] },
];

const LEAGUE_ALIASES = [...LEAGUES]
  .flatMap((league) => league.aliases.map((alias) => ({ alias, league })))
  .sort((left, right) => right.alias.length - left.alias.length);

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** OpticOdds fixture ids are a single alphanumeric token that contains a digit. */
export function isFixtureId(value: string): boolean {
  return /^[A-Za-z0-9]{10,}$/.test(value) && /\d/.test(value);
}

export function resolveOddsScope(query: string): OddsScope {
  const trimmed = query.trim();
  const normalized = normalize(trimmed);
  if (!normalized) return { ...DEFAULT_ODDS_SCOPE };
  if (isFixtureId(trimmed)) return { fixtureId: trimmed };

  const league = LEAGUE_ALIASES.find((entry) => entry.alias === normalized)?.league;
  if (league) return { sport: league.sport, league: league.id };

  const sport = SPORTS.find((entry) => entry.aliases.includes(normalized));
  if (sport) return { sport: sport.id, league: sport.defaultLeague };

  return { ...DEFAULT_ODDS_SCOPE, text: normalized };
}

export function scopeHasRequiredFilter(scope: OddsScope): boolean {
  return Boolean(scope.fixtureId || scope.sport || scope.league);
}

function requireFilter(params: URLSearchParams, keys: readonly string[]): URLSearchParams {
  const present = keys.some((key) => params.getAll(key).some((value) => value.trim().length > 0));
  if (!present) {
    throw new Error("OpticOdds request missing sport, league, or fixture_id");
  }
  return params;
}

/** `/fixtures` and `/fixtures/active` take `id`, not `fixture_id`. */
export function fixtureSearchParams(scope: OddsScope): URLSearchParams {
  const params = new URLSearchParams();
  if (scope.fixtureId) params.append("id", scope.fixtureId);
  if (scope.sport) params.set("sport", scope.sport);
  if (scope.league) params.set("league", scope.league);
  return requireFilter(params, ["sport", "league", "id"]);
}

/** `/fixtures/odds` requires fixture_id plus at least one sportsbook. */
export function oddsSearchParams(fixtureIds: readonly string[]): URLSearchParams {
  const params = new URLSearchParams();
  for (const fixtureId of fixtureIds) {
    const id = fixtureId.trim();
    if (id) params.append("fixture_id", id);
  }
  for (const sportsbook of OPTICODDS_SPORTSBOOKS) params.append("sportsbook", sportsbook);
  params.set("market", "moneyline");
  params.set("is_main", "true");
  return requireFilter(params, ["fixture_id"]);
}
