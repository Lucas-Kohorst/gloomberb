import {
  OWID_LICENSE,
  OWID_ORIGIN,
  OWID_RESERVED_PATHS,
  type OwidChartMetadataPrint,
  type OwidChartPrint,
  type OwidChartSearchHit,
  type OwidChartSearchPrint,
  type OwidEntity,
  type OwidObservation,
} from "./types";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,199}$/;
const ENTITY_RE = /^[A-Z0-9_]{2,32}$/;

export function normalizeOwidSlug(token: string): string | null {
  const slug = token.trim().toLowerCase();
  if (!SLUG_RE.test(slug)) return null;
  if (OWID_RESERVED_PATHS.has(slug)) return null;
  return slug;
}

export function normalizeOwidEntityCode(token: string): string | null {
  const code = token.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "");
  if (!ENTITY_RE.test(code)) return null;
  return code;
}

export function parseOwidShortcutArg(arg: string): {
  query: string;
  slug: string | null;
  entity: string | null;
} {
  const query = arg.trim();
  if (!query) return { query: "", slug: null, entity: null };
  const parts = query.split(/\s+/);
  const slug = normalizeOwidSlug(parts[0] ?? "");
  // Grapher slugs are hyphenated; require that so "life expectancy" stays a search.
  if (!slug || !slug.includes("-")) return { query, slug: null, entity: null };
  if (parts.length === 1) return { query, slug, entity: null };
  const rawEntity = parts[parts.length - 1] ?? "";
  if (!/^(?:[A-Za-z]{2,3}|OWID_[A-Za-z0-9_]+)$/.test(rawEntity)) {
    return { query, slug, entity: null };
  }
  const entity = normalizeOwidEntityCode(rawEntity);
  return { query, slug, entity };
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\n") {
      row.push(field);
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      field = "";
      continue;
    }
    if (char === "\r") continue;
    field += char;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.length > 0)) rows.push(row);
  }
  return rows;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: string): number | null {
  if (!value.trim() || value === "NA" || value === "NaN") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseOwidSearchPrint(body: unknown, query: string, page: number, hitsPerPage: number): OwidChartSearchPrint {
  const record = asRecord(body);
  const rawResults = Array.isArray(record?.results) ? record.results : [];
  const results: OwidChartSearchHit[] = [];
  for (const item of rawResults) {
    const row = asRecord(item);
    const slug = normalizeOwidSlug(str(row?.slug) ?? "");
    const title = str(row?.title);
    if (!slug || !title) continue;
    const entities = Array.isArray(row?.availableEntities)
      ? row.availableEntities.filter((name): name is string => typeof name === "string" && name.trim().length > 0)
      : [];
    results.push({
      title,
      slug,
      subtitle: str(row?.subtitle) ?? str(row?.variantName),
      url: str(row?.url) ?? `${OWID_ORIGIN}/grapher/${slug}`,
      availableEntities: entities,
    });
  }
  const nbHits = typeof record?.nbHits === "number" && Number.isFinite(record.nbHits)
    ? record.nbHits
    : results.length;
  return {
    query,
    page,
    hitsPerPage,
    nbHits,
    license: OWID_LICENSE,
    results,
  };
}

function metadataTitle(meta: Record<string, unknown> | null): {
  title: string | null;
  subtitle: string | null;
  citation: string | null;
  unit: string | null;
  columnTitle: string | null;
} {
  const chart = asRecord(meta?.chart);
  const columns = asRecord(meta?.columns);
  const firstColumn = columns ? Object.values(columns).find((value) => asRecord(value)) : null;
  const column = asRecord(firstColumn);
  return {
    title: str(chart?.title),
    subtitle: str(chart?.subtitle),
    citation: str(chart?.citation),
    unit: str(column?.unit) ?? str(column?.shortUnit),
    columnTitle: str(column?.titleShort) ?? str(column?.title) ?? str(Object.keys(columns ?? {})[0] ?? ""),
  };
}

function entityCodeFor(name: string, code: string): string | null {
  const fromCode = normalizeOwidEntityCode(code);
  if (fromCode) return fromCode;
  const fromName = normalizeOwidEntityCode(name.replace(/\s+/g, "_"));
  return fromName;
}

export function parseOwidCsvPrint(
  csvText: string,
  metadata: unknown,
  slug: string,
  entityFilter: string | null,
): OwidChartPrint {
  const rows = parseCsv(csvText);
  const header = (rows[0] ?? []).map((cell) => cell.trim());
  const entityIdx = header.findIndex((cell) => cell.toLowerCase() === "entity");
  const codeIdx = header.findIndex((cell) => cell.toLowerCase() === "code");
  const yearIdx = header.findIndex((cell) => cell.toLowerCase() === "year");
  const dayIdx = header.findIndex((cell) => cell.toLowerCase() === "day");
  const timeIdx = yearIdx >= 0 ? yearIdx : dayIdx;
  const timeKind: "year" | "day" = yearIdx >= 0 ? "year" : "day";
  const valueIdx = header.findIndex((cell, index) => (
    index !== entityIdx && index !== codeIdx && index !== yearIdx && index !== dayIdx
  ));
  const meta = metadataTitle(asRecord(metadata));
  const wanted = entityFilter ? normalizeOwidEntityCode(entityFilter) : null;
  const entitiesByCode = new Map<string, OwidEntity>();
  const observations: OwidObservation[] = [];

  if (entityIdx < 0 || timeIdx < 0 || valueIdx < 0) {
    return {
      slug,
      title: meta.title ?? slug,
      subtitle: meta.subtitle,
      citation: meta.citation,
      unit: meta.unit,
      columnTitle: meta.columnTitle ?? header[valueIdx] ?? null,
      timeKind,
      license: OWID_LICENSE,
      url: `${OWID_ORIGIN}/grapher/${slug}`,
      entity: null,
      entities: [],
      observations: [],
    };
  }

  for (const row of rows.slice(1)) {
    const name = (row[entityIdx] ?? "").trim();
    const rawCode = (row[codeIdx] ?? "").trim();
    const code = entityCodeFor(name, rawCode);
    if (!name || !code) continue;
    if (wanted && code !== wanted) continue;
    if (!entitiesByCode.has(code)) entitiesByCode.set(code, { code, name });
    observations.push({
      entity: name,
      code,
      time: (row[timeIdx] ?? "").trim(),
      value: num(row[valueIdx] ?? ""),
    });
  }

  const entities = [...entitiesByCode.values()].sort((left, right) => left.name.localeCompare(right.name));
  const entity = wanted ? entitiesByCode.get(wanted) ?? null : null;
  return {
    slug,
    title: meta.title ?? slug,
    subtitle: meta.subtitle,
    citation: meta.citation,
    unit: meta.unit,
    columnTitle: meta.columnTitle ?? header[valueIdx] ?? null,
    timeKind,
    license: OWID_LICENSE,
    url: `${OWID_ORIGIN}/grapher/${slug}`,
    entity,
    entities,
    observations,
  };
}

export function seriesJoinKey(slug: string, entityCode: string): string {
  return `${slug}:${entityCode}`;
}

function addEntity(into: Map<string, OwidEntity>, code: string, name: string): void {
  const normalized = normalizeOwidEntityCode(code);
  if (!normalized) return;
  const label = name.trim() || normalized;
  if (!into.has(normalized)) into.set(normalized, { code: normalized, name: label });
}

function extractMetadataEntities(meta: Record<string, unknown> | null): OwidEntity[] {
  const into = new Map<string, OwidEntity>();
  const rootEntities = meta?.entities;
  if (Array.isArray(rootEntities)) {
    for (const item of rootEntities) {
      const row = asRecord(item);
      if (!row) continue;
      addEntity(into, str(row.code) ?? str(row.id) ?? "", str(row.name) ?? "");
    }
  }
  const dimensions = asRecord(meta?.dimensions);
  const dimensionEntities = asRecord(dimensions?.entities);
  const dimensionValues = dimensionEntities?.values;
  if (Array.isArray(dimensionValues)) {
    for (const item of dimensionValues) {
      const row = asRecord(item);
      if (!row) continue;
      addEntity(into, str(row.code) ?? str(row.id) ?? "", str(row.name) ?? "");
    }
  }
  const columns = asRecord(meta?.columns);
  if (columns) {
    for (const columnValue of Object.values(columns)) {
      const column = asRecord(columnValue);
      const entities = asRecord(column?.entities);
      if (!entities) continue;
      for (const [code, value] of Object.entries(entities)) {
        const row = asRecord(value);
        addEntity(into, code, str(row?.name) ?? code);
      }
    }
  }
  return [...into.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function parseOwidMetadataPrint(body: unknown, slug: string): OwidChartMetadataPrint {
  const meta = asRecord(body);
  const titles = metadataTitle(meta);
  return {
    slug,
    title: titles.title ?? slug,
    subtitle: titles.subtitle,
    citation: titles.citation,
    unit: titles.unit,
    license: OWID_LICENSE,
    url: `${OWID_ORIGIN}/grapher/${slug}`,
    entities: extractMetadataEntities(meta),
  };
}

/** Prefer World, then the first metadata code, then a code-shaped search entity. */
export function pickDefaultOwidEntityCode(
  availableEntities: readonly string[] = [],
  metadataEntities: readonly OwidEntity[] = [],
): string | null {
  const world = metadataEntities.find((entity) => (
    entity.code === "OWID_WRL" || entity.name.trim().toLowerCase() === "world"
  ));
  if (world) return world.code;
  if (availableEntities.some((name) => name.trim().toLowerCase() === "world")) return "OWID_WRL";
  if (metadataEntities[0]) return metadataEntities[0].code;
  for (const name of availableEntities) {
    const code = normalizeOwidEntityCode(name);
    if (code && name.trim().toUpperCase() === code) return code;
  }
  return null;
}
