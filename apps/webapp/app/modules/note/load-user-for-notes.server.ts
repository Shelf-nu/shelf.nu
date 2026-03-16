import { sbDb } from "~/database/supabase.server";

/**
 * Minimal user name shape used when composing note content.
 */
export type BasicUserName = {
  firstName: string | null;
  lastName: string | null;
};

/**
 * Deferred loader signature for fetching the acting user's name only once.
 */
export type LoadUserForNotesFn = () => Promise<BasicUserName>;

/**
 * Creates a memoized loader that fetches the note author's name on demand.
 */
export function createLoadUserForNotes(userId: string): LoadUserForNotesFn {
  let cachedUser: BasicUserName | null = null;

  return async () => {
    if (!cachedUser) {
      const { data } = await sbDb
        .from("User")
        .select("firstName, lastName")
        .eq("id", userId)
        .maybeSingle();

      cachedUser = data ?? { firstName: null, lastName: null };
    }

    return cachedUser;
  };
}
