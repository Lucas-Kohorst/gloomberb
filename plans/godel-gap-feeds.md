# Godel Terminal Gap — Required Data Feeds

Gaps from the Godel Terminal feature comparison that need **net-new data sources**
to implement. Each section describes the feature, why existing data is insufficient,
and candidate feeds ranked by accessibility (free first).

## Already covered by existing features (aliases, no new plugin needed)

| Godel | Existing Gloom | Note |
|-------|---------------|------|
| EQS | `SCR` (Screener) | Gloom's screener already covers equity screening |
| FOCUS | Watchlist / `PF` (Portfolio) | Gloom's portfolio and watchlist cover focus lists |
| AL | `ALRT` / `SA` / `WA` (Alerts) | Gloom's alert system already covers alert lists |
| ALLQ | `QQ` (Quote Monitor) | Gloom's quote monitor covers multi-ticker quotes |
| HELP | Help pane (`Ctrl+?`) | Gloom has a dedicated help pane with shortcut inventory |

## Built with existing data (plugins implemented this session)

| Godel | Plugin | Data source |
|-------|--------|------------|
| PAT | `patterns/` | OHLCV price history (`getPriceHistory`) |
| TREND | `trend-analysis/` | OHLCV price history |
| TAS | `technical-summary/` | OHLCV price history |
| MOSO | `momentum/` | OHLCV price history |
| CF | `cash-flow/` | `FinancialStatement` cash flow fields from `getTickerFinancials` |
| AUM | `assets-under-management/` | `Quote.marketCap`, `Fundamentals.sharesOutstanding` |

## Needs net-new data feeds

### SPLC — Supply Chain Analysis

**What:** Supplier/customer relationship graph for a ticker. Shows upstream
suppliers, downstream customers, and revenue exposure percentages.

**Why existing data is insufficient:** Gloom has `GR` (relationship graph) which
shows ticker-to-ticker correlations, but not fundamental supply-chain links.
SEC filings mention major customers/suppliers in MD&A but require NLP extraction.

**Candidate feeds:**

1. **SEC 10-K/10-Q NLP extraction** (free, build-it-yourself)
   - Parse "Risk Factors" and "MD&A" sections from filings we already fetch via `SEC`
   - Extract named entities for "major customers" and "key suppliers"
   - Effort: High (NLP pipeline). Data quality: Medium (incomplete, inconsistent disclosure).
   - No new API needed — extend the existing SEC plugin.

2. **Crunchbase API** (freemium)
   - `https://api.crunchbase.com/api/v4` — company relationships, acquisitions, investments
   - Free tier: limited, paid for full access
   - Good for startup/private company supply chains
   - Effort: Low (API integration). Cost: $0–$600/mo.

3. **FactSet Supply Chain Relationships** (paid, enterprise)
   - Structured supplier/customer data with revenue exposure estimates
   - Gold standard but expensive
   - Effort: Low (API). Cost: $$$ (enterprise contract).

4. **S&P Global Market Intelligence — Supply Chain** (paid)
   - Similar to FactSet, structured supply chain relationships
   - Effort: Low (API). Cost: $$$.

**Recommendation:** Start with SEC NLP extraction (free, extends existing SEC
plugin). Add Crunchbase API as a second source for private companies.

---

### BUDDY — Platform Users / Fan Agents

**What:** Social feature for platform users — user profiles, fan agent
interactions, and community connections. NOT an AI companion.

**Why existing data is insufficient:** This is a platform/community feature, not
a data feed. Gloom has no user profile system or social graph.

**What would be needed:**
- User profile API (user registration, profile data, preferences)
- Social graph (follow/block, connections between users)
- Fan agent interactions (messages, mentions, reactions)
- Real-time presence (who's online, active sessions)

**Recommendation:** This is a platform infrastructure project, not a plugin.
Requires backend services for user management, real-time messaging, and social
graph storage. Defer until the platform has a user authentication and social
layer.

---

### CITADEL — Market Maker Flow

**What:** Market maker order flow data, specifically Citadel Securities flow
patterns, dark pool activity, and short volume.

**Why existing data is insufficient:** Gloom has no order flow or market maker
data. Quote data from Yahoo is delayed/pooled, not per-exchange flow.

**Candidate feeds:**

1. **FINRA Short Volume** (free)
   - `https://www.finra.org/regulation/filing-reporting/regulatory-financial-system/fraqs-short-sale-volume`
   - Published twice monthly, per-symbol short volume by exchange
   - Effort: Low (CSV download + parse). Data quality: Medium (bi-monthly, not real-time).

2. **DIX / Dark Index** (free)
   - `https://squeezemetrics.com/aggregate/dix` — dark pool short percentage
   - Daily aggregate, not per-trade
   - Effort: Low (API/scrape). Data quality: Medium (aggregate only).

3. **NYSE / NASDAQ TotalView** (paid)
   - Real-time order-by-order trade data including market maker IDs
   - Effort: High (high-volume feed, requires special data agreement). Cost: $$$.

4. **Citadel Connect / ONE** (not publicly available)
   - Citadel's own PFOF flow data is not publicly accessible
   - Would require a commercial agreement with Citadel Securities

**Recommendation:** Start with FINRA short volume (free, bi-monthly) and DIX
(free, daily). These give approximate dark pool / short selling pressure
without true market-maker-level flow. True Citadel flow requires enterprise
data agreements.

---

### WEIF — World ETF Indices

**What:** ETF-level data for world index ETFs (e.g., SPY, EEM, VWO, AGG) —
AUM, expense ratios, holdings, tracking error, and performance vs benchmark.

**Why existing data is insufficient:** Gloom has `WEI` (world equity indices)
which shows index-level data, but not ETF-specific metrics like expense ratios,
tracking error, or fund flows. Yahoo provides basic ETF quotes but not the
full ETF analytics layer.

**Candidate feeds:**

1. **Yahoo Finance ETF data** (free, already used)
   - We already fetch ETF quotes and price history via Yahoo
   - Can derive: price, volume, market cap, basic fundamentals
   - Effort: Low (extend existing Yahoo provider). Data quality: Medium (no expense ratio, tracking error).

2. **iShares / Vanguard fund pages** (free, scrape)
   - `https://www.ishares.com/` and `https://investor.vanguard.com/`
   - Expense ratios, holdings, tracking error, fund flows
   - Effort: Medium (per-provider scraping). Data quality: High for those providers.

3. **Morningstar ETF API** (paid)
   - Comprehensive ETF data including holdings, expense ratios, tracking error, analyst ratings
   - Effort: Low (API). Cost: $$ (developer tier ~$200/mo).

4. **ETF.com API** (freemium)
   - ETF fundamentals, holdings, fund flows
   - Free tier limited, paid for full access

**Recommendation:** Start by extending the existing Yahoo provider to show
ETF-specific fields from the quote/fundamentals data we already fetch. Add
iShares/Vanguard scraping for expense ratio and tracking error on the most
tracked ETFs.

---

### WJI — World Jobless Index

**What:** Unemployment rate by country, with historical trends and
comparative analysis.

**Why existing data is insufficient:** Gloom has `WB` (World Bank country
economics) which may include some labor data, but no dedicated unemployment
tracking pane.

**Candidate feeds:**

1. **ILOSTAT API** (free)
   - `https://ilostat.ilo.org/data/` — International Labour Organization
   - Unemployment rates by country, age group, sex
   - REST API, JSON responses, no API key required
   - Effort: Low (API integration). Data quality: High (official ILO data).

2. **World Bank API** (free, already integrated)
   - `https://api.worldbank.org/v2/country/all/indicator/SL.UEM.TOTL.ZS`
   - We already have a `WB` plugin — extend it with unemployment indicators
   - Effort: Very Low (add indicator codes to existing plugin). Data quality: Medium (World Bank data lags ILO).

3. **OECD Stats API** (free)
   - `https://stats.oecd.org/SDMX-JSON/data/` — unemployment by country
   - More timely than World Bank for OECD countries
   - Effort: Low (API). Data quality: High for OECD members.

**Recommendation:** Extend the existing `WB` (World Bank) plugin with
unemployment indicators (`SL.UEM.TOTL.ZS`). This requires no new API — just
adding indicator codes to the existing World Bank client. Add ILOSTAT as a
second source for non-World-Bank countries.

---

### HCP — Healthcare Providers

**What:** Healthcare sector data — hospital systems, provider networks,
Medicare/Medicaid reimbursement, and healthcare company fundamentals.

**Why existing data is insufficient:** Gloom has no healthcare-specific data
source. General financial data covers healthcare tickers but not
sector-specific metrics like patient volumes, payer mix, or reimbursement rates.

**Candidate feeds:**

1. **CMS Data** (free)
   - `https://data.cms.gov/` — Centers for Medicare & Medicaid Services
   - Provider utilization, Medicare claims, hospital compare data
   - Effort: Medium (large datasets, CSV/JSON downloads). Data quality: High (official).

2. **HHS Health Data** (free)
   - `https://healthdata.gov/` — HHS open data portal
   - Public health datasets, hospital capacity, healthcare workforce
   - Effort: Medium. Data quality: High.

3. **NIH RePORTER** (free)
   - `https://reporter.nih.gov/` — NIH research grants by institution
   - Shows funding flows to healthcare companies and research institutions
   - Effort: Low (API). Data quality: High for research funding.

**Recommendation:** This is a niche sector feature. Defer unless there's
specific demand. If built, start with CMS provider data (free, comprehensive)
as a new data-pane plugin.

---

## Unclear — Could not determine from browser exploration

These Godel commands were observed but their function could not be determined
from read-only browser exploration. Further investigation needed:

| Command | Possible meaning | Next step |
|---------|-----------------|-----------|
| ATLAS | Macro dashboard? | Explore via backtick `ATLAS` in Godel |
| DES | Description / design tool? | Explore via backtick `DES` |
| ENT | Entity search? | Explore via backtick `ENT` |
| GLCO | Global company overview? | Explore via backtick `GLCO` |
| HMS | Historical market structure? | Explore via backtick `HMS` |
| IMAP | IMAP email integration | Low priority — not relevant to Gloom's scope |
