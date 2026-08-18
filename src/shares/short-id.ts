/**
 * Compact share IDs for `/s/{id}` URLs.
 *
 * 12 base62 characters is ~71 bits of entropy — short enough to paste, long
 * enough that collisions are a non-issue with a couple of retries. Alphabet is
 * URL-safe without percent-encoding.
 */

export const SHARE_ID_LENGTH = 12;

const SHARE_ID_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export const SHARE_ID_PATTERN = new RegExp(
  `^[A-Za-z0-9_-]{${8},${64}}$`,
);

export function generateShareId(
  randomBytes: (size: number) => Uint8Array = (size) => crypto.getRandomValues(new Uint8Array(size)),
): string {
  const bytes = randomBytes(SHARE_ID_LENGTH);
  let id = "";
  for (let i = 0; i < SHARE_ID_LENGTH; i += 1) {
    id += SHARE_ID_ALPHABET[bytes[i]! % SHARE_ID_ALPHABET.length]!;
  }
  return id;
}

export function isShareId(value: string): boolean {
  return SHARE_ID_PATTERN.test(value);
}
