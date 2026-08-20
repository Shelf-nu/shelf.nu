/**
 * Server discovery.
 *
 * Turns the email a user typed at login into the Shelf server they belong to:
 * Shelf Cloud resolves the domain to a base URL, then that server describes
 * itself via `/api/mobile/config`.
 *
 * Fail-open throughout. A Shelf Cloud outage, a timeout, or a garbled response
 * leaves the app on its current server and lets login proceed — discovery is an
 * optimisation for enterprise users, never a gate for cloud users.
 *
 * @see ./contract.ts — the pure validation this builds on
 * @see apps/webapp/app/routes/api+/mobile+/resolve-server.ts
 * @see apps/webapp/app/routes/api+/mobile+/config.ts
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getAppVersion } from "../app-update";
import {
  CLOUD_SERVER,
  getActiveServer,
  setActiveServer,
} from "./active-server";
import {
  extractEmailDomain,
  isAppVersionSupported,
  isResolutionFresh,
  normalizeBaseUrl,
  parseServerConfigResponse,
  RESOLUTION_CACHE_STORAGE_KEY,
  type ConfigParseResult,
  type DomainResolution,
} from "./contract";

/**
 * Result of a discovery attempt. `message` is ready-to-display copy.
 *
 * `updateRequired` means the failure is this build being too old for the target
 * server — the caller should offer a store link rather than a plain retry,
 * because retrying can never succeed.
 */
export type DiscoveryOutcome =
  | { ok: true }
  | { ok: false; message: string; updateRequired?: boolean };

/** Registry lookups sit on the login path — keep the wait short. */
const RESOLVE_TIMEOUT_MS = 5_000;

/** The target server may be behind a slow corporate network or VPN. */
const CONFIG_TIMEOUT_MS = 10_000;

/**
 * `fetch` with an abort-based timeout.
 *
 * @param url - Absolute URL to request.
 * @param init - Standard fetch init; a `signal` here would be overwritten.
 * @param timeoutMs - Abort after this many milliseconds.
 * @returns The response. Rejects on timeout, like any other network failure.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads the whole domain → resolution cache.
 *
 * @returns The cache, or an empty object when missing or unreadable.
 */
async function readCache(): Promise<Record<string, DomainResolution>> {
  try {
    const raw = await AsyncStorage.getItem(RESOLUTION_CACHE_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, DomainResolution>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Writes one cache entry.
 *
 * @param domain - The email domain being cached.
 * @param baseUrl - Resolved base URL, or `null` for Shelf Cloud.
 * @returns Resolves when written. Never throws — a failed write only costs one
 *   extra network call next time.
 */
async function writeCacheEntry(
  domain: string,
  baseUrl: string | null
): Promise<void> {
  try {
    const cache = await readCache();
    cache[domain] = { baseUrl, cachedAt: Date.now() };
    await AsyncStorage.setItem(
      RESOLUTION_CACHE_STORAGE_KEY,
      JSON.stringify(cache)
    );
  } catch {
    // Non-fatal by design.
  }
}

/**
 * Removes one cache entry so the next attempt re-resolves.
 *
 * @param domain - The email domain to forget.
 * @returns Resolves when removed. Never throws — the entry would otherwise just
 *   expire on its TTL.
 */
async function dropCacheEntry(domain: string): Promise<void> {
  try {
    const cache = await readCache();
    delete cache[domain];
    await AsyncStorage.setItem(
      RESOLUTION_CACHE_STORAGE_KEY,
      JSON.stringify(cache)
    );
  } catch {
    // Non-fatal by design.
  }
}

/**
 * Asks Shelf Cloud which server a domain belongs to.
 *
 * @param domain - Lowercased email domain.
 * @returns The base URL, `null` when the domain belongs to Shelf Cloud, or
 *   `undefined` when the lookup itself failed. The caller must NOT cache
 *   `undefined` — a transient outage would otherwise be remembered for a week.
 */
async function askRegistry(domain: string): Promise<string | null | undefined> {
  try {
    const response = await fetchWithTimeout(
      `${CLOUD_SERVER.baseUrl}/api/mobile/resolve-server`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain }),
      },
      RESOLVE_TIMEOUT_MS
    );
    if (!response.ok) return undefined;
    const body = (await response.json()) as { baseUrl?: unknown };
    return typeof body?.baseUrl === "string" ? body.baseUrl : null;
  } catch {
    return undefined;
  }
}

/**
 * Fetches and validates a server's self-description.
 *
 * @param baseUrl - The candidate server's base URL.
 * @returns The parse result, or `{ ok: false, reason: "unreachable" }` when the
 *   server could not be contacted at all — a distinct case from a server that
 *   answered with something invalid.
 */
async function fetchServerConfig(
  baseUrl: string
): Promise<
  { ok: true; config: ConfigParseResult } | { ok: false; reason: "unreachable" }
> {
  try {
    const response = await fetchWithTimeout(
      `${normalizeBaseUrl(baseUrl)}/api/mobile/config`,
      { method: "GET", headers: { accept: "application/json" } },
      CONFIG_TIMEOUT_MS
    );
    if (!response.ok) return { ok: false, reason: "unreachable" };
    const json: unknown = await response.json();
    return {
      ok: true,
      config: parseServerConfigResponse(json, normalizeBaseUrl(baseUrl), false),
    };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}

/**
 * Resolves and switches to the server the given email belongs to.
 *
 * Call before password sign-in and before opening the SSO web flow, so
 * credentials go to the right server's Supabase project.
 *
 * @param email - Raw contents of the email field.
 * @returns `{ ok: true }` when the app is on the correct server — including
 *   when nothing needed to change — or `{ ok: false, message }` with copy to
 *   display.
 */
export async function resolveServerForEmail(
  email: string
): Promise<DiscoveryOutcome> {
  const domain = extractEmailDomain(email);
  if (!domain) return { ok: true };

  const cache = await readCache();
  const cached = cache[domain];
  const useCached = Boolean(cached && isResolutionFresh(cached, Date.now()));

  let baseUrl: string | null | undefined;
  if (useCached) {
    baseUrl = cached.baseUrl;
  } else {
    baseUrl = await askRegistry(domain);
    // Registry unreachable — stay put and let login proceed against the
    // current server rather than blocking on our own availability.
    if (baseUrl === undefined) return { ok: true };
    await writeCacheEntry(domain, baseUrl);
  }

  // Domain belongs to Shelf Cloud.
  if (baseUrl === null) {
    if (!getActiveServer().isCloud) await setActiveServer(CLOUD_SERVER);
    return { ok: true };
  }

  // Already connected to the right server.
  if (normalizeBaseUrl(baseUrl) === getActiveServer().baseUrl) {
    return { ok: true };
  }

  const fetched = await fetchServerConfig(baseUrl);

  if (!fetched.ok) {
    // A stale cached entry is the likely cause, so drop it and re-resolve once
    // against the registry — a server that moved then heals on this attempt
    // instead of needing a reinstall. Terminates: dropCacheEntry guarantees the
    // retry takes the askRegistry branch, where useCached is false.
    if (useCached) {
      await dropCacheEntry(domain);
      return resolveServerForEmail(email);
    }
    return {
      ok: false,
      message:
        "Can't reach your organization's Shelf server. If you're off the company network, connect to VPN and try again.",
    };
  }

  if (!fetched.config.ok) {
    return {
      ok: false,
      message:
        fetched.config.reason === "unsupported_version"
          ? "This Shelf server needs to be updated before the app can connect."
          : "This server isn't set up for the Shelf app. Contact your administrator.",
    };
  }

  // Force-update gate. Checked BEFORE setActiveServer so a too-old app never
  // half-switches: it keeps its current working server instead of landing on
  // one it cannot talk to.
  if (
    !isAppVersionSupported(getAppVersion(), fetched.config.minCompanionVersion)
  ) {
    return {
      ok: false,
      updateRequired: true,
      message: `${fetched.config.config.name} requires a newer version of Shelf. Update the app to continue.`,
    };
  }

  await setActiveServer(fetched.config.config);
  return { ok: true };
}
