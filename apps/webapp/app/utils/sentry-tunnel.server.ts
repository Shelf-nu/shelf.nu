/**
 * Sentry tunnel destination pinning.
 *
 * The tunnel (`/api/sentry-tunnel`) exists so error envelopes reach Sentry
 * through our own domain instead of being blocked by ad-blockers. It is a
 * server-side proxy, so the question of WHERE it forwards to is a security
 * boundary, not a detail.
 *
 * It originally read the destination host out of the DSN in the client's own
 * envelope. That made the host fully attacker-controlled: any authenticated
 * user could make the server POST to an arbitrary address and read the
 * response back — a full-read SSRF, and one that reached internal-only hosts
 * (cloud metadata, RFC1918, localhost) via a redirect from an attacker-owned
 * public host.
 *
 * The fix is to stop deriving the destination from input at all. The server
 * already knows the only Sentry project it may talk to — its own `SENTRY_DSN`.
 * So the envelope's DSN is now only ever COMPARED against that; the URL the
 * tunnel fetches is built entirely from server-side configuration.
 *
 * This is deliberately stricter than {@link file://./ssrf.server.ts}'s
 * `safeFetch`, which blocks private/reserved addresses but still permits any
 * globally-routable host. That is the right boundary for user-supplied image
 * URLs, where arbitrary public hosts are the feature. Here they are not: the
 * tunnel has exactly one legitimate destination, so an allow-list of one is
 * both safer and simpler than filtering the internet.
 *
 * @see {@link file://./../routes/api+/sentry-tunnel.ts} — the only consumer
 * @see {@link file://./ssrf.server.ts} — the general-purpose SSRF guard
 */

import { SENTRY_DSN } from "~/utils/env";

/**
 * A validated Sentry ingest destination.
 *
 * Only ever produced by {@link parseSentryDsn}, which is what lets
 * {@link buildSentryEnvelopeUrl} trust the scheme: a value of this type has
 * already been proven to be an https DSN. Holding it as a type rather than a
 * raw string is deliberate — it means a client-supplied DSN cannot reach URL
 * construction by mistake.
 */
export type SentryIngestTarget = {
  /**
   * Scheme + host + port, normalised by the URL parser (`https://host:8443`).
   *
   * `origin` rather than `hostname` because a self-hosted Sentry can run on a
   * non-default port, and `hostname` silently drops it. It also strips
   * userinfo, so `https://ours@evil.com/` yields `https://evil.com` and cannot
   * masquerade as us.
   */
  origin: string;
  /**
   * Base path a self-hosted Sentry is mounted under, without a trailing slash
   * (`/sentry`), or `""` for a root-mounted instance such as sentry.io.
   */
  pathPrefix: string;
  /** Numeric Sentry project id (the DSN's final path segment). */
  projectId: string;
};

/**
 * Parses a Sentry DSN (`https://<publicKey>@<host>/<projectId>`) into the
 * pieces that identify its ingest endpoint.
 *
 * The public key is deliberately ignored: it is not a secret (it ships in the
 * client bundle), it rotates, and it is not what we are authorizing on. Host
 * and project id are what decide where bytes go.
 *
 * Fails closed — anything unparseable, non-http(s), or missing a project id
 * returns `null` rather than a partially-trusted result.
 *
 * @param dsn - A Sentry DSN, or nullish when Sentry is not configured
 * @returns The ingest target, or `null` if the DSN is absent or unusable
 */
export function parseSentryDsn(
  dsn: string | undefined | null
): SentryIngestTarget | null {
  if (!dsn) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }

  // https only, deliberately. The tunnel has always egressed over https, so an
  // http DSN never actually worked — accepting one here would only create an
  // asymmetry with `buildSentryEnvelopeUrl` (which pins https), and the next
  // editor to derive the scheme from the parsed target would silently
  // reintroduce plaintext egress.
  if (url.protocol !== "https:") {
    return null;
  }

  // The project id is the LAST path segment; anything before it is the base
  // path a self-hosted instance is mounted under. Both have to be kept: the
  // ingest endpoint is `<origin><prefix>/api/<projectId>/envelope/`, so
  // dropping the prefix (or the port, via `hostname`) forwards to a URL that
  // does not exist on that deployment.
  const segments = url.pathname.split("/").filter(Boolean);
  const projectId = segments.pop() ?? "";
  const pathPrefix = segments.length > 0 ? `/${segments.join("/")}` : "";

  // The public key is mandatory per the DSN spec, so its absence means the
  // string is not a DSN at all. We still do not COMPARE it (see below) — this
  // only stops a malformed value being treated as a usable destination.
  //
  // The project id is deliberately NOT required to be numeric: Sentry's own
  // SDK spec calls it a string identifier that is merely "usually an integer",
  // and it never reaches URL construction from client input anyway.
  if (!url.username || !url.hostname || !projectId) {
    return null;
  }

  return { origin: url.origin, pathPrefix, projectId };
}

/**
 * The single destination the tunnel is permitted to forward to, derived from
 * the server's own `SENTRY_DSN`.
 *
 * `SENTRY_DSN` is optional (self-hosters may run without Sentry), so this
 * returns `null` when the tunnel has no legitimate destination at all — in
 * which case the route refuses to proxy anything rather than falling back to
 * whatever the client asked for.
 *
 * @returns The configured ingest target, or `null` if Sentry is not configured
 */
export function getConfiguredSentryTarget(): SentryIngestTarget | null {
  return parseSentryDsn(SENTRY_DSN);
}

/**
 * Whether an envelope's DSN addresses exactly the configured Sentry project.
 *
 * Compares parsed URL components (origin, base path, project id), never
 * substrings. Substring matching on a host is trivially bypassed from both ends — `evil-o123.ingest.sentry.io`
 * ends with ours, `o123.ingest.sentry.io.evil.com` contains it, and
 * `https://o123.ingest.sentry.io@evil.com/` hides ours in the userinfo where a
 * naive check reads it as the host.
 *
 * @param dsn - The DSN taken from the client's envelope header (untrusted)
 * @param target - The server's configured ingest target
 * @returns `true` only if both host and project id match exactly
 */
export function envelopeDsnMatches(
  dsn: string,
  target: SentryIngestTarget
): boolean {
  const parsed = parseSentryDsn(dsn);

  return (
    parsed !== null &&
    parsed.origin === target.origin &&
    parsed.pathPrefix === target.pathPrefix &&
    parsed.projectId === target.projectId
  );
}

/**
 * Builds the ingest URL for a target.
 *
 * Takes a {@link SentryIngestTarget} rather than a string precisely so a raw,
 * client-supplied DSN cannot be passed here by mistake — the only way to get
 * one is through {@link getConfiguredSentryTarget}.
 *
 * @param target - The configured ingest target
 * @returns The absolute envelope endpoint URL
 */
export function buildSentryEnvelopeUrl(target: SentryIngestTarget): string {
  // The scheme comes from `origin`, which is safe because `parseSentryDsn` is
  // the only way to obtain a target and it refuses anything but https.
  return `${target.origin}${target.pathPrefix}/api/${target.projectId}/envelope/`;
}
