/**
 * Where supabase-js keeps a project's session on the device.
 *
 * The Supabase client is built with {@link sessionStorageKey} as its explicit
 * `storageKey`, and a sign-out that has to delete the stored session itself
 * removes every key {@link sessionStorageKeys} lists. Both must name exactly
 * what supabase-js writes, or stored sessions stop being found (everyone is
 * signed out) or a forced sign-out leaves one behind.
 *
 * Pure on purpose (no React Native, Expo or `@/` imports) so `node:test` can
 * load it.
 *
 * @see {@link file://./session-storage-keys.test.ts}
 * @see {@link file://./supabase.ts}
 */

/**
 * The session storage key for a Supabase project: `sb-<project-ref>-auth-token`,
 * the name supabase-js derives by default.
 *
 * @param supabaseUrl - The project's URL
 * @returns The storage key
 */
export function sessionStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}

/**
 * Every key supabase-js may store for a session under `storageKey`: the
 * session itself, the PKCE code verifier, and the separately stored user.
 *
 * @param storageKey - The client's session storage key
 * @returns The keys to remove when the session is deleted directly
 */
export function sessionStorageKeys(storageKey: string): string[] {
  return [storageKey, `${storageKey}-code-verifier`, `${storageKey}-user`];
}
