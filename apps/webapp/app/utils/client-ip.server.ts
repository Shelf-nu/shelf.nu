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
 *   `CF-Connecting-IP`. `CF-Connecting-IP` is trusted only when `Fly-Client-IP`
 *   is inside Cloudflare's published ranges: anyone can reach the Fly app
 *   directly and send a made-up `CF-Connecting-IP`, which would let them pick a
 *   fresh rate-limit key on every request.
 * - **Off Fly** (self-hosted behind a reverse proxy, or local dev): the leftmost
 *   `X-Forwarded-For`. The operator's proxy is responsible for setting it.
 *   `Fly-Client-IP` and `CF-Connecting-IP` are never read here, because without
 *   the Fly edge either one is just a header the client chose.
 *
 * @see {@link file://./../../server/client-ip.ts}
 * @see {@link file://./../integrations/supabase/client.ts}
 */
import { BlockList, isIP } from "node:net";

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
    if (edgeIp && isCloudflareEdgeIp(edgeIp)) {
      // The request came through Cloudflare, which overwrites any
      // client-sent CF-Connecting-IP with the visitor's address.
      return asIp(headers.get("cf-connecting-ip")) ?? edgeIp;
    }
    return edgeIp;
  }

  return asIp(headers.get("x-forwarded-for")?.split(",")[0]);
}
