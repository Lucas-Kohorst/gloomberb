import type { GloomPlugin } from "../../../types/plugin";
import { COINGECKO_PROVIDER_ID } from "../../../sources/coingecko/ids";

export const coingeckoPlugin: GloomPlugin = {
  id: COINGECKO_PROVIDER_ID,
  name: "CoinGecko",
  version: "1.0.0",
  description: "Retired quote source. Crypto prices come from Yahoo.",
  setup() {},
};
