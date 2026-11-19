/**
 * Client IP
 *
 * Works out the IP address of the person making a request, from headers set by
 * infrastructure we trust. Used as a rate-limit key by our own limiters and
 * forwarded to Supabase Auth (`Sb-Forwarded-For`) so its per-IP sign-in limits
 * count each visitor instead of our servers.
 *
 * Which header is trusted depends on where the app runs:
 *
 * - **On Fly** (`FLY_APP_NAME` set): `Fly-Client-IP` is set by the Fly edge and
 *   cannot be forged. When the domain is proxied through Cloudflare, that
 *   address is a Cloudflare server, and the visitor's address is in
 *   `CF-Connecting-IP`. That header is trusted only when both hold:
 *   `Fly-Client-IP` is inside Cloudflare's published ranges, and the request
 *   carries `X-Shelf-Proxy-Secret` equal to `CLOUDFLARE_PROXY_SECRET`, which a
 *   Transform Rule on Shelf's own Cloudflare zone adds. The range alone proves
 *   only that some Cloudflare account sent the request; anyone can put their own
 *   zone or Worker in front of the Fly app. Without that proof a caller could
 *   pick a fresh rate-limit key on every request.
 * - **Off Fly** (self-hosted behind a reverse proxy, or local dev): only when
 *   the operator sets `TRUSTED_PROXY_HOPS`, the number of proxies in front of
 *   Shelf that append to `X-Forwarded-For`. The visitor's address is then the
 *   entry that many places from the right, the one the operator's outermost
 *   proxy added. Entries further left came from the client and can say
 *   anything. Without the setting there is no trustworthy answer, so the result
 *   is null. The setting is only sound when the app port is reachable solely
 *   through those proxies. `Fly-Client-IP` and `CF-Connecting-IP` are never read here,
 *   because without the Fly edge either one is just a header the client chose.
 *
 * @see {@link file://./../../server/client-ip.ts}
 * @see {@link file://./../integrations/supabase/client.ts}
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { BlockList, isIP } from "node:net";

/** The header Shelf's Cloudflare Transform Rule adds to every proxied request. */
export const PROXY_SECRET_HEADER = "x-shelf-proxy-secret";

/**
 * Cloudflare's published edge ranges (https://www.cloudflare.com/ips/).
 * Cloudflare announces changes to this list well ahead; a range missing here
 * only means visitors behind it are keyed by the Cloudflare address, as if
 * `CF-Connecting-IP` were absent.
 */
const CLOUDFLARE_RANGES = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
] as const;

const cloudflareEdge = new BlockList();
for (const range of CLOUDFLARE_RANGES) {
  const [network, prefix] = range.split("/");
  cloudflareEdge.addSubnet(
    network,
    Number(prefix),
    isIP(network) === 6 ? "ipv6" : "ipv4"
  );
}

/**
 * Returns the address when it is a valid IPv4 or IPv6 address, otherwise null.
 *
 * @param value - A header value, possibly empty or malformed
 */
function asIp(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && isIP(trimmed) ? trimmed : null;
}

/**
 * Whether an address belongs to Cloudflare's edge.
 *
 * @param ip - A valid IPv4 or IPv6 address
 */
export function isCloudflareEdgeIp(ip: string): boolean {
  return cloudflareEdge.check(ip, isIP(ip) === 6 ? "ipv6" : "ipv4");
}

/**
 * Whether the request carries the secret only Shelf's own Cloudflare zone adds.
 * False when `CLOUDFLARE_PROXY_SECRET` is not configured.
 *
 * @param headers - The incoming request's headers
 */
function cameThroughOwnZone(headers: Headers): boolean {
  const expected = process.env.CLOUDFLARE_PROXY_SECRET;
  const received = headers.get(PROXY_SECRET_HEADER);
  if (!expected || !received) return false;
  // Hash both sides so the comparison is constant-time whatever their lengths.
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(received), digest(expected));
}

/** Set once the invalid-setting warning has been printed, so it prints once. */
let warnedAboutHops = false;

/**
 * The number of reverse proxies in front of Shelf, from `TRUSTED_PROXY_HOPS`.
 *
 * A value that is not a positive integer (`0`, `none`, `two`) counts as unset,
 * with a one-time warning, so a typo behaves like an instance without the
 * setting instead of silently changing how visitors are told apart.
 *
 * @returns The hop count, or null when unset or invalid
 */
export function getTrustedProxyHops(): number | null {
  const raw = process.env.TRUSTED_PROXY_HOPS?.trim();
  if (!raw) return null;
  const hops = Number(raw);
  if (Number.isInteger(hops) && hops >= 1) return hops;
  if (!warnedAboutHops) {
    warnedAboutHops = true;
    // why: the Logger module reads env, so it cannot be imported here
    // eslint-disable-next-line no-console
    console.warn(
      `TRUSTED_PROXY_HOPS must be a positive whole number of proxies; got "${raw}". Ignoring it.`
    );
  }
  return null;
}

/**
 * Expands an IPv6 address to its eight full groups.
 *
 * @param ip - A valid IPv6 address without an embedded IPv4 part
 */
function expandIPv6(ip: string): string[] {
  const [head, tail = ""] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const missing = ip.includes("::") ? 8 - left.length - right.length : 0;
  return [...left, ...Array<string>(missing).fill("0"), ...right].map((group) =>
    group.padStart(4, "0")
  );
}

/**
 * The key an in-memory rate limiter counts an address under.
 *
 * One IPv6 visitor usually holds a whole /64 and can pick a new address in it
 * for every request, so IPv6 addresses count by their /64. IPv4 addresses, and
 * IPv6 addresses carrying an IPv4 part, count as themselves.
 *
 * @param ip - A valid IP address
 * @returns The rate-limit key for that address
 */
export function rateLimitKeyForIp(ip: string): string {
  if (isIP(ip) !== 6 || ip.includes(".")) return ip;
  return `${expandIPv6(ip).slice(0, 4).join(":")}::/64`;
}

/**
 * The visitor's IP address, read from the headers trusted where the app runs
 * (see the file header).
 *
 * @param headers - The incoming request's headers
 * @returns A valid IP address, or null when no trusted header carries one
 */
export function getClientIpFromHeaders(headers: Headers): string | null {
  const onFly = Boolean(process.env.FLY_APP_NAME);

  if (onFly) {
    const edgeIp = asIp(headers.get("fly-client-ip"));
    if (edgeIp && isCloudflareEdgeIp(edgeIp) && cameThroughOwnZone(headers)) {
      // The request came through Shelf's zone, whose edge overwrites any
      // client-sent CF-Connecting-IP with the visitor's address.
      return asIp(headers.get("cf-connecting-ip")) ?? edgeIp;
    }
    return edgeIp;
  }

  const hops = getTrustedProxyHops();
  if (hops === null) return null;
  const entries = headers.get("x-forwarded-for")?.split(",") ?? [];
  return asIp(entries[entries.length - hops]);
}

/**
 * The leftmost `X-Forwarded-For` entry, for in-memory rate-limit buckets on
 * instances that do not set `TRUSTED_PROXY_HOPS`.
 *
 * A caller can put any value there, so it can choose a fresh bucket per
 * request. Never send it to another service or use it where that matters: it
 * only spreads ordinary visitors across buckets instead of throttling every
 * visitor of a self-hosted instance together.
 *
 * @param headers - The incoming request's headers
 * @returns A valid IP address, or null
 */
export function getUnverifiedForwardedIp(headers: Headers): string | null {
  return asIp(headers.get("x-forwarded-for")?.split(",")[0]);
}
