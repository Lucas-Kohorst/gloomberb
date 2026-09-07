export const DEFILLAMA_CAPABILITY_ID = "defillama";

export interface DefiLlamaSeriesIdentity {
  kind: "chain" | "protocol";
  slug: string;
  metric: "tvl" | "fees" | "revenue";
}

export function parseDefiLlamaSeriesId(value: string): DefiLlamaSeriesIdentity | null {
  const parts = value.toLowerCase().split("/");
  const [kind, slug, metric] = parts;
  if (parts.length !== 3 || (kind !== "chain" && kind !== "protocol")
    || !slug || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)
    || (metric !== "tvl" && metric !== "fees" && metric !== "revenue")
    || (kind === "chain" && metric !== "tvl")) return null;
  return { kind, slug, metric };
}

export function defillamaSeriesLabel(identity: DefiLlamaSeriesIdentity): string {
  const known = DEFILLAMA_CATALOG.find((entry) => entry.seriesId === `${identity.kind}/${identity.slug}/${identity.metric}`);
  if (known) return known.label;
  const metric = identity.metric === "tvl" ? "TVL" : `daily ${identity.metric}`;
  return `${identity.slug} ${identity.kind} ${metric} (USD)`;
}

export const DEFILLAMA_CATALOG = [
  { kind: "chain", slug: "ethereum", name: "Ethereum" },
  { kind: "chain", slug: "solana", name: "Solana" },
  { kind: "chain", slug: "base", name: "Base" },
  { kind: "chain", slug: "arbitrum", name: "Arbitrum" },
  { kind: "protocol", slug: "aave", name: "Aave" },
  { kind: "protocol", slug: "uniswap", name: "Uniswap" },
  { kind: "protocol", slug: "lido", name: "Lido" },
].flatMap((entry) => (entry.kind === "protocol" ? ["tvl", "fees", "revenue"] : ["tvl"]).map((metric) => ({
  seriesId: `${entry.kind}/${entry.slug}/${metric}`,
  expression: `LLAMA:${entry.kind}:${entry.slug}:${metric}`,
  label: `${entry.name} ${entry.kind} ${metric === "tvl" ? "TVL" : `daily ${metric}`} (USD)`,
  url: `https://defillama.com/${entry.kind}/${entry.slug}`,
})));
