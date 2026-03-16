/**
 * Typed Supabase database client for the webapp.
 *
 * This wraps `createSupabaseClient` from `@shelf/database` with the
 * webapp's environment variables. During the Prisma → Supabase migration,
 * modules gradually switch from `db` (Prisma) to `sbDb` (Supabase).
 *
 * Once all modules are migrated, the Prisma `db` export can be removed.
 */
import {
  createSupabaseClient,
  type TypedSupabaseClient,
} from "@shelf/database";

import { SUPABASE_URL, SUPABASE_SERVICE_ROLE, NODE_ENV } from "~/utils/env";

let sbDb: TypedSupabaseClient;

declare global {
  // eslint-disable-next-line no-var
  var __sbDb__: TypedSupabaseClient;
}

// Same singleton pattern used by the Prisma client.
if (NODE_ENV === "production") {
  sbDb = createSupabaseClient({
    url: SUPABASE_URL,
    key: SUPABASE_SERVICE_ROLE,
  });
} else {
  if (!global.__sbDb__) {
    global.__sbDb__ = createSupabaseClient({
      url: SUPABASE_URL,
      key: SUPABASE_SERVICE_ROLE,
    });
  }
  sbDb = global.__sbDb__;
}

export { sbDb };
