/**
 * Companion-app server registry.
 *
 * Maps a customer domain to the Shelf instance its users belong to, so the
 * companion app can connect to the right server when a user asks it to. This
 * module
 * is the ONLY reader of `COMPANION_SERVERS` — when the registry moves to a
 * database table (per-entry expiry, revocation, paid entitlement), only this
 * file changes.
 *
 * Deliberately fail-open: a missing, malformed, or partially invalid registry
 * resolves to `null`, which callers treat as "use Shelf Cloud". This sits on
 * the login path for every companion user, so a bad env value must degrade to
 * the default rather than break sign-in.
 *
 * An entry is either a bare URL string or an object carrying per-server
 * options:
 *
 * ```jsonc
 * {
 *   "acme.edu": "https://acme.i.shelf.nu",
 *   "globex.com": {
 *     "url": "https://globex.i.shelf.nu",
 *     "disablePasswordLogin": true
 *   }
 * }
 * ```
 *
 * @see {@link file://./../../routes/api+/mobile+/resolve-server.ts}
 */
import { COMPANION_SERVERS } from "~/utils/env";
import { Logger } from "~/utils/logger";

/** One registered instance, after parsing and validation. */
type CompanionServerEntry = {
  baseUrl: string;
  /**
   * Hides email/password sign-in in the COMPANION APP for this server.
   *
   * Cosmetic and app-only by design: Shelf sets it centrally for customers
   * whose instance it does not administer, and the app authenticates against
   * that server's Supabase directly, so nothing here can refuse a sign-in. The
   * web login form is untouched — administrators use it.
   */
  disablePasswordLogin: boolean;
};

/**
 * Parses `COMPANION_SERVERS`, keeping only well-formed https entries.
 *
 * Intentionally not memoised: the parse is a few microseconds on a
 * once-per-login path, and caching it would make the resolver ignore a changed
 * env value within a process — which is exactly what the unit tests exercise.
 *
 * @returns The domain → entry map, or `null` when unset or unparseable.
 */
function getRegistry(): Record<string, CompanionServerEntry> | null {
  const raw = COMPANION_SERVERS?.trim();
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  // why: a null-prototype map. A plain object answers a lookup for
  // `constructor` / `__proto__` / `toString` from the prototype chain, which is
  // neither a string nor nullish — so `?? null` never fires, the documented
  // `string | null` contract breaks, and JSON.stringify drops the `baseUrl` key
  // entirely for those inputs.
  const entries: Record<string, CompanionServerEntry> = Object.create(null);

  for (const [domain, value] of Object.entries(parsed)) {
    // A bare string is the plain form; an object carries per-server options.
    // Anything else is dropped, so a malformed entry costs one domain rather
    // than the whole registry.
    const isRecord =
      typeof value === "object" && value !== null && !Array.isArray(value);
    const url = isRecord
      ? (value as { url?: unknown }).url
      : (value as unknown);
    const disablePasswordLogin =
      isRecord &&
      (value as { disablePasswordLogin?: unknown }).disablePasswordLogin ===
        true;

    if (typeof url !== "string") {
      // Said out loud, because the shape is easy to get wrong in a one-line env
      // var — putting an option beside the domain instead of inside its entry
      // reads as a second domain, and dropping it silently costs an afternoon.
      Logger.warn(
        `[companion-servers] ignoring "${domain}": expected a URL string or ` +
          `{ url, ... }, got ${
            Array.isArray(value) ? "an array" : typeof value
          }`
      );
      continue;
    }
    // https only — the companion app refuses plaintext, so an http entry is
    // dead config. Dropping it here keeps the failure at "unknown domain"
    // rather than a confusing client-side error.
    //
    // Keep this prefix check even though we parse below: `new URL()` resolves
    // scheme-relative forms for special schemes, so `https:acme.example.com`
    // parses to a perfectly good https URL with a hostname. Parsing ALONE
    // would therefore widen what we accept, not narrow it.
    if (!url.startsWith("https://")) {
      Logger.warn(
        `[companion-servers] ignoring "${domain}": ${url} is not https`
      );
      continue;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      continue;
    }

    // Must be usable as a BASE url. `https://` has no host to reach, and a
    // query or fragment would swallow the `/api/mobile/...` path the companion
    // concatenates onto this — it would silently fetch the site root and get
    // HTML back.
    if (!parsedUrl.hostname || parsedUrl.search || parsedUrl.hash) continue;

    entries[domain.trim().toLowerCase()] = {
      baseUrl: url.replace(/\/+$/, ""),
      disablePasswordLogin,
    };
  }

  return entries;
}

/**
 * Resolves an email domain to the base URL of its Shelf instance.
 *
 * @param domain - Email domain, e.g. `acme.edu`. Case- and whitespace-tolerant.
 * @returns The instance base URL without a trailing slash, or `null` when the
 *   domain is not registered — meaning the caller should use Shelf Cloud.
 */
/**
 * Finds an entry by customer domain, or failing that by the instance's own
 * hostname.
 *
 * A customer knows two names for themselves: the domain their email is on
 * (`kent.edu`) and the address of their Shelf (`kent.shelf.nu`). Only the first
 * is a registry key, but someone typing the second has given a perfectly
 * unambiguous answer — matching it too costs one pass over a handful of entries
 * and saves the "why doesn't my own server work" support round trip.
 *
 * @param domain - Normalised lookup value.
 * @returns The entry, or `null` when nothing matches.
 */
function findEntry(domain: string): CompanionServerEntry | null {
  const registry = getRegistry();
  if (!registry) return null;

  const key = domain.trim().toLowerCase();
  const direct = registry[key];
  if (direct) return direct;

  for (const entry of Object.values(registry)) {
    try {
      if (new URL(entry.baseUrl).hostname.toLowerCase() === key) return entry;
    } catch {
      // Unreachable: getRegistry only keeps entries it could parse.
    }
  }

  return null;
}

export function resolveCompanionServer(domain: string): string | null {
  return findEntry(domain)?.baseUrl ?? null;
}

/**
 * Whether the companion app should hide password sign-in for a domain.
 *
 * A separate narrow accessor rather than returning the whole entry: every
 * caller of this module feeds an unauthenticated endpoint, and handing out a
 * record invites a future field being serialised along with it.
 *
 * @param domain - Customer domain. Case- and whitespace-tolerant.
 * @returns `true` only when the entry sets it explicitly; unregistered domains
 *   and plain string entries are `false`.
 */
export function isPasswordLoginDisabledFor(domain: string): boolean {
  return findEntry(domain)?.disablePasswordLogin ?? false;
}
