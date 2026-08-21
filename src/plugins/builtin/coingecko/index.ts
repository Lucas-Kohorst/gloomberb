import type { GloomPlugin } from "../../../types/plugin";
import { CoinGeckoProvider, createCoinGeckoCapabilities } from "../../../sources/coingecko/provider";
import { COINGECKO_CONNECTION_ID, COINGECKO_PROVIDER_ID } from "../../../sources/coingecko/ids";
import { setCoinGeckoAuth } from "../../../sources/coingecko/client";
import { registerConnectionSource } from "../connections/register";
import { registerByokKnownService } from "../byok/services";

const provider = new CoinGeckoProvider();
let disposeConnection: (() => void) | null = null;

export const coingeckoPlugin: GloomPlugin = {
  id: COINGECKO_PROVIDER_ID,
  name: "CoinGecko",
  version: "1.0.0",
  description: "Crypto quotes, market cap, and price history from CoinGecko.",
  capabilities: createCoinGeckoCapabilities(provider),
  setup(ctx) {
    registerByokKnownService({
      id: COINGECKO_CONNECTION_ID,
      name: "CoinGecko",
      apiUrl: "https://api.coingecko.com/api/v3",
      authType: "header",
      authKey: "x-cg-demo-api-key",
      envVar: "COINGECKO_API_KEY",
      description: "Optional Demo/Pro API key for higher CoinGecko rate limits. Public endpoints work without a key.",
    });
    const apiKey = ctx.getApiKey(COINGECKO_CONNECTION_ID) ?? process.env.COINGECKO_PRO_API_KEY ?? process.env.COINGECKO_API_KEY;
    setCoinGeckoAuth({
      apiKey: apiKey ?? null,
      pro: Boolean(process.env.COINGECKO_PRO_API_KEY),
    });
    disposeConnection = registerConnectionSource({
      id: COINGECKO_CONNECTION_ID,
      name: "CoinGecko",
      kind: "asset-data",
      pluginId: COINGECKO_PROVIDER_ID,
      priority: 80,
      authRequired: false,
    });
  },
  dispose() {
    disposeConnection?.();
    disposeConnection = null;
    setCoinGeckoAuth({ apiKey: null, pro: false });
  },
};
