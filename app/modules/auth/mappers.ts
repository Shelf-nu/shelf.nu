import type { SupabaseAuthSession } from "~/integrations/supabase";

import type { AuthSession } from "./types";

export function mapAuthSession(
  supabaseAuthSession: SupabaseAuthSession | null
): AuthSession | null {
  if (!supabaseAuthSession) return null;

  if (!supabaseAuthSession.refresh_token)
    throw new Error("User should have a refresh token");

  if (!supabaseAuthSession.user?.email)
    throw new Error("User should have an email");

  return {
    accessToken: supabaseAuthSession.access_token,
    refreshToken: supabaseAuthSession.refresh_token,
    userId: supabaseAuthSession.user.id,
    email: supabaseAuthSession.user.email,
    expiresIn: supabaseAuthSession.expires_in ?? -1,
    expiresAt: supabaseAuthSession.expires_at ?? -1,
  };
}
