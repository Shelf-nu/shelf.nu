/**
 * Supabase client for the ACTIVE server.
 *
 * The app can be connected to Shelf Cloud or to a customer's self-hosted
 * instance, each of which is a different Supabase project. The client is
 * therefore rebuildable at runtime rather than a module singleton — consumers
 * must call `getSupabase()` at use time and never capture the result in a
 * module-scope binding, or they will keep talking to the previous server.
 *
 * @see ./server/active-server.ts — owns when the rebuild happens
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { ServerConfig } from "./server/contract";

/**
 * Maximum bytes per SecureStore item on iOS.
 * Values exceeding this are chunked into multiple entries.
 */
const CHUNK_SIZE = 2000;

/**
 * Secure storage adapter for Supabase auth tokens.
 *
 * Uses expo-secure-store on native, localStorage on web.
 * Large values (e.g. JWTs with many claims) are automatically
 * chunked into 2000-byte pieces to stay within iOS SecureStore limits,
 * ensuring sessions persist across app restarts and backgrounding.
 */
const secureStoreAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      if (Platform.OS === "web") {
        return typeof localStorage !== "undefined"
          ? localStorage.getItem(key)
          : null;
      }

      // Try direct read first (most values fit in one chunk)
      const direct = await SecureStore.getItemAsync(key);
      if (direct !== null) return direct;

      // Check for chunked value
      const countStr = await SecureStore.getItemAsync(`${key}_chunks`);
      if (!countStr) return null;

      const count = parseInt(countStr, 10);
      const parts: string[] = [];
      for (let i = 0; i < count; i++) {
        const part = await SecureStore.getItemAsync(`${key}_chunk_${i}`);
        if (part === null) return null; // corrupted — bail
        parts.push(part);
      }
      return parts.join("");
    } catch (e) {
      if (__DEV__) console.error(`[SecureStore] getItem(${key}) failed:`, e);
      return null;
    }
  },

  setItem: async (key: string, value: string): Promise<void> => {
    try {
      if (Platform.OS === "web") {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem(key, value);
        }
        return;
      }

      if (value.length <= CHUNK_SIZE) {
        // Fits in a single entry — clean up any old chunks first
        await cleanupChunks(key);
        await SecureStore.setItemAsync(key, value);
        return;
      }

      // Large value — chunk it
      // Remove the direct key to avoid stale reads
      try {
        await SecureStore.deleteItemAsync(key);
      } catch {}

      const chunks = Math.ceil(value.length / CHUNK_SIZE);
      for (let i = 0; i < chunks; i++) {
        const chunk = value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        await SecureStore.setItemAsync(`${key}_chunk_${i}`, chunk);
      }
      await SecureStore.setItemAsync(`${key}_chunks`, String(chunks));
    } catch (e) {
      if (__DEV__) console.error(`[SecureStore] setItem(${key}) failed:`, e);
    }
  },

  removeItem: async (key: string): Promise<void> => {
    try {
      if (Platform.OS === "web") {
        if (typeof localStorage !== "undefined") {
          localStorage.removeItem(key);
        }
        return;
      }
      await SecureStore.deleteItemAsync(key);
      await cleanupChunks(key);
    } catch (e) {
      if (__DEV__) console.error(`[SecureStore] removeItem(${key}) failed:`, e);
    }
  },
};

/** Remove any chunked entries for a key */
async function cleanupChunks(key: string): Promise<void> {
  try {
    const countStr = await SecureStore.getItemAsync(`${key}_chunks`);
    if (!countStr) return;
    const count = parseInt(countStr, 10);
    for (let i = 0; i < count; i++) {
      try {
        await SecureStore.deleteItemAsync(`${key}_chunk_${i}`);
      } catch {}
    }
    await SecureStore.deleteItemAsync(`${key}_chunks`);
  } catch {}
}

/**
 * The live client. Replaced wholesale on every server switch, which is why
 * nothing outside this module may hold a reference to it.
 */
let client: SupabaseClient | null = null;

/**
 * URL the live client was built with. Tracked because `SupabaseClient` does not
 * expose it, and `apiFetch` asserts against it that the session it is about to
 * send belongs to the active server.
 */
let clientUrl: string | null = null;

/**
 * Creates a client for one server, with the shared secure-storage adapter.
 *
 * @param supabaseUrl - The server's Supabase project URL.
 * @param supabaseAnonKey - That project's public anon key.
 * @returns A configured Supabase client.
 */
function createForServer(
  supabaseUrl: string,
  supabaseAnonKey: string
): SupabaseClient {
  clientUrl = supabaseUrl;
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storage: secureStoreAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Returns the Supabase client for the active server, creating it on first use
 * from the bundled Shelf Cloud credentials.
 *
 * Supabase namespaces its own session storage as `sb-<project-ref>-auth-token`,
 * derived from the URL, so sessions for two different servers cannot collide in
 * SecureStore.
 *
 * @returns The live client.
 */
export function getSupabase(): SupabaseClient {
  if (!client) {
    // why: the cloud credentials are read from process.env here AND in
    // `CLOUD_SERVER` (server/active-server.ts). That duplication is deliberate
    // — importing CLOUD_SERVER would make this module depend on
    // active-server.ts, which already depends on this one. Do not "fix" it.
    client = createForServer(
      process.env.EXPO_PUBLIC_SUPABASE_URL!,
      process.env.EXPO_PUBLIC_SUPABASE_ANON_PUBLIC!
    );
  }
  return client;
}

/**
 * The URL the live Supabase client was built with.
 *
 * @returns The URL, or `null` when no client has been created yet.
 * @see ./server/contract.ts — `isSessionServerMismatched`, which consumes this
 */
export function getSupabaseClientUrl(): string | null {
  return clientUrl;
}

/**
 * Replaces the live client with one pointed at `config`'s Supabase project, and
 * stops the outgoing client's token auto-refresh.
 *
 * Callers are responsible for signing out of the previous client BEFORE calling
 * this, and for rearming anything subscribed to the old client's auth events —
 * see `setActiveServer`.
 *
 * @param config - The server being switched to.
 * @returns The newly created client.
 */
export function rebuildSupabase(config: ServerConfig): SupabaseClient {
  const previous = client;
  // Reassign first, so a throw below can never leave `client` pointing at the
  // server we just switched away from.
  client = createForServer(config.supabaseUrl, config.supabaseAnonKey);

  // why: with `autoRefreshToken: true` and no `document` (React Native),
  // GoTrueClient unconditionally starts a setInterval ticker that ONLY
  // stopAutoRefresh() clears. Dropping the reference alone strands it for the
  // process lifetime, still refreshing the previous server's session every 30s.
  // Fire-and-forget: clearInterval happens synchronously inside, and a
  // rejection must never block the switch. (`dispose()` does not exist in the
  // pinned auth-js version.)
  void previous?.auth.stopAutoRefresh().catch(() => {});

  return client;
}
