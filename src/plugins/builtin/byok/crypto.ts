/**
 * Encryption-at-rest for BYOK keys in the hosted browser client.
 *
 * The threat model (finding account-credentials-01-015) is that any script on
 * the origin — XSS, a compromised third-party bundle, or a malicious extension
 * — can read `localStorage` and exfiltrate every stored provider key in
 * plaintext.  The fully correct fix is a backend key vault so the client never
 * holds raw keys; that requires a product decision and Worker changes.
 *
 * This module implements the strongest **client-side** mitigation: encrypt
 * every key with AES-GCM before it touches `localStorage`.  The key-wrapping
 * key (KEK) lives only in `sessionStorage`, which is scoped to the tab and
 * cleared when the browser closes — so encrypted blobs persisted in
 * `localStorage` are useless across browser restarts and on other devices.
 *
 * Limitations (inherent to a browser-only approach):
 *  - An attacker with full arbitrary-code execution in the same tab can still
 *    read the KEK from `sessionStorage` and decrypt.  Encryption-at-rest raises
 *    the bar (casual `localStorage` scraping no longer yields keys) and
 *    eliminates cross-session persistence, but only a backend vault fully
 *    closes the XSS gap.
 *  - Keys are lost on browser restart because `sessionStorage` is cleared.  The
 *    user must re-enter them on the next visit.
 */

import type { ByokStoredConfig } from "./types";

const SESSION_KEK_KEY = "gloomberb:byok-kek";
const ENCRYPTED_PREFIX = "enc:v1:";
const KEY_ALG = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12;

// In-memory caches keyed by userId.
const configCache = new Map<string, ByokStoredConfig | null>();
const kekCache = new Map<string, CryptoKey>();

// Generation counter so only the latest async write lands in localStorage.
let writeGeneration = 0;

// Tracks the most recent fire-and-forget encrypted write so callers (and tests)
// can await it if needed.
let pendingWrite: Promise<void> | null = null;

/** Resolves when the most recent encrypted write has settled. */
export async function flushByokWrites(): Promise<void> {
  if (pendingWrite) await pendingWrite.catch(() => {});
  pendingWrite = null;
}

function subtleCrypto(): SubtleCrypto | null {
  return globalThis.crypto?.subtle ?? null;
}

function trySessionStorage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function fromBase64(str: string): Uint8Array {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function isStoredConfig(value: unknown): value is ByokStoredConfig {
  return !!value
    && typeof value === "object"
    && Array.isArray((value as ByokStoredConfig).keys);
}

/**
 * Returns the per-tab AES-GCM key-wrapping key, creating it on first use.
 * The raw key material is stored in `sessionStorage` so it survives reloads
 * within the same tab but is wiped when the browser closes.
 */
async function getOrCreateKek(): Promise<CryptoKey | null> {
  const subtle = subtleCrypto();
  const storage = trySessionStorage();
  if (!subtle || !storage) return null;

  const existing = storage.getItem(SESSION_KEK_KEY);
  if (existing) {
    try {
      const raw = fromBase64(existing);
      return await subtle.importKey("raw", raw as unknown as BufferSource, { name: KEY_ALG, length: KEY_LENGTH }, false, [
        "encrypt",
        "decrypt",
      ]);
    } catch {
      // Corrupt or stale — fall through to regenerate.
    }
  }

  try {
    const key = await subtle.generateKey({ name: KEY_ALG, length: KEY_LENGTH }, true, [
      "encrypt",
      "decrypt",
    ]);
    const raw = await subtle.exportKey("raw", key);
    storage.setItem(SESSION_KEK_KEY, toBase64(new Uint8Array(raw)));
    return key;
  } catch {
    return null;
  }
}

async function encryptConfig(key: CryptoKey, config: ByokStoredConfig): Promise<string> {
  const subtle = subtleCrypto()!;
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const plaintext = new TextEncoder().encode(JSON.stringify(config));
  const ciphertext = await subtle.encrypt({ name: KEY_ALG, iv: iv as unknown as BufferSource }, key, plaintext as unknown as BufferSource);
  return `${ENCRYPTED_PREFIX}${toBase64(iv)}:${toBase64(new Uint8Array(ciphertext))}`;
}

async function decryptConfig(key: CryptoKey, raw: string): Promise<ByokStoredConfig | null> {
  const subtle = subtleCrypto()!;
  const body = raw.slice(ENCRYPTED_PREFIX.length);
  const separator = body.indexOf(":");
  if (separator < 0) return null;
  const iv = fromBase64(body.slice(0, separator));
  const ciphertext = fromBase64(body.slice(separator + 1));
  try {
    const plaintext = await subtle.decrypt({ name: KEY_ALG, iv: iv as unknown as BufferSource }, key, ciphertext as unknown as BufferSource);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintext));
    return isStoredConfig(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Reads the cached (decrypted) config for a user, or `undefined` if not cached. */
export function getCachedByokConfig(userId: string): ByokStoredConfig | null | undefined {
  return configCache.get(userId);
}

/** Updates the in-memory cache. Call this on every write so sync reads stay current. */
export function setCachedByokConfig(userId: string, config: ByokStoredConfig | null): void {
  configCache.set(userId, config);
}

/**
 * Initializes the in-memory cache for a user by decrypting encrypted data from
 * `localStorage`.  If the stored data is still plaintext (pre-migration), it is
 * read, cached, and re-encrypted in the background.
 */
export async function initByokCryptoForUser(
  userId: string,
  storage: Storage,
  storageKey: string,
): Promise<void> {
  const kek = await getOrCreateKek();
  if (!kek) return;
  kekCache.set(userId, kek);

  const raw = storage.getItem(storageKey);
  if (!raw) return;

  if (raw.startsWith(ENCRYPTED_PREFIX)) {
    const decrypted = await decryptConfig(kek, raw);
    if (decrypted) configCache.set(userId, decrypted);
    // If decryption failed (different tab/KEK), cache stays empty — user re-enters keys.
  } else {
    // Plaintext (pre-migration) — read, cache, and encrypt in the background.
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isStoredConfig(parsed)) {
        configCache.set(userId, parsed);
        void encryptConfig(kek, parsed).then((encrypted) => {
          storage.setItem(storageKey, encrypted);
        });
      }
    } catch {
      // Invalid plaintext — ignore.
    }
  }
}

/**
 * Encrypts and persists the config to `localStorage`.  Only the latest call
 * (by generation) writes, so rapid successive writes do not clobber with stale
 * ciphertext.
 */
export async function persistEncryptedByokKeys(
  userId: string,
  config: ByokStoredConfig,
  storage: Storage,
  storageKey: string,
): Promise<void> {
  const gen = ++writeGeneration;
  let kek: CryptoKey | null | undefined = kekCache.get(userId);
  if (!kek) {
    kek = await getOrCreateKek();
    if (!kek) return;
    kekCache.set(userId, kek);
  }
  const encrypted = await encryptConfig(kek, config);
  if (gen !== writeGeneration) return;
  storage.setItem(storageKey, encrypted);
}

/** Wraps {@link persistEncryptedByokKeys} and tracks the pending write for
 *  {@link flushByokWrites}. Called by `writeHostedByokKeys`. */
export function scheduleEncryptedWrite(
  userId: string,
  config: ByokStoredConfig,
  storage: Storage,
  storageKey: string,
): void {
  pendingWrite = persistEncryptedByokKeys(userId, config, storage, storageKey);
}

/** Clears the in-memory cache for a user (does not touch localStorage). */
export function clearByokCryptoCache(userId: string): void {
  configCache.delete(userId);
  kekCache.delete(userId);
}

/** Clears all in-memory caches and resets the write generation counter. */
export function resetByokCryptoCache(): void {
  configCache.clear();
  kekCache.clear();
  writeGeneration = 0;
}

/** Returns `true` if `raw` is an encrypted blob produced by this module. */
export function isEncryptedBlob(raw: string): boolean {
  return raw.startsWith(ENCRYPTED_PREFIX);
}
