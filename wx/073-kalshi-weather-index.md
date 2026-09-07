# Plan 073: Kalshi weather index and calibration provenance

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: existing weather pane and Kalshi read-only client
- **Category**: weather / data provenance
- **Planned at**: 2026-08-31

## Why this matters

Kalshi now publishes the canonical minute-resolution city temperature index used
by hourly temperature markets at `GET /trade-api/v2/live_data/weather/{city}`.
The response includes `config_version`, and `detailed=true` exposes the raw
member-station readings and quality-control disposition that contributed to an
index point. A companion `/calibrations` endpoint publishes the append-only
configuration timeline: station weights, Celsius offsets, city reference,
effective windows, and methodology notes.

The existing weather pane already shows daily climate reports, TWC/METAR data,
and Kalshi-implied highs. It should surface the new index as supplementary
market evidence without replacing NWS CLI prints or changing settlement
authority.

## Scope

### In scope

- Add typed, defensive normalization for the weather-index and calibration
  response shapes, including missing `v` values on incomplete points and pending
  station codes.
- Add bounded in-memory caches and use the existing Kalshi transport and
  Connections reporting path. Hosted clients must use the existing Kalshi proxy;
  native clients may call the public endpoint directly.
- Support the currently documented `miami` city index through the existing `MIA`
  weather station mapping. Keep the mapping explicit so unsupported cities do
  not generate repeated 404s; add future city ids as the API expands.
- On weather station detail, show the latest complete index value, incomplete
  point count, config version, and the latest calibration summary (reference,
  station count, effective time, and change reason). Do not put fixed provenance
  text in a footer.
- Add parser, timestamp, cache, and partial-response regression tests.
- Update the weather source metadata and changelog documentation if needed.

### Out of scope

- Trading, order placement, authenticated Kalshi endpoints, or market discovery.
- Treating the Kalshi index as the official NWS climate settlement record.
- Reimplementing Kalshi’s index calculation or displaying every minute/station
  row in the main table.
- Adding city discovery before Kalshi publishes a supported list endpoint.

## Implementation steps

1. Define response/domain types and pure normalizers for index points, station
   audit records, and calibration records. Normalize seconds-vs-milliseconds
   timestamps and reject malformed points without failing the whole response.
2. Add `loadKalshiWeatherIndex` and `loadKalshiWeatherCalibrations` using the
   shared Kalshi fetch path, hosted proxy routing, `withConnectionRequest`, and
   short-lived caches. Expose cache reset helpers for tests.
3. Add the explicit station-to-city mapping and wire detail loading with
   cancellation/generation safety alongside the existing hourly/NWS requests.
4. Render the index/calibration provenance in `WeatherDetail`, with clear
   incomplete/no-data states and Fahrenheit/Celsius labels.
5. Run focused weather tests, all typechecks, `git diff --check`, and an isolated
   tmux smoke that opens `WX`, enters a supported detail view, and confirms no
   runtime warnings. Always remove the tmux session.

## Verification gates

- Malformed records and incomplete points never become fake zero values.
- Hosted URLs remain under `/api/proxy/kalshi`; native URLs target the Kalshi
  Trade API v2 live-data path.
- Every request is reported as `kalshi` traffic in Connections.
- Existing weather settlement and Kalshi-implied forecast tests remain green.
- Unsupported stations do not issue a network request.
- `bun run typecheck` and relevant focused tests pass; unrelated baseline suite
  failures are reported rather than hidden.

## STOP conditions

- Stop if the API response adds a breaking field contract that cannot be safely
  normalized from the published schema.
- Stop if hosted proxy routing needs a new authentication or secret; this is a
  public read-only endpoint and should remain keyless.
- Stop before broadening the city mapping from explicit supported IDs to guesses.
