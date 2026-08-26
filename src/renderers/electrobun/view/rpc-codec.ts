const DATE_MARKER = "__gloomDate";
const MAP_MARKER = "__gloomMap";

export function encodeRpcValue(value: unknown): unknown {
  if (value == null) return value;
  const valueType = typeof value;
  if (valueType !== "object") return value;
  return encodeRpcKnownObject(value as object);
}

function encodeRpcKnownObject(value: object): unknown {
  if (value instanceof Date) {
    return { [DATE_MARKER]: value.toISOString() };
  }
  if (value instanceof Map) {
    const size = value.size;
    const encoded = new Array<[unknown, unknown]>(size);
    let index = 0;
    for (const [key, entry] of value) {
      encoded[index++] = [key, encodeRpcValue(entry)];
    }
    return { [MAP_MARKER]: encoded };
  }
  if (Array.isArray(value)) {
    return encodeRpcArray(value);
  }
  return encodeRpcRecord(value as Record<string, unknown>);
}

function encodeRpcArray(value: unknown[]): unknown {
  const length = value.length;
  let copy: unknown[] | undefined;
  for (let i = 0; i < length; i++) {
    const entry = value[i];
    if (entry == null || typeof entry !== "object") continue;
    const encoded = encodeRpcKnownObject(entry as object);
    if (encoded === entry) continue;
    if (copy === undefined) copy = value.slice();
    copy[i] = encoded;
  }
  return copy ?? value;
}

function encodeRpcRecord(value: Record<string, unknown>): unknown {
  const keys = Object.keys(value);
  const keyCount = keys.length;
  let copy: Record<string, unknown> | undefined;
  for (let i = 0; i < keyCount; i++) {
    const key = keys[i]!;
    const entry = value[key];
    if (entry == null || typeof entry !== "object") continue;
    const encoded = encodeRpcKnownObject(entry as object);
    if (encoded === entry) continue;
    if (copy === undefined) copy = { ...value };
    copy[key] = encoded;
  }
  return copy ?? value;
}

export function decodeRpcValue<T = unknown>(value: unknown): T {
  if (value == null) return value as T;
  const valueType = typeof value;
  if (valueType !== "object") return value as T;
  if (Array.isArray(value)) {
    return value.map((entry) => decodeRpcValue(entry)) as T;
  }
  const record = value as Record<string, unknown>;
  const dateValue = record[DATE_MARKER];
  if (typeof dateValue === "string") {
    return new Date(dateValue) as T;
  }
  const mapValue = record[MAP_MARKER];
  if (Array.isArray(mapValue)) {
    return new Map(mapValue.map((entry) => {
      const pair = entry as [unknown, unknown];
      return [pair[0], decodeRpcValue(pair[1])];
    })) as T;
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [key, decodeRpcValue(entry)]),
  ) as T;
}
