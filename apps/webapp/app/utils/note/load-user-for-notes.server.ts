import type { User } from "@shelf/database";

import { db } from "~/database/db.server";
import { findFirst } from "~/database/query-helpers.server";

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
      cachedUser = (await findFirst(db, "User", {
        where: { id: userId },
        select: "firstName, lastName",
      })) ?? { firstName: null, lastName: null };
    }

    return cachedUser;
  };
}
