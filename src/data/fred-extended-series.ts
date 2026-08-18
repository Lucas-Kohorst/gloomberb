/**
 * The hosted FRED proxy (`/cloud/econ/series/:id` on api.gloom.sh) serves a
 * server-side allowlist of series. Anything outside it answers HTTP 500 with
 * "Unsupported FRED series", so a pane built on those ids renders an empty
 * table rather than data. Verified 2026-08-17: `DGS10` and `CPIAUCSL` return
 * 200, while every id below returns the rejection.
 *
 * Panes that depend on these series stay hidden behind this flag instead of
 * shipping a permanently empty surface. Flip it to `true` once the proxy
 * allowlists:
 *
 *   Volatility:  VIXCLS, VXVCLS, VXMTCLS
 *   Corporate:   BAMLC0A0CM, BAMLH0A0HYM, BAMLC0A1CAAA, BAMLC0A2A,
 *                BAMLC0A3A, BAMLC0A4CBBB, BAMLC0A0C13Y, BAMLC0A0C510Y
 *
 * The allowlist lives in the Gloom Cloud backend, not in this repo.
 */
export const FRED_EXTENDED_SERIES_ENABLED = false;
