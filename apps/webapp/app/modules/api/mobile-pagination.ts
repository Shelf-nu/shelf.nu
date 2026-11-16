/**
 * Mobile Pagination
 *
 * Reads `page` and `perPage` from a mobile API request's query string into
 * values Prisma accepts. The query string is caller-supplied, so every input
 * has to land on a usable page rather than fail the request: Prisma rejects a
 * fractional, non-finite or unsafe `skip`/`take` with a 500.
 *
 * @see {@link file://./../../routes/api+/mobile+/bookings.ts}
 * @see {@link file://./../../routes/api+/mobile+/assets.$assetId.bookings.ts}
 */

/** The page a mobile list request asked for, safe to hand to Prisma. */
export type MobilePagination = {
  /** 1-based page number */
  page: number;
  /** Rows per page, within `[1, maxPerPage]` */
  perPage: number;
  /** Rows to skip: `(page - 1) * perPage`, always a safe integer */
  skip: number;
};

/**
 * A positive whole number from a query value, or the fallback.
 *
 * `Number` rather than `parseInt`: `parseInt("1e3")` is 1, which silently
 * answers a different page than the one asked for.
 *
 * @param raw - The query value, or null when absent
 * @param fallback - Returned for a missing, non-numeric, non-finite or
 *   non-positive value
 * @returns The value floored to an integer, or `fallback`
 */
function positiveInt(raw: string | null, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const floored = Math.floor(parsed);
  return floored >= 1 ? floored : fallback;
}

/**
 * Parses a mobile list request's pagination params.
 *
 * Validating each operand is not enough: a page like 1.79e308 is a finite
 * integer that overflows once multiplied by `perPage`, so the computed `skip`
 * is checked too, and an unsafe one falls back to the first page.
 *
 * @param searchParams - The request's query string
 * @param options.defaultPerPage - Page size when `perPage` is absent or invalid
 * @param options.maxPerPage - Upper bound on the page size
 * @returns The page, page size and row offset to query with
 */
export function parseMobilePagination(
  searchParams: URLSearchParams,
  {
    defaultPerPage = 20,
    maxPerPage = 50,
  }: { defaultPerPage?: number; maxPerPage?: number } = {}
): MobilePagination {
  const perPage = Math.min(
    maxPerPage,
    positiveInt(searchParams.get("perPage"), defaultPerPage)
  );
  const requestedPage = positiveInt(searchParams.get("page"), 1);
  const requestedSkip = (requestedPage - 1) * perPage;

  return Number.isSafeInteger(requestedSkip)
    ? { page: requestedPage, perPage, skip: requestedSkip }
    : { page: 1, perPage, skip: 0 };
}
