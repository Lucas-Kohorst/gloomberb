import type { CommodityContract, CommoditySector } from "./types";

/**
 * Energy, metals, and ag front-month contracts that resolve through the
 * existing Yahoo quote path. Equity, rates, and FX stay on the Futures board.
 */
export const COMMODITY_CONTRACTS: CommodityContract[] = [
  { symbol: "CL=F", code: "CL", name: "WTI Crude Oil", sector: "energy" },
  { symbol: "BZ=F", code: "BZ", name: "Brent Crude Oil", sector: "energy" },
  { symbol: "NG=F", code: "NG", name: "Natural Gas", sector: "energy" },
  { symbol: "HO=F", code: "HO", name: "NY Harbor ULSD", sector: "energy" },
  { symbol: "RB=F", code: "RB", name: "RBOB Gasoline", sector: "energy" },

  { symbol: "GC=F", code: "GC", name: "Gold", sector: "metals" },
  { symbol: "SI=F", code: "SI", name: "Silver", sector: "metals" },
  { symbol: "HG=F", code: "HG", name: "Copper", sector: "metals" },
  { symbol: "PL=F", code: "PL", name: "Platinum", sector: "metals" },
  { symbol: "PA=F", code: "PA", name: "Palladium", sector: "metals" },

  { symbol: "ZC=F", code: "ZC", name: "Corn", sector: "agriculture" },
  { symbol: "ZS=F", code: "ZS", name: "Soybeans", sector: "agriculture" },
  { symbol: "ZW=F", code: "ZW", name: "Chicago SRW Wheat", sector: "agriculture" },
  { symbol: "ZL=F", code: "ZL", name: "Soybean Oil", sector: "agriculture" },
  { symbol: "KC=F", code: "KC", name: "Coffee", sector: "agriculture" },
  { symbol: "SB=F", code: "SB", name: "Sugar #11", sector: "agriculture" },
  { symbol: "CT=F", code: "CT", name: "Cotton", sector: "agriculture" },
  { symbol: "CC=F", code: "CC", name: "Cocoa", sector: "agriculture" },
];

export const COMMODITY_SECTOR_LABELS: Record<CommoditySector, string> = {
  energy: "Energy",
  metals: "Metals",
  agriculture: "Agriculture",
};

export const COMMODITY_SECTOR_ORDER: CommoditySector[] = [
  "energy",
  "metals",
  "agriculture",
];

export const COMMODITY_SYMBOLS = COMMODITY_CONTRACTS.map((contract) => contract.symbol);

export function getContractsBySector(): Map<CommoditySector, CommodityContract[]> {
  const map = new Map<CommoditySector, CommodityContract[]>();
  for (const sector of COMMODITY_SECTOR_ORDER) {
    map.set(sector, COMMODITY_CONTRACTS.filter((contract) => contract.sector === sector));
  }
  return map;
}

export function matchesCommoditySearch(contract: CommodityContract, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return (
    contract.code.toLowerCase().includes(normalized)
    || contract.name.toLowerCase().includes(normalized)
    || contract.symbol.toLowerCase().includes(normalized)
    || contract.sector.toLowerCase().includes(normalized)
  );
}
