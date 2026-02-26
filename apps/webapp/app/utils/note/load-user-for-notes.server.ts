import type { User } from "@prisma/client";

import { db } from "~/database/db.server";

/**
 * Basic user name type for notes
 */
export type BasicUserName = {
  firstName: string | null;
  lastName: string | null;
};

/**
 * Memoized loader for user names used inside note creation helpers.
 * Returns a function so callers can reuse the same closure without repeated queries.
 */
export function createLoadUserForNotes(userId: User["id"]) {
  let cachedUser: BasicUserName | null = null;

  return async (): Promise<BasicUserName> => {
    if (!cachedUser) {
      cachedUser = (await db.user.findFirst({
        where: { id: userId },
        select: { firstName: true, lastName: true },
      })) ?? { firstName: null, lastName: null };
    }

    return cachedUser;
  };
}
