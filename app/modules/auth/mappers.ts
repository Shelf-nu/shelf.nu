import type { SupabaseAuthSession } from "~/integrations/supabase";

import { ShelfStackError } from "~/utils/error";
import type { AuthSession } from "./types";
import { getOrganizationByUserId } from "../organization";

export async function mapAuthSession(
  supabaseAuthSession: SupabaseAuthSession | null
): Promise<AuthSession | null> {
  if (!supabaseAuthSession) return null;

  if (!supabaseAuthSession.refresh_token)
    throw new ShelfStackError({ message: "User should have a refresh token" });

  if (!supabaseAuthSession.user?.email)
    throw new ShelfStackError({ message: "User should have an email" });

  /** For now we will always set the organizationId when you login, to the PERSONAL organization
   * In the future we could store the preference for organization from the user in the userPrefs cookie and set it like this
   * This will also be more perfomant because we dont need to query, however there will be some edge cases and safety concerns we would have to address
   */
  const org = await getOrganizationByUserId({
    userId: supabaseAuthSession.user.id,
    orgType: "PERSONAL",
  });
  if (!org || !org.id)
    throw new ShelfStackError({
      message:
        "Something went wrong with logging you in. Please try again and if the issue persists, contact support.",
    });

  return {
    accessToken: supabaseAuthSession.access_token,
    refreshToken: supabaseAuthSession.refresh_token,
    userId: supabaseAuthSession.user.id,
    organizationId: org.id,
    email: supabaseAuthSession.user.email,
    expiresIn: supabaseAuthSession.expires_in ?? -1,
    expiresAt: supabaseAuthSession.expires_at ?? -1,
  };
}
