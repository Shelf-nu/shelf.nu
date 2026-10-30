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
import { isIP } from "node:net";

import ipaddr from "ipaddr.js";
import { Agent } from "undici";

import { ASSET_MAX_IMAGE_UPLOAD_SIZE } from "./constants";
import type { ErrorLabel } from "./error";
import { ShelfError } from "./error";

const label: ErrorLabel = "File storage";

/** Default per-request timeout for outbound image fetches. */
const DEFAULT_TIMEOUT_MS = 10_000;

/** Maximum number of redirects to follow before giving up. */
const MAX_REDIRECTS = 5;

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
 * a blocked address (or, for {@link safeFetchPrefix}, uses a non-default
 * port). Distinct so callers can avoid pointlessly retrying.
 */
export class BlockedAddressError extends ShelfError {
  constructor(
    host: string,
    ip?: string,
    message = "Refused to fetch from a private or reserved network address"
  ) {
    super({
      cause: null,
      message,
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
 * Parses a URL, enforces the http(s) allowlist, and blocks IP-literal hosts
 * that fall in a private/reserved range.
 *
 * The literal-IP check here is essential: undici's connector does NOT route a
 * host that is already an IP through `connect.lookup`, so {@link
 * ssrfGuardedLookup} never sees `http://169.254.169.254/...` (or a redirect to
 * it). Named hosts are left to the guarded lookup at connect time, which is
 * rebinding-safe.
 *
 * @param url - The URL to validate (initial request or a redirect target)
 * @returns The parsed, validated URL
 * @throws {ShelfError} If the URL is malformed or uses a disallowed protocol
 * @throws {BlockedAddressError} If the host is a private/reserved IP literal
 */
export function assertSafeUrl(url: string): URL {
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

  // `URL.hostname` wraps IPv6 literals in brackets (`[::1]`); strip them so
  // `isIP` recognises the address.
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isPrivateOrReservedIp(host)) {
    throw new BlockedAddressError(parsed.hostname, host);
  }

  return parsed;
}

/** RFC redirect status codes that carry a `Location` header. */
function isRedirectStatus(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

/** How {@link followGuardedRedirects} sends each request. */
interface GuardedRequestOptions {
  /** Aborts the request, including any redirect hop. */
  signal: AbortSignal;
  /** Sent on every hop. */
  headers?: Readonly<Record<string, string>>;
  /** Refuses any hop whose URL names a port other than the scheme's default. */
  defaultPortOnly?: boolean;
}

/**
 * Validates one hop: {@link assertSafeUrl}, plus the default-port rule when
 * asked for.
 *
 * @throws {ShelfError} If the URL is malformed or uses a disallowed protocol
 * @throws {BlockedAddressError} If the host is a private/reserved IP literal,
 *   or the port is not the default one while `defaultPortOnly` is set
 */
function assertSafeHop(url: string, defaultPortOnly: boolean): URL {
  const target = assertSafeUrl(url);
  // `URL.port` is empty for the scheme's default port, even when written out.
  if (defaultPortOnly && target.port !== "") {
    throw new BlockedAddressError(
      target.host,
      undefined,
      "Refused to fetch from a non-default port"
    );
  }
  return target;
}

/**
 * GETs a URL through the SSRF-guarded dispatcher and follows redirects
 * **manually**, so every hop is re-validated. Each hop's host is checked two
 * ways: IP literals via {@link assertSafeUrl} (undici skips `connect.lookup`
 * for literals), named hosts via {@link ssrfGuardedLookup} at connect time.
 * Together they close the redirect and DNS-rebinding bypasses.
 *
 * @param url - The destination URL (typically from untrusted user input)
 * @param options - Abort signal, headers, and the default-port rule
 * @returns The first non-redirect response, whatever its status, and the URL
 *   it came from. The caller owns the response body.
 * @throws {ShelfError} If a hop is refused, the request fails or times out, a
 *   redirect has no `Location`, or there are more than {@link MAX_REDIRECTS}
 */
async function followGuardedRedirects(
  url: string,
  { signal, headers, defaultPortOnly = false }: GuardedRequestOptions
): Promise<{ response: Response; finalUrl: URL }> {
  let target = assertSafeHop(url, defaultPortOnly);

  for (let redirects = 0; ; redirects++) {
    if (redirects > MAX_REDIRECTS) {
      throw new ShelfError({
        cause: null,
        message: `Too many redirects (> ${MAX_REDIRECTS})`,
        additionalData: { url, finalUrl: target.href },
        label,
        shouldBeCaptured: false,
      });
    }

    let response: Response;
    try {
      response = await fetch(target, {
        signal,
        headers,
        redirect: "manual",
        // Route through the SSRF-guarded dispatcher. `dispatcher` is the
        // undici RequestInit extension exposed by Node's global fetch.
        // @ts-expect-error -- `dispatcher` is not in the DOM RequestInit types.
        dispatcher: ssrfSafeAgent,
      });
    } catch (cause) {
      // When the guarded lookup rejects a named hop, fetch wraps the error
      // (e.g. `TypeError: fetch failed` with `.cause`). Recover the original
      // BlockedAddressError so callers can skip pointless retries.
      const blocked = findBlockedCause(cause);
      if (blocked) throw blocked;
      throw cause;
    }

    if (!isRedirectStatus(response.status)) {
      return { response, finalUrl: target };
    }

    const location = response.headers.get("location");
    // Release the redirect response's socket before the next request.
    await response.body?.cancel().catch(() => {});
    if (!location) {
      throw new ShelfError({
        cause: null,
        message: `Redirect (${response.status}) without a Location header`,
        additionalData: { url, from: target.href },
        label,
        shouldBeCaptured: false,
      });
    }
    // Resolve relative redirects against the current URL, then re-validate.
    target = assertSafeHop(new URL(location, target).href, defaultPortOnly);
  }
}

/**
 * Fetches a user-supplied URL with SSRF protection and a streaming size cap.
 *
 * - Only `http:`/`https:` are permitted.
 * - Every redirect hop is re-validated (see {@link followGuardedRedirects}).
 * - The body is read incrementally while the timeout is still armed, so an
 *   oversized **or** slow/stalled body is aborted rather than buffered.
 *
 * @param url - The destination URL (typically from untrusted user input)
 * @param options - Size cap and timeout overrides
 * @returns The response body buffer and its content-type
 * @throws {ShelfError} If the protocol is disallowed, the destination is
 *   blocked, the request fails/times out, redirects too many times, answers
 *   with a non-2xx status, or the body exceeds `maxBytes`
 */
export async function safeFetch(
  url: string,
  options: SafeFetchOptions = {}
): Promise<SafeFetchResult> {
  const maxBytes = options.maxBytes ?? ASSET_MAX_IMAGE_UPLOAD_SIZE;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const { response } = await followGuardedRedirects(url, {
      signal: controller.signal,
    });

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
    // Read the body while the timeout is still armed, passing the same signal
    // so a stalled/slow (trickle-fed) body is aborted too, not just an
    // oversized one.
    const buffer = await readBodyWithLimit(
      response,
      maxBytes,
      url,
      controller.signal
    );
    return { buffer, contentType };
  } finally {
    clearTimeout(timeout);
  }
}

/** Options for {@link safeFetchPrefix}. */
export interface SafeFetchPrefixOptions {
  /** Read at most this many bytes, then stop without error. */
  maxBytes: number;
  /** Per-request timeout in milliseconds, covering redirects and the read. */
  timeoutMs?: number;
  /** Sent on every hop (User-Agent, Accept, Accept-Language). */
  headers?: Readonly<Record<string, string>>;
  /**
   * ASCII marker, matched case-insensitively; reading stops once it has been
   * received, e.g. `"</head>"`.
   */
  stopAfter?: string;
  /**
   * Decides from the final response's status and headers whether its body is
   * worth reading. When it returns false the body is discarded unread. Reads
   * every body when omitted.
   */
  readBodyIf?: (response: { status: number; headers: Headers }) => boolean;
}

/** Result of {@link safeFetchPrefix}. */
export interface SafeFetchPrefixResult {
  status: number;
  /** The URL the final response came from, after redirects. */
  finalUrl: URL;
  headers: Headers;
  /** The bytes read, at most `maxBytes`. Empty when the body was skipped. */
  body: Buffer;
  /** True when reading stopped before the response body ended. */
  truncated: boolean;
}

/**
 * GETs the start of a page: the same SSRF guard and redirect re-validation as
 * {@link safeFetch}, but any status is returned, only the default port is
 * allowed on every hop, and the body is read up to `stopAfter` or `maxBytes`
 * instead of in full. Reaching either limit ends the read without an error.
 *
 * @param url - The destination URL (typically from untrusted user input)
 * @param options - Size cap, timeout, headers, stop marker and body filter
 * @returns The final status, URL and headers, and the body prefix
 * @throws {BlockedAddressError} If a hop is a private/reserved address or
 *   names a non-default port
 * @throws {ShelfError} If the URL is invalid, the request fails or times out,
 *   or redirects too many times
 */
export async function safeFetchPrefix(
  url: string,
  options: SafeFetchPrefixOptions
): Promise<SafeFetchPrefixResult> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );

  try {
    const { response, finalUrl } = await followGuardedRedirects(url, {
      signal: controller.signal,
      headers: options.headers,
      defaultPortOnly: true,
    });
    const { status, headers } = response;

    if (options.readBodyIf && !options.readBodyIf({ status, headers })) {
      // Not awaited, like the early stop in `readBodyPrefix`.
      void response.body?.cancel().catch(() => {});
      return {
        status,
        finalUrl,
        headers,
        body: Buffer.alloc(0),
        truncated: response.body !== null,
      };
    }

    const read = await readBodyPrefix(
      response,
      options,
      url,
      controller.signal
    );
    return { status, finalUrl, headers, ...read };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Reads a response body until it ends, `stopAfter` has been received, or
 * `maxBytes` is reached, whichever comes first.
 *
 * @param url - The source URL (for error context only)
 * @throws {ShelfError} If the signal fires or the body cannot be read
 */
async function readBodyPrefix(
  response: Response,
  { maxBytes, stopAfter }: SafeFetchPrefixOptions,
  url: string,
  signal: AbortSignal
): Promise<{ body: Buffer; truncated: boolean }> {
  if (!response.body) return { body: Buffer.alloc(0), truncated: false };

  const marker = stopAfter?.toLowerCase();
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = true;
  // The last bytes of the previous chunk, so a marker split across two chunks
  // is still found.
  let seam = Buffer.alloc(0);

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw timedOut(url);
      if (done) {
        truncated = false;
        break;
      }

      const room = maxBytes - total;
      const chunk = Buffer.from(value.subarray(0, room));
      chunks.push(chunk);
      total += chunk.byteLength;
      if (value.byteLength > room) break;

      if (marker) {
        const window = Buffer.concat([seam, chunk]);
        if (window.toString("latin1").toLowerCase().includes(marker)) break;
        seam = window.subarray(Math.max(0, window.length - marker.length + 1));
      }
    }
  } finally {
    // Not awaited: the bytes needed are in hand, and the caller must not wait
    // for the rest of the stream to settle.
    if (truncated) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }

  return { body: Buffer.concat(chunks), truncated };
}

/** The error a body read throws when its request's timeout fires. */
function timedOut(url: string): ShelfError {
  return new ShelfError({
    cause: null,
    message: "Timed out while reading the response body",
    additionalData: { url },
    label,
    shouldBeCaptured: false,
  });
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
 * exceeds `maxBytes` or the `signal` fires. Prevents both the
 * buffer-everything-then-check memory vector and a slow/trickle-fed body that
 * would otherwise hold the connection open under the size cap.
 *
 * @param response - The fetch response whose body to read
 * @param maxBytes - The maximum allowed body size in bytes
 * @param url - The source URL (for error context only)
 * @param signal - Optional abort signal (typically the request timeout); when
 *   it fires mid-read the body read is cancelled and an error is thrown
 * @returns The full body as a Buffer (guaranteed `<= maxBytes`)
 * @throws {ShelfError} If the body exceeds `maxBytes`, the read is aborted, or
 *   the body cannot be read
 */
export async function readBodyWithLimit(
  response: Response,
  maxBytes: number,
  url: string,
  signal?: AbortSignal
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

  /** Cancels the reader and throws a uniform abort error. */
  const abort = async (): Promise<never> => {
    await reader.cancel().catch(() => {});
    throw timedOut(url);
  };

  try {
    for (;;) {
      if (signal?.aborted) return await abort();

      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      // The signal may have fired while awaiting this chunk.
      if (signal?.aborted) return await abort();

      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
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
