import type {
  Credential,
  CredentialInfo,
  CredentialStore,
} from "@earendil-works/pi-ai";

/**
 * Live reader for stored BYOK API keys, keyed by provider/service id.
 * Registered by the AI plugin setup from the current app config; empty when
 * the plugin never ran (CLI, tests) so the overlay purely delegates.
 */
export type ByokApiKeyReader = (providerId: string) => string | undefined;

let byokApiKeyReader: ByokApiKeyReader | null = null;

/** Registers (or clears) the live BYOK key reader. Last registration wins. */
export function setByokApiKeyReader(reader: ByokApiKeyReader | null): void {
  byokApiKeyReader = reader;
}

/**
 * CredentialStore decorator that lets ACM/BYOK-saved API keys authenticate
 * Pi providers which have nothing stored in the Pi credential file.
 *
 * Rules, in order:
 * - A credential already in the inner store always wins — BYOK keys never
 *   shadow OAuth sessions or manually stored keys, and logout/disconnect of
 *   those keeps working exactly as before.
 * - Otherwise a non-empty BYOK key for the provider id resolves as an
 *   `api_key` credential, so Pi reports the provider connected.
 * - Writes (`modify`/`delete`) always go to the inner store. In particular
 *   disconnecting an OAuth session still removes it; a BYOK-backed key
 *   re-applies on the next read by design (the key itself is deleted through
 *   the BYOK settings, never from here).
 */
export class ByokOverlayCredentialStore implements CredentialStore {
  constructor(private readonly inner: CredentialStore) {}

  async read(providerId: string): Promise<Credential | undefined> {
    const stored = await this.inner.read(providerId);
    if (stored) return stored;
    const key = byokApiKeyReader?.(providerId)?.trim();
    if (!key) return undefined;
    return { type: "api_key", key };
  }

  async list(): Promise<readonly CredentialInfo[]> {
    // Nothing Pi-side enumerates the store today; delegate unchanged.
    return this.inner.list();
  }

  async modify(
    providerId: string,
    update: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    return this.inner.modify(providerId, update);
  }

  async delete(providerId: string): Promise<void> {
    await this.inner.delete(providerId);
  }
}
