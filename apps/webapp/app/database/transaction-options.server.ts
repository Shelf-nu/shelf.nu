/**
 * Interactive transaction options shared by long-running writes.
 *
 * Prisma's defaults are a 2 s `maxWait` to obtain a connection and a 5 s
 * `timeout` for the transaction body. Either one surfaces as P2028. Writes that
 * run many times in one request (the CSV import calls `createAsset` once per
 * row) or that grow with their input (`bulkAssignKitCustody`) need room on
 * both: a busy pool can delay the start, and a large input can stretch the body.
 *
 * @see {@link file://./../modules/asset/service.server.ts} createAsset
 * @see {@link file://./../modules/kit/service.server.ts} bulkAssignKitCustody
 */

/** Options for an interactive transaction that may wait for a connection or run long. */
export const LONG_TRANSACTION_OPTIONS = {
  /** How long to wait for a pooled connection before giving up. */
  maxWait: 6000,
  /** How long the transaction body may run before Prisma rolls it back. */
  timeout: 15000,
} as const;
