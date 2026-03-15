import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

export type SupabaseDataClient = SupabaseClient<Database>;

/**
 * Creates a typed Supabase client for data operations.
 * Uses the service role key to bypass RLS (for server-side use only).
 *
 * This is distinct from the auth/storage Supabase client in the webapp.
 */
export function createSupabaseDataClient(
  url: string,
  serviceRoleKey: string
): SupabaseDataClient {
  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
