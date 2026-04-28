/**
 * SQL identifier validation utilities.
 *
 * Used wherever a string sourced (directly or transitively) from user input is
 * about to be interpolated into a raw SQL query as an identifier (column name,
 * table name, alias). Postgres does not parameterize identifiers — they must be
 * inlined into the query string — so the only safe option is allowlisting.
 *
 * Use this in any code path that calls `Prisma.raw()` or builds a SQL string
 * passed to `$queryRaw` / `$executeRaw`.
 *
 * @see {@link file://./../modules/asset/filter-parsing.ts}
 * @see {@link file://./../modules/asset/query.server.ts}
 */

/**
 * Matches a conservative SQL identifier: must start with a letter or
 * underscore, followed by letters, digits, or underscores. No quoting,
 * no dots, no spaces, no operators, no Unicode.
 *
 * Rejecting these characters is sufficient to neutralize SQL injection
 * via raw-interpolated identifiers because the Postgres parser cannot
 * be steered out of an identifier context with only `[a-zA-Z0-9_]`.
 *
 * Kept private to this module — callers should use {@link isSafeSqlIdentifier}.
 */
const SAFE_SQL_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Returns true if `value` is safe to inline as a Postgres identifier.
 *
 * @param value - Candidate string. Non-strings (undefined, null) return false.
 * @returns Whether the value matches the safe-identifier rules.
 */
export function isSafeSqlIdentifier(value: unknown): value is string {
  return typeof value === "string" && SAFE_SQL_IDENTIFIER.test(value);
}
