import type { User } from "@prisma/client";

import { db } from "~/database/db.server";

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
      cachedUser = (await db.user.findFirst({
        where: { id: userId },
        select: { firstName: true, lastName: true },
      })) ?? { firstName: null, lastName: null };
    }

    return cachedUser;
  };
}
