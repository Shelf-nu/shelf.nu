import { createSupabaseDataClient } from "@shelf/database";
import type { SupabaseDataClient } from "@shelf/database";

import { NODE_ENV } from "../utils/env";

export type { SupabaseDataClient };

let db: SupabaseDataClient;

declare global {
  // eslint-disable-next-line no-var
  var __db__: SupabaseDataClient;
}

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Singleton pattern: reuse the same client across hot reloads in development.
// In production, a single instance is created once.
if (NODE_ENV === "production") {
  db = createSupabaseDataClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
} else {
  if (!global.__db__) {
    global.__db__ = createSupabaseDataClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY
    );
  }
  db = global.__db__;
}

export { db };
