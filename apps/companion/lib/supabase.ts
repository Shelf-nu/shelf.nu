import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_PUBLIC!;

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

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: secureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
