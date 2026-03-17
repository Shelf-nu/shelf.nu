import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

export type TypedSupabaseClient = SupabaseClient<Database>;

export interface CreateSupabaseClientOptions {
  /** Supabase project URL */
  url: string;
  /**
   * Key to use for authentication.
   * - Use `anon` key for client-side / RLS-scoped requests
   * - Use `service_role` key for server-side admin requests
   */
  key: string;
  /** Optional access token to attach as Authorization header (e.g. user JWT) */
  accessToken?: string;
}

/**
 * Creates a typed Supabase client for database operations.
 *
 * This is the Supabase equivalent of the Prisma `createDatabaseClient()`.
 * It returns a fully typed client that respects RLS policies when using
 * the anon key + user JWT, or bypasses them with the service_role key.
 *
 * @example
 * ```ts
 * // Server-side admin client (bypasses RLS)
 * const adminDb = createSupabaseClient({
 *   url: SUPABASE_URL,
 *   key: SUPABASE_SERVICE_ROLE,
 * });
 *
 * // Per-request client scoped to a user (respects RLS)
 * const userDb = createSupabaseClient({
 *   url: SUPABASE_URL,
 *   key: SUPABASE_ANON_PUBLIC,
 *   accessToken: userJwt,
 * });
 * ```
 */
export function createSupabaseClient(
  options: CreateSupabaseClientOptions
): TypedSupabaseClient {
  const { url, key, accessToken } = options;

  return createClient<Database>(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    ...(accessToken
      ? {
          global: {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
        }
      : {}),
  });
}
