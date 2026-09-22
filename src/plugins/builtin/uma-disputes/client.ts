import { httpFetch } from "../../../utils/http-transport";
import { readProcessEnv } from "../../../utils/process-env";
import { withConnectionRequest } from "../connections/register";
import { disputesFromPages, parseUmaRecentPage } from "./parse";
import { canonicalPath, signBravadoRequest, type BravadoCredentials } from "./sign";
import {
  BRAVADO_API_KEY_ENV,
  BRAVADO_API_ORIGIN,
  BRAVADO_API_SECRET_ENV,
  UMA_CONNECTION_ID,
  UMA_RECENT_PATH,
  type UmaQuestion,
  type UmaRecentStage,
} from "./types";

const RECENT_LIMIT = 200;

let resolveStoredKey: () => string | undefined = () => undefined;
let resolveStoredSecret: () => string | undefined = () => undefined;

export function setBravadoCredentialResolvers(resolvers: {
  key?: () => string | undefined;
  secret?: () => string | undefined;
} | null): void {
  resolveStoredKey = resolvers?.key ?? (() => undefined);
  resolveStoredSecret = resolvers?.secret ?? (() => undefined);
}

function firstLine(value: string | undefined): string | undefined {
  const line = value?.split(/[\r\n]+/).map((part) => part.trim()).find(Boolean);
  return line || undefined;
}

function secondLine(value: string | undefined): string | undefined {
  const lines = value?.split(/[\r\n]+/).map((part) => part.trim()).filter(Boolean) ?? [];
  return lines[1];
}

/**
 * Public key from the Bravado UMA BYOK entry or BRAVADO_API_KEY.
 * HMAC secret from the secret entry, a second line on the key, or BRAVADO_API_SECRET.
 * Both stay local.
 */
export function resolveBravadoCredentials(
  storedKey: string | undefined,
  storedSecret?: string,
): BravadoCredentials | null {
  const apiKey = firstLine(storedKey) || readProcessEnv(BRAVADO_API_KEY_ENV);
  const apiSecret = storedSecret?.trim() || secondLine(storedKey) || readProcessEnv(BRAVADO_API_SECRET_ENV);
  if (!apiKey || !apiSecret) return null;
  return { apiKey, apiSecret };
}

export function currentBravadoCredentials(): BravadoCredentials | null {
  return resolveBravadoCredentials(resolveStoredKey(), resolveStoredSecret());
}

export class UmaCredentialsError extends Error {
  constructor() {
    super("Bravado key required.");
    this.name = "UmaCredentialsError";
  }
}

export class UmaRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(umaStatusMessage(status));
    this.name = "UmaRequestError";
    this.status = status;
  }
}

function umaStatusMessage(status: number): string {
  if (status === 401) return "Bravado rejected the signature.";
  if (status === 403) return "This Bravado key cannot read UMA.";
  return `Bravado UMA returned ${status}.`;
}

async function bravadoGet(
  path: string,
  params: Record<string, string | number | undefined>,
  credentials: BravadoCredentials,
  signal?: AbortSignal,
): Promise<unknown> {
  const pathWithQuery = canonicalPath(path, params);
  const headers = await signBravadoRequest({
    credentials,
    method: "GET",
    pathWithQuery,
  });
  const response = await httpFetch(`${BRAVADO_API_ORIGIN}${pathWithQuery}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...headers,
    },
    signal,
  });
  if (!response.ok) throw new UmaRequestError(response.status);
  return response.json() as Promise<unknown>;
}

async function fetchRecent(
  stage: UmaRecentStage | undefined,
  credentials: BravadoCredentials,
  signal?: AbortSignal,
): Promise<UmaQuestion[]> {
  const operation = stage ? `recent-${stage}` : "recent";
  const payload = await withConnectionRequest(UMA_CONNECTION_ID, operation, () => bravadoGet(
    UMA_RECENT_PATH,
    { stage, limit: RECENT_LIMIT },
    credentials,
    signal,
  ));
  return parseUmaRecentPage(payload, stage === "disputed").questions;
}

/**
 * Open disputes from `GET /uma/recent?stage=disputed`, plus recent settlements
 * that still carry a `disputed` object (`GET /uma/recent?stage=settled`).
 */
export async function fetchUmaDisputes(signal?: AbortSignal): Promise<UmaQuestion[]> {
  const credentials = currentBravadoCredentials();
  if (!credentials) throw new UmaCredentialsError();
  const [disputed, settled] = await Promise.all([
    fetchRecent("disputed", credentials, signal),
    fetchRecent("settled", credentials, signal).catch((error: unknown) => {
      if (error instanceof UmaRequestError && (error.status === 401 || error.status === 403)) throw error;
      return [];
    }),
  ]);
  return disputesFromPages([...disputed, ...settled]);
}
