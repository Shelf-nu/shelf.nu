/**
 * Active-server state.
 *
 * Holds the one `ServerConfig` the app is currently connected to, persists it
 * across launches, and owns the teardown that runs when the app switches
 * servers. A missed teardown means one server's data rendered against another
 * server's session, so `clearServerScopedState` is the single place every
 * server-scoped key is accounted for.
 *
 * IMPORTANT: this module must not import from `lib/api/*` or
 * `lib/audit-scan-persistence.ts`. Those already depend on it, so the reverse
 * edge would be a require cycle. Modules that need to react to a switch
 * subscribe via `subscribeToServerChange`; storage owned elsewhere is cleared
 * by prefix using constants from the dependency-free `./contract`.
 *
 * @see ./contract.ts — the pure types and the storage-key inventory
 * @see ./discovery.ts — decides WHICH server to switch to
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getSupabase, rebuildSupabase } from "../supabase";
import {
  ACTIVE_SERVER_STORAGE_KEY,
  classifyServerChange,
  normalizeBaseUrl,
  SERVER_SCOPED_KEY_PREFIXES,
  SERVER_SCOPED_STORAGE_KEYS,
  type ServerConfig,
} from "./contract";

/**
 * The bundled Shelf Cloud default — used on first run, and whenever stored
 * state is missing or unreadable.
 *
 * The `__DEV__` split in the base-URL fallback mirrors the original
 * `API_BASE_URL` logic: `EXPO_PUBLIC_*` values are inlined at bundle time, so
 * an OTA update published without the production env scope would bake the
 * fallback into every install. Falling back to production makes the worst case
 * "points at prod", which is what release builds want anyway.
 */
export const CLOUD_SERVER: ServerConfig = {
  baseUrl: normalizeBaseUrl(
    process.env.EXPO_PUBLIC_API_URL ||
      (__DEV__ ? "http://localhost:3000" : "https://app.shelf.nu")
  ),
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL!,
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_PUBLIC!,
  name: "Shelf",
  isCloud: true,
};

let activeServer: ServerConfig = CLOUD_SERVER;

/** Bumped on every switch so hook consumers can re-subscribe. */
let version = 0;

const listeners = new Set<() => void>();

/** Notifies subscribers that the active server changed. */
function notifyServerChange(): void {
  version += 1;
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (e) {
      // One bad subscriber must not abort the rest of the switch.
      if (__DEV__) console.error("[Server] change listener failed:", e);
    }
  });
}

/**
 * Returns the active server.
 *
 * Synchronous by design: call sites are on hot paths (every API request builds
 * a URL from this) and must not await.
 *
 * @returns The active `ServerConfig`; Shelf Cloud until hydration completes.
 */
export function getActiveServer(): ServerConfig {
  return activeServer;
}

/**
 * A counter that changes whenever the active server changes.
 *
 * @returns The current version, for use in React dependency arrays.
 */
export function getServerVersion(): number {
  return version;
}

/**
 * Registers a callback fired after each server switch completes.
 *
 * @param listener - Invoked with no arguments once the switch is fully applied.
 * @returns An unsubscribe function.
 */
export function subscribeToServerChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Restores the persisted active server.
 *
 * Call once at boot, before any provider that touches auth mounts — until it
 * resolves, `getActiveServer()` reports Shelf Cloud.
 *
 * @returns Resolves once the active server is known. Never throws: a corrupt
 *   record falls back to Shelf Cloud rather than bricking the app.
 */
export async function hydrateActiveServer(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_SERVER_STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw) as Partial<ServerConfig>;
    if (
      typeof parsed?.baseUrl !== "string" ||
      typeof parsed?.supabaseUrl !== "string" ||
      typeof parsed?.supabaseAnonKey !== "string"
    ) {
      return;
    }

    activeServer = {
      baseUrl: normalizeBaseUrl(parsed.baseUrl),
      supabaseUrl: normalizeBaseUrl(parsed.supabaseUrl),
      supabaseAnonKey: parsed.supabaseAnonKey,
      name: parsed.name || "Shelf",
      isCloud: parsed.isCloud === true,
    };
    rebuildSupabase(activeServer);
    // Notify so `api/client.ts` rearms its auth listener against the client we
    // just built. No consumer has read a token yet at this point, but the
    // subscription must still point at the live client.
    notifyServerChange();
  } catch (e) {
    if (__DEV__) console.error("[Server] hydrate failed:", e);
  }
}

/**
 * Wipes every piece of persisted state that belongs to one server.
 *
 * Device preferences (theme, start page, scan sound, review prompt) are
 * deliberately preserved — they are properties of the device, not the server.
 *
 * @returns Resolves once all server-scoped state is gone. Never throws:
 *   leaving a stale key behind is recoverable, being stuck half-switched
 *   is not.
 */
async function clearServerScopedState(): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const prefixed = allKeys.filter((key) =>
      SERVER_SCOPED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
    );
    // NOTE: `removeMany`, not `multiRemove` — async-storage v3 renamed it.
    await AsyncStorage.removeMany([...SERVER_SCOPED_STORAGE_KEYS, ...prefixed]);
  } catch (e) {
    if (__DEV__) console.error("[Server] clearServerScopedState failed:", e);
  }
}

/**
 * Persists the active server config, best-effort.
 *
 * @param config - The config to store.
 * @returns Resolves once stored. A failure leaves the change standing for this
 *   session; it just will not survive a restart, which beats aborting midway.
 */
async function persistActiveServer(config: ServerConfig): Promise<void> {
  try {
    await AsyncStorage.setItem(
      ACTIVE_SERVER_STORAGE_KEY,
      JSON.stringify(config)
    );
  } catch (e) {
    if (__DEV__) console.error("[Server] persist failed:", e);
  }
}

/**
 * Applies a server config: a no-op, a credential refresh, or a full switch.
 *
 * A matching `baseUrl` does NOT mean "already active": a customer can rotate
 * their Supabase project while keeping the same base URL, and an app that
 * skips such a config keeps using a stale anon key with no in-app way to
 * recover. Compare the credentials, not just the URL.
 *
 * A credential refresh deliberately does NOT tear down server-scoped state: the
 * selected organisation and audit drafts still belong to this same instance, so
 * wiping them would turn a silent config update into visible data loss. It also
 * does not force a sign-out — if the session is still valid under the new
 * credentials it keeps working, and if it is not, the existing 401 handling
 * routes the user to login.
 *
 * On a full switch, order matters: sign out of the old client while it is still
 * live, then rebuild, then wipe persisted state, and only then notify
 * subscribers — they must observe the fully-switched state, never a
 * half-applied one.
 *
 * @param config - The config to apply.
 * @returns Resolves once the change and any teardown are complete.
 */
export async function setActiveServer(config: ServerConfig): Promise<void> {
  const change = classifyServerChange(activeServer, config);
  if (change === "none") return;

  if (change === "credentials") {
    const credentialsChanged =
      activeServer.supabaseUrl !== config.supabaseUrl ||
      activeServer.supabaseAnonKey !== config.supabaseAnonKey;

    activeServer = config;
    // A rename alone needs no new client — rebuilding would drop the auth
    // subscription and reset the token cache for nothing.
    if (credentialsChanged) rebuildSupabase(config);
    await persistActiveServer(config);
    // Notify regardless: the display name is user-visible on the login chip
    // and the Settings row, and subscribers rearm caches after a rebuild.
    notifyServerChange();
    return;
  }

  try {
    await getSupabase().auth.signOut();
  } catch {
    // A failed sign-out must not block the switch: the client is discarded
    // immediately afterwards and its session storage is namespaced per project.
  }

  activeServer = config;
  rebuildSupabase(config);
  await clearServerScopedState();
  await persistActiveServer(config);

  notifyServerChange();
}
