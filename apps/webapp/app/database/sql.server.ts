/**
 * SQL template literal builder — replaces Prisma.sql, Prisma.join, Prisma.raw.
 *
 * Builds parameterized SQL with $1, $2, ... placeholders and a values array,
 * suitable for execution via a Postgres function or direct query.
 */

// ---------------------------------------------------------------------------
// SqlFragment — the core type representing a parameterized SQL string
// ---------------------------------------------------------------------------

export class SqlFragment {
  readonly text: string;
  readonly values: unknown[];

  constructor(text: string, values: unknown[] = []) {
    this.text = text;
    this.values = values;
  }

  /** Combine with another fragment, re-numbering placeholders */
  append(other: SqlFragment): SqlFragment {
    const offset = this.values.length;
    const reNumbered = other.text.replace(
      /\$(\d+)/g,
      (_, n) => `$${parseInt(n) + offset}`
    );
    return new SqlFragment(this.text + reNumbered, [
      ...this.values,
      ...other.values,
    ]);
  }
}

// ---------------------------------------------------------------------------
// sql — tagged template literal
// ---------------------------------------------------------------------------

/**
 * Tagged template literal that builds a parameterized SqlFragment.
 *
 * Usage:
 *   const frag = sql`WHERE a."organizationId" = ${orgId}`;
 *   // frag.text  => 'WHERE a."organizationId" = $1'
 *   // frag.values => [orgId]
 *
 * Interpolated SqlFragment values are inlined (with placeholder renumbering).
 * All other values become parameters.
 */
export function sql(
  strings: TemplateStringsArray,
  ...values: unknown[]
): SqlFragment {
  let text = "";
  const params: unknown[] = [];

  for (let i = 0; i < strings.length; i++) {
    text += strings[i];
    if (i < values.length) {
      const val = values[i];
      if (val instanceof SqlFragment) {
        // Inline the fragment, renumbering its placeholders
        const offset = params.length;
        const reNumbered = val.text.replace(
          /\$(\d+)/g,
          (_, n) => `$${parseInt(n) + offset}`
        );
        text += reNumbered;
        params.push(...val.values);
      } else {
        params.push(val);
        text += `$${params.length}`;
      }
    }
  }

  return new SqlFragment(text, params);
}

// ---------------------------------------------------------------------------
// raw — inject raw (unescaped) SQL strings
// ---------------------------------------------------------------------------

/**
 * Creates a SqlFragment from a raw string with no parameterization.
 * USE WITH CAUTION — only for trusted, non-user-input strings like column
 * names and SQL keywords.
 */
export function raw(value: string): SqlFragment {
  return new SqlFragment(value);
}

// ---------------------------------------------------------------------------
// join — join multiple SqlFragments with a separator
// ---------------------------------------------------------------------------

/**
 * Joins an array of SqlFragments with a separator string.
 *
 * Usage:
 *   const conditions = [sql`a = ${1}`, sql`b = ${2}`];
 *   const combined = join(conditions, " AND ");
 *   // combined.text  => 'a = $1 AND b = $2'
 *   // combined.values => [1, 2]
 */
export function join(fragments: SqlFragment[], separator: string): SqlFragment {
  if (fragments.length === 0) {
    return new SqlFragment("");
  }

  let result = fragments[0];
  for (let i = 1; i < fragments.length; i++) {
    result = result.append(new SqlFragment(separator));
    result = result.append(fragments[i]);
  }
  return result;
}

// ---------------------------------------------------------------------------
// empty — a no-op fragment
// ---------------------------------------------------------------------------

/** An empty SQL fragment (no text, no params). */
export const empty = new SqlFragment("");

// ---------------------------------------------------------------------------
// queryRaw — execute a SqlFragment via Supabase RPC
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@shelf/database";

type SupabaseDataClient = SupabaseClient<Database>;

/**
 * Executes a parameterized SQL query via the execute_raw_query RPC function.
 * Returns the result rows typed as T.
 *
 * Usage:
 *   const rows = await queryRaw<MyType>(db, sql`SELECT * FROM "Asset" WHERE id = ${id}`);
 */
export async function queryRaw<T = Record<string, unknown>>(
  db: SupabaseDataClient,
  fragment: SqlFragment
): Promise<T[]> {
  const { data, error } = await db.rpc("execute_raw_query" as any, {
    query_text: fragment.text,
    query_params: JSON.stringify(fragment.values),
  });

  if (error) {
    throw error;
  }

  // The RPC returns a JSONB array
  if (Array.isArray(data)) {
    return data as T[];
  }

  // If it returned a single JSONB value (the aggregated array)
  return (data as unknown as T[]) ?? [];
}
