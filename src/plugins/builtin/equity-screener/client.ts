import { apiClient } from "../../../api-client";
import type {
  ScreenDefinition,
  ScreenExportResponse,
  ScreenFieldsResponse,
  ScreenPayload,
  ScreenQuery,
  SavedScreen,
} from "../../../api-client/equity-screener";
import { withConnectionRequest } from "../connections/register";
import { parseScreenDefinition, screenDefinitionKey, validateScreenPayload } from "./model";

/** Connections inventory row for the stored equity-screener snapshot. */
export const EQUITY_SCREENER_CONNECTION_ID = "gloom-cloud-equity-screener";
export const EQUITY_SCREENER_PLUGIN_ID = "equity-screener";

export interface EquityScreenerClient {
  equityScreener<T>(path: string, init?: RequestInit): Promise<T>;
}

type CloudClient = {
  request<T>(path: string, init?: RequestInit): Promise<T>;
};

/**
 * The shared client on this fork has no equity-screener method. The instance
 * request still carries the session cookie; traffic is reported on this row.
 */
function cloudEquityScreener<T>(path: string, init?: RequestInit): Promise<T> {
  const operation = path.split("?")[0] || path;
  return withConnectionRequest(EQUITY_SCREENER_CONNECTION_ID, operation, () => {
    const client = apiClient as unknown as CloudClient;
    return client.request<T>(`/cloud/equity-screener/${path}`, init);
  });
}

const defaultClient: EquityScreenerClient = { equityScreener: cloudEquityScreener };

export function screenerClientFrom(api: object | null | undefined): EquityScreenerClient {
  if (
    api
    && "equityScreener" in api
    && typeof (api as EquityScreenerClient).equityScreener === "function"
  ) {
    return api as EquityScreenerClient;
  }
  return defaultClient;
}

const json = (method: string, body: unknown, init: RequestInit = {}): RequestInit => ({
  ...init,
  method,
  body: JSON.stringify(body),
});
const savedPath = (id: string) => `saved/${encodeURIComponent(id)}`;

export const screenerApi = {
  query: (query: ScreenQuery, signal?: AbortSignal, client: EquityScreenerClient = defaultClient) =>
    client.equityScreener<ScreenPayload>("query", json("POST", query, { signal })),
  fields: (signal?: AbortSignal) => defaultClient.equityScreener<ScreenFieldsResponse>("fields?include=social,research", { signal }),
  export: (definition: ScreenDefinition, snapshotId: string) =>
    defaultClient.equityScreener<ScreenExportResponse>("export", json("POST", { ...definition, snapshotId }, { headers: { Accept: "application/json" } })),
  saved: async () => (await defaultClient.equityScreener<{ screens: SavedScreen[] }>("saved")).screens,
  create: async (name: string, definition: ScreenDefinition) =>
    (await defaultClient.equityScreener<{ screen: SavedScreen }>("saved", json("POST", { name, definition }))).screen,
  update: async (id: string, revision: number, name: string, definition: ScreenDefinition) =>
    (await defaultClient.equityScreener<{ screen: SavedScreen }>(savedPath(id), json("PATCH", { revision, name, definition }))).screen,
  remove: (id: string, revision: number) =>
    defaultClient.equityScreener<{ deleted: true }>(savedPath(id), json("DELETE", { revision })),
};

export async function fetchScreen(
  definition: ScreenDefinition,
  cursor: string | null = null,
  signal?: AbortSignal,
  client: EquityScreenerClient = defaultClient,
): Promise<ScreenPayload> {
  const payload = validateScreenPayload(
    await screenerApi.query(
      { ...parseScreenDefinition(definition), limit: 100, cursor },
      signal,
      client,
    ),
  );
  if (screenDefinitionKey(payload.definition) !== screenDefinitionKey(definition))
    throw new Error("Screen response did not match the requested criteria.");
  return payload;
}
export async function fetchScreenFields(
  signal?: AbortSignal,
): Promise<ScreenFieldsResponse> {
  const data = await screenerApi.fields(signal);
  if (
    data.version !== 1 ||
    !Array.isArray(data.fields) ||
    !data.fields.length ||
    !data.limits ||
    data.limits.criteria < 1
  )
    throw new Error("Screen field metadata is unavailable.");
  return data;
}
export function validateSavedScreen(screen: SavedScreen): SavedScreen {
  if (
    !screen ||
    typeof screen.id !== "string" ||
    typeof screen.name !== "string" ||
    !Number.isInteger(screen.revision) ||
    screen.revision < 1
  )
    throw new Error("Invalid saved screen.");
  parseScreenDefinition(screen.definition);
  return screen;
}
export async function fetchSavedScreens() {
  const rows = await screenerApi.saved();
  if (!Array.isArray(rows) || rows.length > 50)
    throw new Error("Invalid saved screen collection.");
  return rows.map(validateSavedScreen);
}
