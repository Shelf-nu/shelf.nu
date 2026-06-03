/**
 * SSRF-safe outbound HTTP fetch.
 *
 * Shelf lets authenticated users supply URLs that the *server* then fetches on
 * their behalf — most notably the `imageUrl` column of the Asset CSV import.
 * Without restrictions this is a classic Server-Side Request Forgery (SSRF)
 * primitive: a user can point the URL at internal-only addresses the server can
 * reach but they cannot (cloud metadata endpoints like 169.254.169.254,
 * databases on localhost, internal admin panels, RFC1918 hosts), turning the
 * server into a confused deputy. See GHSA-xgrm-8w6v-mvjg.
 *
 * String-level checks ("does the URL end in .jpg?") are NOT a defense — the
 * attacker controls the string, redirects change the destination after any such
 * check, and substring host matching is trivially bypassed. The only reliable
 * boundary is at the network layer: resolve the destination and refuse to
 * connect to any private/reserved IP.
 *
 * This module enforces that boundary via an undici {@link Agent} whose custom
 * `connect.lookup` validates every resolved address *at connect time*. Because
 * undici connects to exactly the IP the lookup returns, the address we validate
 * is the address we talk to — closing the DNS-rebinding (TOCTOU) gap — and every
 * redirect hop opens a fresh connection through the same lookup, so redirects
 * are revalidated automatically.
 *
 * @see {@link file://./storage.server.ts} — `uploadImageFromUrl` consumer
 * @see {@link file://./ssrf.server.test.ts} — range + bypass coverage
 */

import { lookup as dnsLookup } from "node:dns";
import type { LookupAddress, LookupOptions } from "node:dns";

import ipaddr from "ipaddr.js";
import { Agent } from "undici";

import { ASSET_MAX_IMAGE_UPLOAD_SIZE } from "./constants";
import type { ErrorLabel } from "./error";
import { ShelfError } from "./error";

const label: ErrorLabel = "File storage";

/** Default per-request timeout for outbound image fetches. */
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Determines whether an IP address (v4 or v6) is private, loopback,
 * link-local, or otherwise reserved and therefore must not be the target of a
 * server-initiated request.
 *
 * Classification is delegated to the battle-tested `ipaddr.js` library and
 * applied as a strict **default-deny** policy: only globally-routable
 * `unicast` addresses are permitted; every other range it recognises
 * (`loopback`, `private`, `linkLocal` — incl. the 169.254.169.254 cloud
 * metadata endpoint —, `carrierGradeNat`, `uniqueLocal`, `multicast`,
 * `reserved`, `unspecified`, `broadcast`, and the 6to4 / Teredo / NAT64
 * transition ranges) is blocked. `ipaddr.process` first unwraps IPv4-mapped
 * IPv6 (`::ffff:x`) to its embedded IPv4, so a private v4 cannot be smuggled
 * through a v6 literal. Unparseable input fails closed (blocked).
 *
 * @param ip - The IP address to classify
 * @returns `true` if the address is non-publicly-routable and must be blocked
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.process(ip);
  } catch {
    // Not a parseable IP literal — fail closed.
    return true;
  }
  return addr.range() !== "unicast";
}

/**
 * Thrown when an outbound fetch is refused because the destination resolves to
 * a blocked address. Distinct so callers can avoid pointlessly retrying.
 */
export class BlockedAddressError extends ShelfError {
  constructor(host: string, ip?: string) {
    super({
      cause: null,
      message: "Refused to fetch from a private or reserved network address",
      additionalData: { host, ip },
      label,
      shouldBeCaptured: false,
    });
  }
}

/** Callback shape accepted by a `dns.lookup`-style function. */
type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number
) => void;

/**
 * A `dns.lookup`-compatible function that resolves a hostname and rejects the
 * lookup (and therefore the connection) if *any* resolved address is private or
 * reserved. Used as undici's `connect.lookup` so the IP we validate is exactly
 * the IP undici connects to — on every redirect hop.
 *
 * We reject if ANY resolved address is blocked (not just the one chosen) to
 * defend against hostnames that publish both a public and a private record.
 *
 * @param hostname - The host undici is about to connect to
 * @param options - Lookup options forwarded by undici (family/hints/`all`)
 * @param callback - Node-style lookup callback
 */
export function ssrfGuardedLookup(
  hostname: string,
  options: LookupOptions,
  callback: LookupCallback
): void {
  // Always resolve ALL records so we can reject a host that publishes both a
  // public and a private address, then hand back the shape the caller wants.
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);

    const all = addresses as LookupAddress[];
    const blocked = all.find((a) => isPrivateOrReservedIp(a.address));
    if (blocked) {
      return callback(
        new BlockedAddressError(hostname, blocked.address),
        "",
        0
      );
    }

    if (options.all) return callback(null, all);
    return callback(null, all[0].address, all[0].family);
  });
}

/**
 * Shared undici dispatcher that routes every connection (including redirect
 * hops) through {@link ssrfGuardedLookup}. Reusing a single agent is safe:
 * pooled sockets are keyed to an already-validated IP, and new hostnames always
 * trigger a fresh guarded lookup.
 */
const ssrfSafeAgent = new Agent({
  // `lookup` is supported by undici's connector at runtime but missing from its
  // `BuildOptions` type, so cast through `unknown`.
  connect: { lookup: ssrfGuardedLookup } as unknown as Agent.Options["connect"],
});

/** Options for {@link safeFetch}. */
export interface SafeFetchOptions {
  /** Maximum number of bytes to read before aborting (DoS guard). */
  maxBytes?: number;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
}

/** Successful result of {@link safeFetch}. */
export interface SafeFetchResult {
  /** The fully-read response body, guaranteed to be `<= maxBytes`. */
  buffer: Buffer;
  /** The response `content-type` header, or empty string if absent. */
  contentType: string;
}

/**
 * Fetches a user-supplied URL with SSRF protection and a streaming size cap.
 *
 * - Only `http:`/`https:` are permitted.
 * - Every connection (initial + redirects) is validated against private and
 *   reserved IP ranges via {@link ssrfGuardedLookup}, closing redirect and
 *   DNS-rebinding bypasses.
 * - The body is read incrementally and the request is aborted the instant it
 *   exceeds `maxBytes`, so an oversized response cannot exhaust memory.
 *
 * @param url - The destination URL (typically from untrusted user input)
 * @param options - Size cap and timeout overrides
 * @returns The response body buffer and its content-type
 * @throws {ShelfError} If the protocol is disallowed, the destination is
 *   blocked, the request fails/times out, or the body exceeds `maxBytes`
 */
export async function safeFetch(
  url: string,
  options: SafeFetchOptions = {}
): Promise<SafeFetchResult> {
  const maxBytes = options.maxBytes ?? ASSET_MAX_IMAGE_UPLOAD_SIZE;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ShelfError({
      cause: null,
      message: "Invalid URL",
      additionalData: { url },
      label,
      shouldBeCaptured: false,
    });
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new ShelfError({
      cause: null,
      message: "Only http and https URLs are allowed",
      additionalData: { url, protocol: parsed.protocol },
      label,
      shouldBeCaptured: false,
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(parsed, {
      signal: controller.signal,
      redirect: "follow",
      // Route through the SSRF-guarded dispatcher. `dispatcher` is the undici
      // RequestInit extension exposed by Node's global fetch.
      // @ts-expect-error -- `dispatcher` is not in the DOM RequestInit types.
      dispatcher: ssrfSafeAgent,
    });
  } catch (cause) {
    // When the guarded lookup rejects a hop, fetch surfaces a wrapped error
    // (e.g. `TypeError: fetch failed` with `.cause`). Recover the original
    // BlockedAddressError so callers can distinguish "blocked" from "network
    // failure" and avoid pointless retries.
    const blocked = findBlockedCause(cause);
    if (blocked) throw blocked;
    throw cause;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new ShelfError({
      cause: null,
      message: `HTTP ${response.status}: ${response.statusText}`,
      additionalData: { url, status: response.status },
      label,
      shouldBeCaptured: false,
    });
  }

  const contentType = response.headers.get("content-type") || "";
  const buffer = await readBodyWithLimit(response, maxBytes, url);

  return { buffer, contentType };
}

/**
 * Walks an error's `cause` chain looking for a {@link BlockedAddressError},
 * which fetch wraps when our guarded lookup refuses a connection.
 *
 * @param err - The error thrown by `fetch`
 * @returns The underlying BlockedAddressError, or `null` if not present
 */
function findBlockedCause(err: unknown): BlockedAddressError | null {
  let current: unknown = err;
  // Bound the walk to avoid pathological self-referential cause chains.
  for (let depth = 0; current && depth < 10; depth++) {
    if (current instanceof BlockedAddressError) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * Reads a response body incrementally, aborting as soon as the cumulative size
 * exceeds `maxBytes`. Prevents the buffer-everything-then-check memory vector.
 *
 * @param response - The fetch response whose body to read
 * @param maxBytes - The maximum allowed body size in bytes
 * @param url - The source URL (for error context only)
 * @returns The full body as a Buffer (guaranteed `<= maxBytes`)
 * @throws {ShelfError} If the body exceeds `maxBytes` or cannot be read
 */
export async function readBodyWithLimit(
  response: Response,
  maxBytes: number,
  url: string
): Promise<Buffer> {
  if (!response.body) {
    throw new ShelfError({
      cause: null,
      message: "Response has no body",
      additionalData: { url },
      label,
      shouldBeCaptured: false,
    });
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ShelfError({
          cause: null,
          message: `Response exceeds maximum allowed size of ${
            maxBytes / (1024 * 1024)
          }MB`,
          additionalData: { url, maxBytes },
          label,
          shouldBeCaptured: false,
        });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks);
}
