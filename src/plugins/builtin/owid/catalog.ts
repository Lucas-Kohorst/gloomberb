import { OWID_ORIGIN } from "../../../sources/owid/types";

/**
 * Searchable snapshot of redistributable OWID grapher series for CAT / G.
 * Live search still fills in charts that are not listed here.
 */
export interface OwidCatalogEntry {
  slug: string;
  title: string;
  topics: readonly string[];
  defaultEntity: string;
  defaultEntityName: string;
  unit?: string;
}

export const OWID_WORLD_ENTITY = "OWID_WRL";

export const OWID_CATALOG: readonly OwidCatalogEntry[] = [
  {
    slug: "life-expectancy",
    title: "Life expectancy",
    topics: ["health", "longevity", "mortality", "demography"],
    defaultEntity: OWID_WORLD_ENTITY,
    defaultEntityName: "World",
    unit: "years",
  },
  {
    slug: "child-mortality-rate",
    title: "Child mortality",
    topics: ["health", "infant", "under-five", "kids"],
    defaultEntity: OWID_WORLD_ENTITY,
    defaultEntityName: "World",
    unit: "%",
  },
  {
    slug: "fertility-rate-complete-gapminder",
    title: "Fertility rate",
    topics: ["demography", "births", "children per woman", "tfr"],
    defaultEntity: OWID_WORLD_ENTITY,
    defaultEntityName: "World",
  },
  {
    slug: "population",
    title: "Population",
    topics: ["demography", "people", "inhabitants"],
    defaultEntity: OWID_WORLD_ENTITY,
    defaultEntityName: "World",
  },
  {
    slug: "gdp-per-capita-worldbank",
    title: "GDP per capita",
    topics: ["economy", "income", "gdp", "wealth", "world bank"],
    defaultEntity: OWID_WORLD_ENTITY,
    defaultEntityName: "World",
  },
  {
    slug: "share-of-population-in-extreme-poverty",
    title: "Extreme poverty",
    topics: ["poverty", "economy", "income", "development"],
    defaultEntity: OWID_WORLD_ENTITY,
    defaultEntityName: "World",
    unit: "%",
  },
  {
    slug: "human-development-index",
    title: "Human Development Index",
    topics: ["hdi", "development", "undp"],
    defaultEntity: OWID_WORLD_ENTITY,
    defaultEntityName: "World",
  },
  {
    slug: "mean-years-of-schooling",
    title: "Mean years of schooling",
    topics: ["education", "school", "literacy"],
    defaultEntity: OWID_WORLD_ENTITY,
    defaultEntityName: "World",
    unit: "years",
  },
  {
    slug: "literacy-rate",
    title: "Literacy rate",
    topics: ["education", "reading", "school"],
    defaultEntity: OWID_WORLD_ENTITY,
    defaultEntityName: "World",
    unit: "%",
  },
  {
    slug: "annual-co2-emissions-per-country",
    title: "Annual CO₂ emissions",
    topics: ["climate", "carbon", "co2", "emissions", "greenhouse"],
    defaultEntity: OWID_WORLD_ENTITY,
    defaultEntityName: "World",
  },
  {
    slug: "co-emissions-per-capita",
    title: "CO₂ emissions per capita",
    topics: ["climate", "carbon", "co2", "emissions"],
    defaultEntity: OWID_WORLD_ENTITY,
    defaultEntityName: "World",
  },
  {
    slug: "temperature-anomaly",
    title: "Temperature anomaly",
    topics: ["climate", "warming", "global temperature", "heat"],
    defaultEntity: OWID_WORLD_ENTITY,
    defaultEntityName: "World",
    unit: "°C",
  },
  {
    slug: "primary-energy-consumption",
    title: "Primary energy consumption",
    topics: ["energy", "power", "fuel"],
    defaultEntity: OWID_WORLD_ENTITY,
    defaultEntityName: "World",
  },
  {
    slug: "share-electricity-renewables",
    title: "Share of electricity from renewables",
    topics: ["energy", "renewable", "solar", "wind", "electricity"],
    defaultEntity: OWID_WORLD_ENTITY,
    defaultEntityName: "World",
    unit: "%",
  },
  {
    slug: "electricity-generation",
    title: "Electricity generation",
    topics: ["energy", "power", "electricity"],
    defaultEntity: OWID_WORLD_ENTITY,
    defaultEntityName: "World",
  },
  {
    slug: "coal-production",
    title: "Coal production",
    topics: ["energy", "coal", "fossil"],
    defaultEntity: OWID_WORLD_ENTITY,
    defaultEntityName: "World",
  },
  {
    slug: "oil-production",
    title: "Oil production",
    topics: ["energy", "oil", "petroleum", "fossil"],
    defaultEntity: OWID_WORLD_ENTITY,
    defaultEntityName: "World",
  },
  {
    slug: "forest-area-as-share-of-land-area",
    title: "Forest area",
    topics: ["environment", "deforestation", "land", "trees"],
    defaultEntity: OWID_WORLD_ENTITY,
    defaultEntityName: "World",
    unit: "%",
  },
  {
    slug: "meat-supply-per-person",
    title: "Meat supply per person",
    topics: ["food", "diet", "agriculture", "protein"],
    defaultEntity: OWID_WORLD_ENTITY,
    defaultEntityName: "World",
  },
  {
    slug: "democracy-index-eiu",
    title: "Democracy index",
    topics: ["politics", "democracy", "eiu", "freedom"],
    defaultEntity: OWID_WORLD_ENTITY,
    defaultEntityName: "World",
  },
  {
    slug: "working-hours-per-week",
    title: "Working hours",
    topics: ["labor", "work", "hours", "jobs"],
    defaultEntity: OWID_WORLD_ENTITY,
    defaultEntityName: "World",
  },
  {
    slug: "share-of-adults-who-are-overweight",
    title: "Share of adults who are overweight",
    topics: ["health", "obesity", "bmi", "nutrition"],
    defaultEntity: OWID_WORLD_ENTITY,
    defaultEntityName: "World",
    unit: "%",
  },
];

const ENTITY_NAMES: Readonly<Record<string, string>> = Object.freeze({
  OWID_WRL: "World",
  USA: "United States",
  GBR: "United Kingdom",
  CHN: "China",
  IND: "India",
  DEU: "Germany",
  JPN: "Japan",
  FRA: "France",
  BRA: "Brazil",
});

export function owidGrapherUrl(slug: string): string {
  return `${OWID_ORIGIN}/grapher/${slug}`;
}

export function owidEntityDisplayName(code: string, fallback?: string): string {
  return ENTITY_NAMES[code] ?? fallback ?? code;
}

export function owidSeriesLabel(title: string, entityCode: string, entityName?: string): string {
  return `${title} · ${owidEntityDisplayName(entityCode, entityName)}`;
}

export function findOwidCatalogEntryBySlug(slug: string): OwidCatalogEntry | undefined {
  const key = slug.trim().toLowerCase();
  return OWID_CATALOG.find((entry) => entry.slug === key);
}

export function owidCatalogSearchText(entry: OwidCatalogEntry): string {
  return [
    entry.title,
    entry.slug,
    entry.slug.replaceAll("-", " "),
    ...entry.topics,
    entry.defaultEntity,
    entry.defaultEntityName,
    entry.unit,
    "owid",
    "our world in data",
  ].filter(Boolean).join(" ").toLowerCase();
}

export function matchesOwidCatalogQuery(entry: OwidCatalogEntry, query: string): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = owidCatalogSearchText(entry);
  const slugHay = entry.slug.replaceAll("-", " ");
  return tokens.every((token) => (
    hay.includes(token)
    || entry.slug.includes(token)
    || slugHay.includes(token)
  ));
}

export function matchOwidCatalogEntries(query: string): readonly OwidCatalogEntry[] {
  const trimmed = query.trim();
  if (!trimmed || /^(owid|our world in data)$/i.test(trimmed)) return OWID_CATALOG;
  return OWID_CATALOG.filter((entry) => matchesOwidCatalogQuery(entry, trimmed));
}

export function owidCatalogExpression(entry: OwidCatalogEntry, entity = entry.defaultEntity): string {
  return `OWID:${entry.slug}:${entity}`;
}
