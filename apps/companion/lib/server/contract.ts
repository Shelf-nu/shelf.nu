/**
 * Pure server-contract helpers.
 *
 * Types, constants and validation shared by the companion's multi-server
 * support. Everything here is deliberately free of React Native, Expo and
 * `@/`-aliased imports so it can be executed directly by Node's test runner via
 * tsx — the RN-dependent pieces live in `./active-server.ts` and
 * `./discovery.ts`.
 *
 * This module must import NOTHING. It sits at the bottom of the dependency
 * graph precisely so the modules above it can share constants without forming
 * a require cycle (Metro resolves cycles to `undefined` at module-eval time,
 * which surfaces as a crash far from the cause).
 *
 * @see ./active-server.ts — persistence, switching and teardown
 * @see ./discovery.ts — deciding WHICH server to switch to
 */

/** The single runtime identity of the app: which Shelf server it talks to. */
export type ServerConfig = {
  /** Origin of the Shelf webapp, never with a trailing slash. */
  baseUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Display name, e.g. "Acme University". */
  name: string;
  /** True only for the bundled Shelf Cloud default. */
  isCloud: boolean;
};

/**
 * Outcome of validating a `/api/mobile/config` response.
 *
 * The three failure reasons stay distinguishable because each maps to
 * different user-facing copy — "update the server" is a very different
 * instruction from "you're off the VPN".
 */
export type ConfigParseResult =
  | {
      ok: true;
      config: ServerConfig;
      /**
       * Lowest app version this server accepts, or null for "any". Kept OUT of
       * `ServerConfig` deliberately: it is a gate evaluated at connect time,
       * not part of the server's persisted identity, and it can change under a
       * persisted config without invalidating it.
       */
      minCompanionVersion: string | null;
    }
  | { ok: false; reason: "malformed" | "insecure" | "unsupported_version" };

/**
 * Lowest `mobileApiVersion` this build can talk to. Raise it in lockstep with a
 * breaking change to the webapp's `/api/mobile/*` contract.
 *
 * @see apps/webapp/app/routes/api+/mobile+/config.ts — `MOBILE_API_VERSION`
 */
export const MIN_SERVER_MOBILE_API_VERSION = 1;

/**
 * Highest `mobileApiVersion` this build understands.
 *
 * why an upper bound at all: raising the minimum "in lockstep" only ever
 * protects builds we ship AFTER the change. A self-hoster who upgrades their
 * server to a future breaking version 2 cannot update the copies of the app
 * already on their users' phones — so without this, those installs read the
 * newer number, decide it clears the floor, and walk into a contract they do
 * not implement. Failing closed turns that into the unsupported-version screen
 * this type already models, which is the honest outcome: the phone is too old
 * for that server and needs a store update.
 */
export const MAX_SERVER_MOBILE_API_VERSION = 1;

/** AsyncStorage key holding the serialised active `ServerConfig`. */
export const ACTIVE_SERVER_STORAGE_KEY = "shelf_active_server";

/**
 * Every fixed AsyncStorage key whose value belongs to ONE server and must be
 * wiped when the app switches.
 *
 * Device preferences (theme, start page, scan sound, review prompt) are
 * intentionally absent: they are properties of the device, not the server, and
 * survive a switch.
 */
export const SERVER_SCOPED_STORAGE_KEYS: readonly string[] = [
  "shelf_selected_org_id",
];

/**
 * Key prefix for persisted audit scan drafts, owned by
 * `lib/audit-scan-persistence.ts`.
 *
 * Declared HERE rather than there so `active-server.ts` can clear the drafts
 * without importing that module — which imports `lib/sentry.ts`, which imports
 * `active-server.ts`. Routing the constant through this dependency-free module
 * breaks that cycle. `audit-scan-persistence.ts` imports it, so there is still
 * exactly one definition.
 */
export const AUDIT_SCAN_KEY_PREFIX = "shelf_audit_scan_";

/**
 * Dynamic server-scoped keys, matched by prefix against `getAllKeys()`.
 * Every entry must be a prefix no device-preference key could ever match.
 */
export const SERVER_SCOPED_KEY_PREFIXES: readonly string[] = [
  AUDIT_SCAN_KEY_PREFIX,
];

/**
 * Extracts the lowercased domain from an email address.
 *
 * Splits on the LAST `@`: a quoted local part may legally contain one, and
 * taking the first would let `"a@evil.com"@acme.edu` resolve to the wrong
 * server.
 *
 * @param email - Raw user input; may carry whitespace or plus-addressing.
 * @returns The domain, or `null` when the input has no usable one. A domain
 *   with no dot (e.g. `localhost`) is rejected — it can never be a registered
 *   customer domain, and probing for it would be a wasted round trip.
 */
export function extractEmailDomain(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0) return null;

  const domain = normalized.slice(at + 1);
  return domain.length > 0 && domain.includes(".") ? domain : null;
}

/**
 * Normalises whatever the user typed into the connect field to a registry key.
 *
 * The registry is keyed by email domain, so that is what this produces. The
 * field accepts the three things people actually type — a bare domain, a full
 * email address, or a pasted URL — because all three identify the same
 * organisation and rejecting two of them teaches nothing.
 *
 * @param input - Raw contents of the connect field.
 * @returns The lowercased domain, or `null` when the input has no usable one.
 *   A value with no dot is rejected: it can never be a registered customer
 *   domain, so probing for it would be a wasted round trip.
 */
export function normalizeDomainInput(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.includes("@")) return extractEmailDomain(trimmed);

  const host = trimmed.replace(/^https?:\/\//, "").split("/")[0];
  return host.length > 0 && host.includes(".") ? host : null;
}

/**
 * Removes trailing slashes so base URLs concatenate predictably with paths.
 *
 * @param url - A base URL, possibly with trailing slashes.
 * @returns The same URL without any trailing slash.
 */
export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Parses a dotted version string into numeric segments.
 *
 * Tolerates a build/pre-release suffix (`1.3.0-beta.2` → `[1, 3, 0]`) because
 * `Constants.expoConfig.version` can legitimately carry one.
 *
 * @param value - A version string.
 * @returns The numeric segments, or `null` when the value has no leading digit
 *   group (i.e. it is not a version at all).
 */
function parseVersionSegments(value: string): number[] | null {
  const core = value.trim().split(/[-+]/)[0] ?? "";
  if (!/^\d+(\.\d+)*$/.test(core)) return null;
  return core.split(".").map(Number);
}

/**
 * Whether this app build is new enough for a server.
 *
 * The server advertises `minCompanionVersion` on `/api/mobile/config`; an app
 * below it is shown a blocking update prompt rather than being allowed to
 * connect and fail with confusing 4xx errors. This is the counterpart to
 * `MIN_SERVER_MOBILE_API_VERSION`, which guards the other direction — neither
 * side can update the other, so both checks have to exist.
 *
 * Compare segment-by-segment as NUMBERS, never as strings: `"1.10.0" < "1.9.0"`
 * lexically, which would lock every user out one release after the tenth.
 *
 * Fails OPEN on anything unparseable: a typo in the server's env var must never
 * brick a working install.
 *
 * @param appVersion - This build's version, e.g. from `Constants.expoConfig`.
 * @param minVersion - The server's required minimum, or null/empty for "any".
 * @returns `true` when the app may connect.
 */
export function isAppVersionSupported(
  appVersion: string,
  minVersion: string | null | undefined
): boolean {
  if (!minVersion) return true;

  const required = parseVersionSegments(minVersion);
  const actual = parseVersionSegments(appVersion);
  if (!required || !actual) return true;

  const length = Math.max(required.length, actual.length);
  for (let i = 0; i < length; i++) {
    // A missing segment is zero: "1.3" and "1.3.0" are the same version.
    const a = actual[i] ?? 0;
    const r = required[i] ?? 0;
    if (a > r) return true;
    if (a < r) return false;
  }
  return true;
}

/**
 * Why a connection attempt failed.
 *
 * Distinct values because the UI does different things with them: only
 * `update_required` offers a store link, and only the two `unreachable` cases
 * are worth retrying unchanged.
 */
export type ConnectFailureReason =
  | "invalid_domain"
  | "not_registered"
  | "registry_unreachable"
  | "server_unreachable"
  | "incompatible"
  | "update_required";

/** A refusal to connect, carrying ready-to-display copy. */
export type ConnectRefusal = {
  ok: false;
  reason: ConnectFailureReason;
  message: string;
};

/** Result of a connection attempt. */
export type ConnectOutcome =
  | { ok: true; server: ServerConfig }
  | ConnectRefusal;

/** Either a base URL worth fetching a config from, or a refusal. */
export type CandidateDecision = { ok: true; baseUrl: string } | ConnectRefusal;

/**
 * Decides whether the registry's answer for a domain is worth pursuing.
 *
 * Pure so the whole refusal table is testable without a network: the live
 * lookup is the caller's job, its answer is this function's input.
 *
 * @param input - Raw contents of the connect field.
 * @param registryAnswer - The registry's reply: a base URL, `null` when the
 *   domain is not registered to an instance, or `undefined` when the lookup
 *   itself failed. The last two are deliberately distinct — one means "no such
 *   customer", the other means "ask again later".
 * @returns The base URL to fetch a config from, or a refusal to show.
 */
export function decideServerCandidate(
  input: string,
  registryAnswer: string | null | undefined
): CandidateDecision {
  const domain = normalizeDomainInput(input);
  if (!domain) {
    return {
      ok: false,
      reason: "invalid_domain",
      message: "Enter your organization's domain, for example acme.com.",
    };
  }

  if (registryAnswer === undefined) {
    return {
      ok: false,
      reason: "registry_unreachable",
      message:
        "Can't reach Shelf to look up that domain. Check your connection and try again.",
    };
  }

  if (registryAnswer === null) {
    return {
      ok: false,
      reason: "not_registered",
      message: `${domain} isn't set up for a private server. Check with your administrator.`,
    };
  }

  // Refuse plaintext BEFORE the config request rather than after: this is the
  // first moment the app holds a URL it did not construct, and by the time
  // `parseServerConfigResponse` repeats the check the request has already left
  // the device.
  if (!registryAnswer.startsWith("https://")) {
    return {
      ok: false,
      reason: "incompatible",
      message: "That server isn't set up securely. Contact your administrator.",
    };
  }

  return { ok: true, baseUrl: registryAnswer };
}

/**
 * Decides whether a server that answered is one this build may connect to.
 *
 * Pure for the same reason as {@link decideServerCandidate}: the fetch belongs
 * to the caller, the verdict belongs here.
 *
 * @param parsed - The parsed `/api/mobile/config` response, or `null` when the
 *   server could not be contacted at all.
 * @param appVersion - This build's version, compared against the server's
 *   advertised minimum.
 * @returns The server to switch to, or a refusal to show. A refusal here always
 *   means the caller must NOT switch: a half-connected app would be pointed at
 *   a server it cannot talk to.
 */
export function decideServerConnection(
  parsed: ConfigParseResult | null,
  appVersion: string
): ConnectOutcome {
  if (parsed === null) {
    return {
      ok: false,
      reason: "server_unreachable",
      message:
        "Can't reach your organization's Shelf server. If you're off the company network, connect to VPN and try again.",
    };
  }

  if (!parsed.ok) {
    return {
      ok: false,
      reason: "incompatible",
      message:
        parsed.reason === "unsupported_version"
          ? "This Shelf server needs to be updated before the app can connect."
          : "That server isn't set up for the Shelf app. Contact your administrator.",
    };
  }

  if (!isAppVersionSupported(appVersion, parsed.minCompanionVersion)) {
    return {
      ok: false,
      reason: "update_required",
      message: `${parsed.config.name} requires a newer version of Shelf. Update the app to continue.`,
    };
  }

  return { ok: true, server: parsed.config };
}

/**
 * Whether a string is usable as an https base URL — correct scheme AND a real
 * host.
 *
 * A bare `"https://"` clears a `startsWith` check and then normalises to
 * `"https:"`, which would be persisted as a server or Supabase endpoint and
 * fail opaquely at sign-in rather than here, where the failure carries a
 * reason. Callers keep their `startsWith("https://")` check as well: `new URL`
 * resolves scheme-relative forms for special schemes, so `https:example.com`
 * parses to a valid https URL and parsing alone would widen what we accept.
 *
 * @param value - The candidate URL.
 * @returns `true` only when it parses as https with a non-empty host.
 */
function hasUsableHttpsHost(value: string): boolean {
  try {
    const parsed = new URL(value);
    // Assert the hostname explicitly rather than relying on the constructor to
    // throw — React Native's URL polyfill is laxer than Node's.
    return parsed.protocol === "https:" && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

/**
 * Validates a `/api/mobile/config` response and turns it into a `ServerConfig`.
 *
 * @param json - Parsed response body, typed `unknown` because a server can
 *   return anything: an HTML error page, an empty body, a proxy's own JSON.
 * @param baseUrl - The base URL the response was fetched from.
 * @param isCloud - Whether this is the bundled Shelf Cloud default.
 * @returns A discriminated result. The failure `reason` drives user-facing
 *   copy, so the three cases must stay distinguishable.
 */
export function parseServerConfigResponse(
  json: unknown,
  baseUrl: string,
  isCloud: boolean
): ConfigParseResult {
  // Refuse plaintext before looking at anything else: credentials and session
  // tokens will flow to this origin.
  if (!baseUrl.startsWith("https://")) {
    return { ok: false, reason: "insecure" };
  }
  if (!hasUsableHttpsHost(baseUrl)) {
    return { ok: false, reason: "malformed" };
  }

  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return { ok: false, reason: "malformed" };
  }

  const {
    name,
    supabaseUrl,
    supabaseAnonKey,
    mobileApiVersion,
    minCompanionVersion,
  } = json as {
    name?: unknown;
    supabaseUrl?: unknown;
    supabaseAnonKey?: unknown;
    mobileApiVersion?: unknown;
    minCompanionVersion?: unknown;
  };

  if (
    typeof supabaseUrl !== "string" ||
    supabaseUrl.length === 0 ||
    typeof supabaseAnonKey !== "string" ||
    supabaseAnonKey.length === 0 ||
    typeof mobileApiVersion !== "number"
  ) {
    return { ok: false, reason: "malformed" };
  }

  if (!supabaseUrl.startsWith("https://")) {
    return { ok: false, reason: "insecure" };
  }
  if (!hasUsableHttpsHost(supabaseUrl)) {
    return { ok: false, reason: "malformed" };
  }

  if (
    mobileApiVersion < MIN_SERVER_MOBILE_API_VERSION ||
    mobileApiVersion > MAX_SERVER_MOBILE_API_VERSION
  ) {
    return { ok: false, reason: "unsupported_version" };
  }

  return {
    ok: true,
    // Absent or non-string is treated as "no minimum" — an older server that
    // predates this field must keep working.
    minCompanionVersion:
      typeof minCompanionVersion === "string" && minCompanionVersion.trim()
        ? minCompanionVersion.trim()
        : null,
    config: {
      baseUrl: normalizeBaseUrl(baseUrl),
      supabaseUrl: normalizeBaseUrl(supabaseUrl),
      supabaseAnonKey,
      name: typeof name === "string" && name.trim() ? name.trim() : "Shelf",
      isCloud,
    },
  };
}

/**
 * How a newly fetched server config differs from the active one.
 *
 * - `none` — nothing to apply.
 * - `credentials` — SAME instance, but its Supabase URL, anon key or display
 *   name changed. The app must adopt them without tearing down data that still
 *   belongs to this server.
 * - `switch` — a different instance entirely; everything server-scoped goes.
 */
export type ServerChange = "none" | "credentials" | "switch";

/**
 * Classifies what changed between the active server config and a fresh one.
 *
 * A customer can rotate their Supabase project while keeping the same base URL,
 * so `baseUrl` alone does not tell you whether anything changed — compare the
 * credentials too, or enrolled devices keep using a stale anon key with no
 * in-app way to recover.
 *
 * The credentials case must stay distinct from a switch: the selected
 * organisation and audit drafts still belong to that same instance, so adopting
 * new credentials must not wipe them.
 *
 * @param current - The active server config.
 * @param next - The config just fetched from `/api/mobile/config`.
 * @returns Which of the three cases applies.
 */
export function classifyServerChange(
  current: ServerConfig,
  next: ServerConfig
): ServerChange {
  if (normalizeBaseUrl(current.baseUrl) !== normalizeBaseUrl(next.baseUrl)) {
    return "switch";
  }
  const sameCredentials =
    normalizeBaseUrl(current.supabaseUrl) ===
      normalizeBaseUrl(next.supabaseUrl) &&
    current.supabaseAnonKey === next.supabaseAnonKey &&
    current.name === next.name;
  return sameCredentials ? "none" : "credentials";
}

/**
 * Whether the live Supabase client belongs to a different project than the
 * active server.
 *
 * The single invariant every API request depends on: the token we are about to
 * send was minted by the server we are about to send it to. It holds by
 * construction today — sessions are namespaced per Supabase project, and
 * `setActiveServer` signs out and rebuilds before notifying anyone — but this
 * makes it checkable rather than merely believed. If a future teardown or
 * rebuild bug breaks it, the failure becomes a clean re-auth instead of one
 * server silently receiving another server's credentials.
 *
 * Compares normalized origins: `CLOUD_SERVER` takes its URL straight from the
 * env var while a switched or hydrated config has been normalized, so the two
 * can differ by a trailing slash while naming the same project.
 *
 * @param clientUrl - URL the live Supabase client was built with, or null when
 *   no client has been created yet.
 * @param activeSupabaseUrl - The active server's Supabase URL.
 * @returns `true` only when both exist and genuinely differ.
 */
export function isSessionServerMismatched(
  clientUrl: string | null | undefined,
  activeSupabaseUrl: string
): boolean {
  if (!clientUrl) return false;
  return normalizeBaseUrl(clientUrl) !== normalizeBaseUrl(activeSupabaseUrl);
}

/**
 * Whether a URL belongs to the given server, comparing origins only.
 *
 * Used to reject a scanned QR code minted by a different Shelf server, which
 * would otherwise be resolved against the active one and reported as "not
 * found" — a baffling error for a code that is perfectly valid elsewhere.
 *
 * @param candidateUrl - The scanned URL.
 * @param baseUrl - The active server's base URL.
 * @returns `true` only when both parse and share an origin (scheme, host and
 *   port all matching).
 */
export function isSameOrigin(candidateUrl: string, baseUrl: string): boolean {
  try {
    return new URL(candidateUrl).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}
