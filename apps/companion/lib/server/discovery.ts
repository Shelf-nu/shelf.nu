/**
 * Connecting the app to a Shelf server.
 *
 * The user types their organisation's domain; Shelf Cloud resolves it to a base
 * URL, that server describes itself via `/api/mobile/config`, and only if every
 * check passes does the app switch to it. This is the sole path that changes
 * the active server, which is why the barrel deliberately withholds
 * `setActiveServer` from screens.
 *
 * Connecting is a deliberate act, so it FAILS LOUDLY. Every failure returns a
 * reason the caller renders — a domain nobody recognises, a server that cannot
 * be reached, a version mismatch. Nothing is inferred from what the user typed
 * elsewhere, and nothing happens silently in the background.
 *
 * This module is I/O only. Every verdict comes from `decideServerCandidate` and
 * `decideServerConnection` in `./contract`, which are pure and therefore
 * testable — this file imports Expo and AsyncStorage transitively and cannot be
 * reached by the Node test runner. Keep new rules on that side of the line.
 *
 * Shelf Cloud must be reachable to connect, because the registry lives there.
 * Nothing afterwards needs it: once connected, login and every request go to
 * the connected server alone, so a network that blocks `shelf.nu` still works
 * for daily use.
 *
 * @see ./contract.ts — the pure decisions this orchestrates
 * @see ./active-server.ts — owns the switch and its teardown
 * @see apps/webapp/app/routes/api+/mobile+/resolve-server.ts
 * @see apps/webapp/app/routes/api+/mobile+/config.ts
 */
import { getAppVersion } from "../app-update";
import {
  CLOUD_SERVER,
  getActiveServer,
  getServerVersion,
  setActiveServer,
} from "./active-server";
import {
  decideServerCandidate,
  decideServerConnection,
  normalizeBaseUrl,
  normalizeDomainInput,
  parseServerConfigResponse,
  type ConfigParseResult,
  type ConnectOutcome,
} from "./contract";

// Re-exported so callers import the connect flow's vocabulary from the module
// that runs it; both are declared and documented in ./contract.
export type { ConnectFailureReason, ConnectOutcome } from "./contract";

/** The registry lookup runs while the user waits — keep it short. */
const RESOLVE_TIMEOUT_MS = 5_000;

/** The target server may be behind a slow corporate network or VPN. */
const CONFIG_TIMEOUT_MS = 10_000;

/**
 * `fetch` with an abort-based timeout.
 *
 * The timeout covers reading the BODY as well as receiving the response. A
 * server that sends headers promptly and then stalls its body would otherwise
 * hang the caller forever, because clearing the timer once `fetch` resolves
 * leaves `json()` unbounded — and this runs while the user waits on a spinner.
 *
 * @param url - Absolute URL to request.
 * @param init - Standard fetch init; a `signal` here would be overwritten.
 * @param timeoutMs - Abort after this many milliseconds, including the body.
 * @param readBody - Consumes the response inside the timeout window.
 * @returns Whatever `readBody` returns. Rejects on timeout, like any other
 *   network failure.
 */
async function fetchWithTimeout<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  readBody: (response: Response) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return await readBody(response);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Asks Shelf Cloud which server a domain belongs to.
 *
 * Always queried at `CLOUD_SERVER`, never the active server: Shelf Cloud owns
 * the registry, so an app already connected elsewhere still asks Cloud when the
 * user connects somewhere new.
 *
 * @param domain - A normalised domain, from `normalizeDomainInput`.
 * @returns The base URL, `null` when the domain is not registered to an
 *   instance, or `undefined` when the lookup itself failed.
 */
async function askRegistry(domain: string): Promise<string | null | undefined> {
  try {
    return await fetchWithTimeout(
      `${CLOUD_SERVER.baseUrl}/api/mobile/resolve-server`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain }),
      },
      RESOLVE_TIMEOUT_MS,
      async (response) => {
        if (!response.ok) return undefined;
        const body = (await response.json()) as { baseUrl?: unknown };
        return typeof body?.baseUrl === "string" ? body.baseUrl : null;
      }
    );
  } catch {
    return undefined;
  }
}

/**
 * Fetches and validates a server's self-description.
 *
 * @param baseUrl - The candidate server's base URL.
 * @returns The parse result, or `null` when the server could not be contacted
 *   at all — a distinct case from a server that answered with something
 *   invalid, and one `decideServerConnection` reports differently.
 */
async function fetchServerConfig(
  baseUrl: string
): Promise<ConfigParseResult | null> {
  try {
    return await fetchWithTimeout(
      `${normalizeBaseUrl(baseUrl)}/api/mobile/config`,
      { method: "GET", headers: { accept: "application/json" } },
      CONFIG_TIMEOUT_MS,
      async (response) => {
        if (!response.ok) return null;
        const json: unknown = await response.json();
        return parseServerConfigResponse(
          json,
          normalizeBaseUrl(baseUrl),
          false
        );
      }
    );
  } catch {
    return null;
  }
}

/**
 * Connects the app to the Shelf server registered for a domain.
 *
 * Switches only after the domain resolves, the server answers, and both version
 * gates pass — so a failed attempt always leaves the app on the server it was
 * already using rather than half-connected to one it cannot talk to.
 *
 * @param input - Raw contents of the connect field: a domain, an email address
 *   or a pasted URL.
 * @returns `{ ok: true, server }` once connected, or `{ ok: false, reason,
 *   message }` with copy to display and a reason the UI can branch on.
 */
export async function resolveServerForDomain(
  input: string
): Promise<ConnectOutcome> {
  const domain = normalizeDomainInput(input);

  // Skip the round trip for a value that cannot be a domain. What is passed as
  // the answer in that case does not matter: `decideServerCandidate` normalises
  // the input itself and reports `invalid_domain` before reading it.
  const candidate = decideServerCandidate(
    input,
    domain ? await askRegistry(domain) : undefined
  );
  if (!candidate.ok) return candidate;

  const outcome = decideServerConnection(
    await fetchServerConfig(candidate.baseUrl),
    getAppVersion()
  );
  if (!outcome.ok) return outcome;

  await setActiveServer(outcome.server);
  return outcome;
}

/**
 * Re-reads the connected server's config at startup and adopts any change.
 *
 * Connecting validates once. Without this, nothing ever revalidates: a customer
 * who rotates their Supabase project behind an unchanged base URL would strand
 * every enrolled device on a dead anon key, and a raised `minCompanionVersion`
 * would never reach an app that is already connected.
 *
 * Best-effort and deliberately non-blocking — an unreachable server leaves the
 * persisted config in place, because being offline must not cost the user their
 * connection. Shelf Cloud is skipped: its credentials are bundled, so there is
 * nothing to re-read.
 *
 * A refusal here does NOT disconnect. `setActiveServer` is reached only for a
 * config that passes every gate, so a too-old app keeps the server it can still
 * partly talk to rather than being cut off at launch. Surfacing that refusal in
 * the UI is connect-time only today; a launch-time prompt is not built yet.
 *
 * @returns Resolves once the refresh has been attempted.
 */
export async function refreshActiveServerConfig(): Promise<void> {
  const active = getActiveServer();
  if (active.isCloud) return;

  const versionAtStart = getServerVersion();
  const parsed = await fetchServerConfig(active.baseUrl);
  if (parsed === null) return;

  // The user can disconnect or connect somewhere else while this request is in
  // flight. Applying the answer then would drag them back to the server they
  // just left and wipe their state a second time, so a superseded refresh is
  // dropped rather than committed.
  if (getServerVersion() !== versionAtStart) return;

  const outcome = decideServerConnection(parsed, getAppVersion());
  if (!outcome.ok) {
    if (__DEV__)
      console.error("[Server] config refresh refused:", outcome.reason);
    return;
  }

  // `setActiveServer` classifies this itself: a rotated project or anon key is
  // a credentials refresh (no teardown, no sign-out of unrelated state), and an
  // unchanged config is a no-op.
  await setActiveServer(outcome.server);
}

/**
 * Returns the app to Shelf Cloud.
 *
 * Routed through this module rather than exposing `setActiveServer` to screens,
 * so every server change stays in one place. Carries the same teardown as
 * connecting: the current session is signed out and server-scoped state is
 * cleared.
 *
 * @returns Resolves once the app is back on Shelf Cloud.
 */
export async function disconnectFromServer(): Promise<void> {
  await setActiveServer(CLOUD_SERVER);
}
