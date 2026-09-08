/**
 * Generates a unique id for client-side bookkeeping: React keys for rows the
 * user adds to a form, the per-tab id sent to the server, and similar values
 * that only need to be unique within one browser session.
 *
 * `crypto.randomUUID` is the preferred source, but it exists only in current
 * browsers and only in secure contexts (HTTPS or localhost). An older browser,
 * or a self-hosted instance served over plain HTTP, has no such function, so
 * the fallback builds a version 4 UUID from `crypto.getRandomValues`, and from
 * `Math.random` when no `crypto` object exists at all. Every path returns the
 * same canonical UUID shape, so callers can rely on the format.
 *
 * Never call `crypto.randomUUID` directly from client code; go through this
 * helper (enforced by the `no-restricted-properties` lint rule).
 */
export function generateClientId(): string {
  const cryptoObject = globalThis.crypto as Crypto | undefined;
  if (cryptoObject && typeof cryptoObject.randomUUID === "function") {
    return cryptoObject.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (cryptoObject && typeof cryptoObject.getRandomValues === "function") {
    cryptoObject.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // RFC 4122 layout: version nibble 4, variant bits 10xx.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
