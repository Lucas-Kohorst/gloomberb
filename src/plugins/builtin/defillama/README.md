# DefiLlama charts

Open `CAT defillama` (also in CAT's Crypto tab), then graph a series or open its source page using the existing catalog actions. The starter catalog includes Ethereum, Solana, Base, and Arbitrum chain TVL, plus Aave, Uniswap, and Lido protocol TVL, daily fees, and daily revenue.

Custom Chart accepts explicit provider slugs:

```
G LLAMA:chain:ethereum:tvl
G LLAMA:protocol:aave:tvl
G LLAMA:protocol:uniswap:fees
G LLAMA:protocol:lido:revenue
```

Chain and protocol identities are distinct. Chain expressions support TVL only. Values are USD; fees and revenue are daily amounts, not cumulative totals. Historical chain TVL follows DefiLlama's methodology excluding liquid staking and double-counted TVL. Provider corrections can revise historical observations.

Expressions persist using the existing capability source (`CAP:defillama:chain/ethereum/tvl`). The source-owned client handles HTTP, normalization, caching, and request reporting. Both the registered chart capability and `createResolvedChartSources()` call the same adapter; hosted clients can resolve these public series even with capability invocation disabled. Connection registration runs in the Ticker Research plugin's setup, independently of capability discovery.

No API key is needed. Pro APIs, Artemis, Dune, token prices, and a standalone DeFi table are outside this integration.

Endpoint contracts verified September 7, 2026 against the [official free API documentation](https://api-docs.defillama.com/llms-free.txt) and live responses:

- `GET /v2/historicalChainTvl/{chain}`: `date` / `tvl` observations.
- `GET /protocol/{slug}`: `tvl` observations with `date` / `totalLiquidityUSD`.
- `GET /summary/fees/{slug}?dataType=dailyFees` or `dailyRevenue`: timestamp/value pairs in `totalDataChart`.
