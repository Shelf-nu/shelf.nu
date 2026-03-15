import type { User } from "@shelf/database";

import { db } from "~/database/db.server";
import { findFirst } from "~/database/query-helpers.server";

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
export function createLoadUserForNotes(userId: User["id"]): LoadUserForNotesFn {
  let cachedUser: BasicUserName | null = null;

  return async () => {
    if (!cachedUser) {
      const user = await findFirst(db, "User", {
        where: { id: userId },
      });
      cachedUser = user
        ? { firstName: user.firstName, lastName: user.lastName }
        : { firstName: null, lastName: null };
    }

    return cachedUser;
  };
}
